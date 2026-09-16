"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { revalidatePath } from "next/cache";
import {
  computePhysioScore,
  type ExamRow,
  type FunctionalScores,
  type BalanceScores,
  type CoordinationScores,
  type PhysioCareSetting,
} from "@/lib/physio-scoring";

type BodyChartInput = { region: string; side: "R" | "L" | null; comment: string };

type CreatePhysioAssessmentInput = {
  residentId: number;
  careSetting: PhysioCareSetting;
  entryTimestamp: string;
  treatmentType: string | null;
  creditHours: number | null;
  chiefComplaint: string | null;
  currentHistory: string | null;
  pastMedicalHistory: string | null;
  socialHistory: string | null;
  impression: string | null;
  planIntervention: string | null;
  evaluation: string | null;
  treatmentCompliance: string | null;
  documentedBy: string;
  examRows: ExamRow[];
  bodyChart: BodyChartInput[];
  functional: FunctionalScores;
  balance: BalanceScores;
  coordination: CoordinationScores;
};

export async function createPhysioAssessment(
  input: CreatePhysioAssessmentInput
): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) {
    return { success: false, error: "Not authenticated" };
  }

  if (!input.documentedBy) {
    return { success: false, error: "Documented by is required" };
  }

  const supabase = await createClient();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("branch_id")
    .eq("id", input.residentId)
    .single();

  if (!resident) {
    return { success: false, error: "Resident not found" };
  }

  if (account.rights !== "ADMIN" && resident.branch_id !== account.branch_id) {
    return { success: false, error: "Access denied" };
  }

  const totalScore = computePhysioScore(input.examRows, input.functional, input.balance, input.coordination);

  const { data: assessment, error: assessmentError } = await supabase
    .from("physio_assessments")
    .insert({
      branch_id: resident.branch_id,
      resident_id: input.residentId,
      care_setting: input.careSetting,
      entry_timestamp: input.entryTimestamp,
      treatment_type: input.treatmentType,
      credit_hours: input.creditHours,
      chief_complaint: input.chiefComplaint,
      current_history: input.currentHistory,
      past_medical_history: input.pastMedicalHistory,
      social_history: input.socialHistory,
      impression: input.impression,
      plan_intervention: input.planIntervention,
      evaluation: input.evaluation,
      treatment_compliance: input.treatmentCompliance,
      total_score: totalScore,
      documented_by: input.documentedBy,
    })
    .select("id")
    .single();

  if (assessmentError || !assessment) {
    console.error("Failed to create physio_assessments row:", assessmentError);
    return { success: false, error: assessmentError?.message ?? "Failed to save assessment" };
  }

  const assessmentId = assessment.id;

  // Only persist rows that actually have at least one score -- an all-null
  // row for an unassessed movement carries no information and would just
  // bloat the table.
  const examToInsert = input.examRows
    .filter((r) => r.power !== null || r.tone !== null || r.rom !== null || r.reflexes !== null)
    .map((r) => ({ assessment_id: assessmentId, ...r }));

  const bodyChartToInsert = input.bodyChart.map((f) => ({ assessment_id: assessmentId, ...f }));

  const childInserts: PromiseLike<{ error: { message: string } | null }>[] = [];

  if (examToInsert.length > 0) {
    childInserts.push(supabase.from("physio_examinations").insert(examToInsert));
  }
  if (bodyChartToInsert.length > 0) {
    childInserts.push(supabase.from("physio_body_chart_findings").insert(bodyChartToInsert));
  }
  childInserts.push(supabase.from("physio_functional_assessments").insert({ assessment_id: assessmentId, ...input.functional }));
  childInserts.push(supabase.from("physio_balance_assessments").insert({ assessment_id: assessmentId, ...input.balance }));
  childInserts.push(
    supabase.from("physio_coordination_assessments").insert({ assessment_id: assessmentId, ...input.coordination })
  );

  const results = await Promise.all(childInserts);
  const failed = results.find((r) => r.error);

  if (failed) {
    console.error("Failed to save physio assessment child rows:", failed.error);
    // Best-effort cleanup so a partial save doesn't leave an orphan parent row.
    await supabase.from("physio_assessments").delete().eq("id", assessmentId);
    return { success: false, error: failed.error?.message ?? "Failed to save assessment details" };
  }

  revalidatePath(`/physiotherapy`);
  return { success: true };
}
