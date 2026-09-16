"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { revalidatePath } from "next/cache";
import type { LookupOption } from "@/lib/types";

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
  reviewedBy: string | null;
};

export async function getStaffForResident(residentId: number): Promise<LookupOption[]> {
  try {
    const supabase = await createClient();

    // First get the resident's branch
    const { data: resident, error: residentError } = await supabase
      .from("tbl_residents")
      .select("branch_id")
      .eq("id", residentId)
      .single();

    console.log("[getStaffForResident] Resident query:", { residentId, resident, residentError });

    if (residentError) {
      console.error("[getStaffForResident] Failed to fetch resident:", residentError);
      return [];
    }

    if (!resident) {
      console.error("[getStaffForResident] No resident found");
      return [];
    }

    // Then get active staff from that branch
    const { data, error } = await supabase
      .from("tbl_staff")
      .select("*")
      .eq("branch_id", resident.branch_id)
      .eq("status", "ACTIVE")
      .order("staff_name");

    console.log("[getStaffForResident] Staff query:", { branch_id: resident.branch_id, data, error });

    if (error) {
      console.error("[getStaffForResident] Failed to fetch staff:", error);
      return [];
    }

    const result = (data ?? []).map((r: any) => ({ id: r.StaffID, label: r.staff_name }));
    console.log("[getStaffForResident] Returning:", result);
    return result;
  } catch (err) {
    console.error("[getStaffForResident] Unexpected error:", err);
    return [];
  }
}

export async function createVital(input: CreateVitalInput): Promise<{ success: boolean; error?: string }> {
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

  revalidatePath("/vitals");
  return { success: true };
}
