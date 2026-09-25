"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { revalidatePath } from "next/cache";

export type ResidentReferralData = {
  ic_number: string | null;
  admission_date: string | null;
  emergency_contact: string | null;
  allergy: string | null;
  past_medical_condition: string | null;
  current_medication_list: string | null;
  mobility: string | null;
  feeding: string | null;
  hygiene: string | null;
};

// Background panel shown while filling a new referral -- same idea as the
// Medical Progress Notes dashboard, but pulling the fields the paper
// "Hospital Referral Note" needs (admission date, emergency contact,
// allergy, past history, current meds) plus the ADL snapshot fields
// (mobility/feeding/hygiene), which get copied onto the referral record
// itself below since a resident's condition at referral time shouldn't
// silently change if their profile is edited later.
export async function getResidentReferralData(residentId: number): Promise<ResidentReferralData | null> {
  const supabase = await createClient();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select(
      "ic_number, admission_date, emergency_contact, allergy, past_medical_condition, current_medication_list, mobility, hygiene, tbl_feeding_types(name)"
    )
    .eq("id", residentId)
    .single();

  if (!resident) return null;

  const feedingType = Array.isArray(resident.tbl_feeding_types) ? resident.tbl_feeding_types[0] : resident.tbl_feeding_types;

  return {
    ic_number: resident.ic_number,
    admission_date: resident.admission_date,
    emergency_contact: resident.emergency_contact,
    allergy: resident.allergy,
    past_medical_condition: resident.past_medical_condition,
    current_medication_list: resident.current_medication_list,
    mobility: resident.mobility,
    feeding: feedingType?.name ?? null,
    hygiene: resident.hygiene,
  };
}

type CreateHospitalReferralInput = {
  residentId: number;
  chiefComplaints: string;
  vitalSigns: string;
  mobility: string | null;
  feeding: string | null;
  hygiene: string | null;
  reviewedBy: string;
  reviewedByOther?: string | null;
};

export async function createHospitalReferral(input: CreateHospitalReferralInput): Promise<{ success: boolean; error?: string; id?: number }> {
  const account = await getCurrentUser();
  if (!account) {
    return { success: false, error: "Not authenticated" };
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

  if (!canAccessAllBranches(account) && resident.branch_id !== account.branch_id) {
    return { success: false, error: "Access denied" };
  }

  const { data, error } = await supabase
    .from("tbl_hospital_referrals")
    .insert({
      branch_id: resident.branch_id,
      resident_id: input.residentId,
      chief_complaints: input.chiefComplaints,
      vital_signs: input.vitalSigns,
      mobility: input.mobility,
      feeding: input.feeding,
      hygiene: input.hygiene,
      reviewed_by: input.reviewedBy || null,
      reviewed_by_other: input.reviewedByOther || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create hospital referral:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/clinical");
  return { success: true, id: data.id };
}
