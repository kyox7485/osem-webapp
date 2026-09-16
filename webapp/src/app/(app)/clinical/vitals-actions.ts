"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { revalidatePath } from "next/cache";

type CreateVitalInput = {
  residentId: number;
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  temperature: number | null;
  spo2: number | null;
  spo2Condition: string | null;
  dxt: number | null;
  dxtRemark: string | null;
  insulinAdjustment: string | null;
  reviewedBy: string;
};

export async function createVital(input: CreateVitalInput): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) {
    return { success: false, error: "Not authenticated" };
  }

  if (!input.reviewedBy) {
    return { success: false, error: "Reviewed by is required" };
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

  // Non-admin users can only add vitals for their own branch residents
  if (account.rights !== "ADMIN" && resident.branch_id !== account.branch_id) {
    return { success: false, error: "Access denied" };
  }

  const { error } = await supabase.from("tbl_vital").insert({
    branch_id: resident.branch_id,
    resident_id: input.residentId,
    systolic_bp: input.systolicBp,
    diastolic_bp: input.diastolicBp,
    heart_rate: input.heartRate,
    temperature: input.temperature,
    spo2: input.spo2,
    spo2_condition: input.spo2Condition,
    dxt: input.dxt,
    dxt_remark: input.dxtRemark,
    insulin_adjustment: input.insulinAdjustment,
    reviewed_by: input.reviewedBy,
  });

  if (error) {
    console.error("Failed to create vital:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/clinical");
  return { success: true };
}
