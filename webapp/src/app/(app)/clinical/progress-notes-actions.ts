"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { revalidatePath } from "next/cache";

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
  reviewedBy: string | null;
  createdBy: string;
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
    reviewed_by: input.reviewedBy,
    created_by: input.createdBy,
  });

  if (error) {
    console.error("Failed to create progress note:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/clinical");
  return { success: true };
}
