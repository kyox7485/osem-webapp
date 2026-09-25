"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getPhysioIpBranchIds } from "@/lib/lookups";
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

type CreateOpPatientInput = {
  patientName: string;
  icNumber: string | null;
  age: number | null;
  gender: "M" | "F" | null;
  contact: string | null;
};

// Lets a physiotherapist register a walk-in outpatient right from the
// Outpatient tab, without going through the (resident-only) Residents
// module -- OP patients aren't residents, they live in their own table.
// Scoped to the logged-in account's own branch, same as every other
// branch-scoped write in this app.
export async function createOpPatient(
  input: CreateOpPatientInput
): Promise<{ success: boolean; error?: string; id?: number }> {
  const account = await getCurrentUser();
  if (!account) {
    return { success: false, error: "Not authenticated" };
  }

  const patientName = input.patientName.trim();
  if (!patientName) {
    return { success: false, error: "Patient name is required" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tbl_physio_op_patients")
    .insert({
      branch_id: account.branch_id,
      patient_name: patientName,
      ic_number: input.icNumber,
      age: input.age,
      gender: input.gender,
      contact: input.contact,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Failed to register patient" };
  }

  revalidatePath("/physiotherapy");
  return { success: true, id: data.id };
}

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
  documentedByOther?: string | null;
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

  if (!input.documentedBy && !input.documentedByOther) {
    return { success: false, error: "Documented by is required" };
  }

  const supabase = await createClient();

  // IP patients are tbl_residents rows; OP patients live in the separate
  // tbl_physio_op_patients table (their own id space -- see physio_assessments'
  // resident_id/op_patient_id split). Same shape either way, just a
  // different source table to check branch access against.
  const patientTable = input.careSetting === "OP" ? "tbl_physio_op_patients" : "tbl_residents";
  const { data: patient } = await supabase
    .from(patientTable)
    .select("branch_id")
    .eq("id", input.residentId)
    .single();

  if (!patient) {
    return { success: false, error: input.careSetting === "OP" ? "Patient not found" : "Resident not found" };
  }

  const allowedBranchIds =
    canAccessAllBranches(account)
      ? null
      : input.careSetting === "OP"
        ? [account.branch_id]
        : await getPhysioIpBranchIds(account);

  if (allowedBranchIds && !allowedBranchIds.includes(patient.branch_id)) {
    return { success: false, error: "Access denied" };
  }

  const totalScore = computePhysioScore(input.examRows, input.functional, input.balance, input.coordination);

  const { data: assessment, error: assessmentError } = await supabase
    .from("physio_assessments")
    .insert({
      branch_id: patient.branch_id,
      resident_id: input.careSetting === "OP" ? null : input.residentId,
      op_patient_id: input.careSetting === "OP" ? input.residentId : null,
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
      documented_by: input.documentedBy || null,
      documented_by_other: input.documentedByOther || null,
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
