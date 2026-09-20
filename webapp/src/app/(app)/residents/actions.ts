"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { sendTelegramMessage } from "@/lib/telegram";

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
    // tbl_staff's PK is a text code (e.g. "AMN-1"), not a bigint.
    // When "Others" is selected the sentinel "__others__" is translated to
    // null here and the free-text name goes in reviewed_by_other instead.
    reviewed_by: (() => {
      const v = optional(formData.get("reviewed_by"));
      return v === "__others__" ? null : v;
    })(),
    reviewed_by_other: (() => {
      const v = optional(formData.get("reviewed_by"));
      return v === "__others__" ? optional(formData.get("reviewed_by_other")) : null;
    })(),
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
  if (!payload.reviewed_by && !payload.reviewed_by_other) {
    return { error: "Select who's entering this" };
  }

  const { data, error } = await supabase.from("tbl_residents").insert(payload).select("id").single();

  if (error) {
    return { error: error.message };
  }

  // Send Telegram notification to the branch group
  const branchMeta = await supabase
    .from("tbl_branches")
    .select("telegram_chat_id, BranchCode")
    .eq("BranchID", payload.branch_id)
    .single();
  const branchChatId = branchMeta.data?.telegram_chat_id ?? null;

  const reviewerLabel = payload.reviewed_by_other ?? payload.reviewed_by ?? "Unknown";
  const val = (v: string | number | null | undefined) => (v != null && v !== "" ? String(v) : "--");

  const lines = [
    `🏠 <b>New Resident Admitted</b>`,
    ``,
    `👤 <b>${payload.resident_name}</b>`,
    payload.ic_number ? `🪪 IC/Passport: ${payload.ic_number}` : null,
    payload.age ? `🎂 Age: ${payload.age}` : null,
    payload.gender ? `⚧ Gender: ${payload.gender}` : null,
    payload.care_type ? `🛏 Care type: ${payload.care_type}` : null,
    payload.admission_date ? `📅 Admission date: ${payload.admission_date}` : null,
    payload.transfer_from ? `🏥 Transfer from: ${payload.transfer_from}` : null,
    payload.allergy ? `⚠️ Allergy: ${payload.allergy}` : null,
    payload.past_medical_condition ? `📋 Medical history: ${payload.past_medical_condition}` : null,
    ``,
    `✍️ Entered by: ${reviewerLabel}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendTelegramMessage(lines, branchChatId);

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
  if (!payload.reviewed_by && !payload.reviewed_by_other) {
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
