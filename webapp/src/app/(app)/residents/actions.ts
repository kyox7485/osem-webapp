"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";

function optional(value: FormDataEntryValue | null): string | null {
  const s = value?.toString().trim();
  return s ? s : null;
}

function optionalInt(value: FormDataEntryValue | null): number | null {
  const s = optional(value);
  return s ? parseInt(s, 10) : null;
}

function buildResidentPayload(formData: FormData) {
  return {
    branch_id: optionalInt(formData.get("branch_id")),
    resident_name: (formData.get("resident_name") as string)?.trim(),
    ic_number: optional(formData.get("ic_number")),
    age: optionalInt(formData.get("age")),
    nationality_id: optionalInt(formData.get("nationality_id")),
    gender: optional(formData.get("gender")),
    marital_status: optional(formData.get("marital_status")),
    status: (formData.get("status") as string) || "ACTIVE",
    care_type: optional(formData.get("care_type")),
    admission_date: optional(formData.get("admission_date")),
    discharge_date: optional(formData.get("discharge_date")),
    transfer_from: optional(formData.get("transfer_from")),
    accompanied_by: optional(formData.get("accompanied_by")),
    emergency_contact: optional(formData.get("emergency_contact")),
    allergy: optional(formData.get("allergy")),
    past_medical_condition: optional(formData.get("past_medical_condition")),
    current_medication_list: optional(formData.get("current_medication_list")),
    mobility: optional(formData.get("mobility")),
    feeding_type_id: optionalInt(formData.get("feeding_type_id")),
    hygiene: optional(formData.get("hygiene")),
    diet_type_id: optionalInt(formData.get("diet_type_id")),
    tca_notes: optional(formData.get("tca_notes")),
    assessment_and_summary: optional(formData.get("assessment_and_summary")),
    // Explicitly picked on the form -- never inferred from the logged-in
    // account, since branch logins can be shared by multiple people.
    reviewed_by: optionalInt(formData.get("reviewed_by")),
  };
}

export async function createResident(formData: FormData) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const supabase = await createClient();
  const payload = buildResidentPayload(formData);

  if (!payload.resident_name) {
    return { error: "Resident name is required" };
  }
  if (!payload.branch_id) {
    return { error: "Branch is required" };
  }
  if (!payload.reviewed_by) {
    return { error: "Select who's entering this" };
  }

  const { data, error } = await supabase.from("tbl_residents").insert(payload).select("id").single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/residents");
  redirect(`/residents/${data.id}`);
}

export async function updateResident(residentId: number, formData: FormData) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const supabase = await createClient();
  const payload = buildResidentPayload(formData);

  if (!payload.resident_name) {
    return { error: "Resident name is required" };
  }
  if (!payload.branch_id) {
    return { error: "Branch is required" };
  }
  if (!payload.reviewed_by) {
    return { error: "Select who's entering this" };
  }

  const { error } = await supabase.from("tbl_residents").update(payload).eq("id", residentId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/residents");
  revalidatePath(`/residents/${residentId}`);
  redirect(`/residents/${residentId}`);
}
