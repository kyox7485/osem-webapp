"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { revalidatePath } from "next/cache";

const PLAN_FIELDS = [
  ["medical", "medical_plan"],
  ["nursing", "nursing_plan"],
  ["diet", "feeding_plan"],
  ["dressing", "dressing_plan"],
  ["monitoring", "monitoring_plan"],
  ["physio", "physio_plan"],
] as const;

type PlanEntry = { entry_timestamp: string; value: string } | null;

export type ResidentDashboardData = {
  allergy: string | null;
  pastMedicalCondition: string | null;
  currentMedicationList: string | null;
  tcaNotes: string | null;
  vitals: {
    entry_timestamp: string;
    systolic_bp: number | null;
    diastolic_bp: number | null;
    heart_rate: number | null;
    temperature: number | null;
    spo2: number | null;
    spo2_condition: string | null;
  }[];
  plans: Record<(typeof PLAN_FIELDS)[number][0], PlanEntry>;
};

// Same quick-glance panel data as the per-resident Medical Progress Notes
// page (residents/[id]/progress-notes) -- reused here so the inline "New
// entry" form in the Clinical tab has the same history/medication/allergy/
// TCA/vitals/last-ordered-plans context, without navigating away.
export async function getResidentDashboardData(residentId: number): Promise<ResidentDashboardData | null> {
  const supabase = await createClient();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("allergy, past_medical_condition, current_medication_list, tca_notes")
    .eq("id", residentId)
    .single();

  if (!resident) return null;

  const [{ data: notes }, { data: vitals }] = await Promise.all([
    supabase
      .from("tbl_progress_notes")
      .select("entry_timestamp, medical_plan, nursing_plan, feeding_plan, dressing_plan, monitoring_plan, physio_plan")
      .eq("resident_id", residentId)
      .order("entry_timestamp", { ascending: false }),
    supabase
      .from("tbl_vital")
      .select("entry_timestamp, systolic_bp, diastolic_bp, heart_rate, temperature, spo2, spo2_condition")
      .eq("resident_id", residentId)
      .order("entry_timestamp", { ascending: false })
      .limit(10),
  ]);

  const plans = Object.fromEntries(
    PLAN_FIELDS.map(([key, column]) => {
      const match = notes?.find((n: any) => n[column]);
      return [key, match ? { entry_timestamp: match.entry_timestamp, value: match[column] as string } : null];
    })
  ) as Record<(typeof PLAN_FIELDS)[number][0], PlanEntry>;

  return {
    allergy: resident.allergy,
    pastMedicalCondition: resident.past_medical_condition,
    currentMedicationList: resident.current_medication_list,
    tcaNotes: resident.tca_notes,
    vitals: vitals ?? [],
    plans,
  };
}

type CreateProgressNoteInput = {
  residentId: number;
  progressNote: string;
  physicalExamination: string | null;
  medicalPlan: string | null;
  nursingPlan: string | null;
  feedingPlan: string | null;
  monitoringPlan: string | null;
  dressingPlan: string | null;
  physioPlan: string | null;
  createdBy: string;
  createdByOther?: string | null;
};

export async function createProgressNote(input: CreateProgressNoteInput): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) {
    return { success: false, error: "Not authenticated" };
  }

  const supabase = await createClient();

  // Get resident's branch_id
  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("branch_id")
    .eq("id", input.residentId)
    .single();

  if (!resident) {
    return { success: false, error: "Resident not found" };
  }

  // Non-admin users can only add notes for their own branch residents
  if (account.rights !== "ADMIN" && resident.branch_id !== account.branch_id) {
    return { success: false, error: "Access denied" };
  }

  const { error } = await supabase.from("tbl_progress_notes").insert({
    branch_id: resident.branch_id,
    resident_id: input.residentId,
    progress_note: input.progressNote,
    physical_examination: input.physicalExamination,
    medical_plan: input.medicalPlan,
    nursing_plan: input.nursingPlan,
    feeding_plan: input.feedingPlan,
    monitoring_plan: input.monitoringPlan,
    dressing_plan: input.dressingPlan,
    physio_plan: input.physioPlan,
    reviewed_by: input.createdBy || null,
    created_by: input.createdBy || null,
    created_by_other: input.createdByOther || null,
  });

  if (error) {
    console.error("Failed to create progress note:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/clinical");
  return { success: true };
}
