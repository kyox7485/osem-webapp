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
    mobility: optional(formData.get("mobility")),
    feeding_type_id: optionalInt(formData.get("feeding_type_id")),
    hygiene: optional(formData.get("hygiene")),
    diet_type_id: optionalInt(formData.get("diet_type_id")),
    tca_notes: optional(formData.get("tca_notes")),
    assessment_and_summary: optional(formData.get("assessment_and_summary")),
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

function readDiagnosisFormData(formData: FormData) {
  const ids = formData.getAll("diagnosis_option_ids")
    .map((v) => parseInt(String(v), 10))
    .filter((n) => !isNaN(n));
  const labels = formData.getAll("diagnosis_option_labels").map(String);
  const othersRemark = optional(formData.get("diagnosis_others_remark"));
  return { ids, labels, othersRemark };
}

export async function createResident(formData: FormData) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const supabase = await createClient();
  const payload = buildResidentPayload(formData);
  const { ids: diagnosisIds, labels: diagnosisLabels, othersRemark } = readDiagnosisFormData(formData);

  if (!payload.resident_name) {
    return { error: "Resident name is required" };
  }
  if (!payload.branch_id) {
    return { error: "Branch is required" };
  }
  if (!payload.reviewed_by && !payload.reviewed_by_other) {
    return { error: "Select who's entering this" };
  }
  if (payload.status && payload.status !== "ACTIVE" && !payload.discharge_date) {
    return { error: "Discharge date is required when status is not Active" };
  }

  const { data, error } = await supabase.from("tbl_residents").insert(payload).select("id").single();

  if (error) {
    return { error: error.message };
  }

  // Insert structured diagnoses
  if (diagnosisIds.length > 0) {
    const othersIdx = diagnosisLabels.findIndex((l) => l === "Others");
    const othersId = othersIdx >= 0 ? diagnosisIds[othersIdx] : null;
    const diagnosisRows = diagnosisIds.map((diagnosis_option_id) => ({
      resident_id: data.id,
      diagnosis_option_id,
      remark: diagnosis_option_id === othersId ? othersRemark ?? null : null,
    }));
    await supabase.from("tbl_resident_diagnoses").insert(diagnosisRows);
  }

  // Send Telegram notification
  const [branchMeta, staffRow, feedingTypeRow] = await Promise.all([
    supabase.from("tbl_branches").select("telegram_chat_id").eq("BranchID", payload.branch_id).single(),
    payload.reviewed_by
      ? supabase.from("tbl_staff").select("staff_name").eq("StaffID", payload.reviewed_by).single()
      : Promise.resolve({ data: null }),
    payload.feeding_type_id
      ? supabase.from("tbl_feeding_types").select("name").eq("id", payload.feeding_type_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const branchChatId = branchMeta.data?.telegram_chat_id ?? null;
  const reviewerLabel = payload.reviewed_by_other ?? (staffRow as any).data?.staff_name ?? payload.reviewed_by ?? "Unknown";
  const feedingTypeLabel = (feedingTypeRow as any).data?.name ?? null;

  const val = (v: string | number | null | undefined) => (v != null && v !== "" ? String(v) : "--");
  const diagnosisLine = diagnosisLabels.length > 0
    ? diagnosisLabels.map((l) => l === "Others" && othersRemark ? `Others: ${othersRemark}` : l).join(", ")
    : "--";

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
    `🩺 Known medical/surgical history: ${diagnosisLine}`,
    ``,
    `🧍 Mobility: ${val(payload.mobility)}`,
    `🚿 Hygiene: ${val(payload.hygiene)}`,
    feedingTypeLabel ? `🥣 Feeding type: ${feedingTypeLabel}` : null,
    payload.assessment_and_summary ? `📝 Assessment & Summary: ${payload.assessment_and_summary}` : null,
    ``,
    `✍️ Entered by: ${reviewerLabel}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendTelegramMessage(lines, branchChatId);

  revalidatePath("/residents");
  redirect(`/residents/${data.id}`);
}

export async function dischargeResident(residentId: number, formData: FormData) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const status = formData.get("status") as string;
  const dischargeDate = optional(formData.get("discharge_date"));
  const dischargedBy = optional(formData.get("discharged_by"));
  const dischargedByOther = optional(formData.get("discharged_by_other"));

  if (!status || status === "ACTIVE") {
    return { error: "Please select a discharge status" };
  }
  if (!dischargeDate) {
    return { error: "Discharge date is required" };
  }
  if (!dischargedBy && !dischargedByOther) {
    return { error: "Please select who is recording this discharge" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tbl_residents")
    .update({ status, discharge_date: dischargeDate })
    .eq("id", residentId);

  if (error) return { error: error.message };

  revalidatePath("/residents");
  revalidatePath(`/residents/${residentId}`);
  redirect(`/residents/${residentId}`);
}

export async function updateResident(residentId: number, formData: FormData) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const supabase = await createClient();
  const payload = buildResidentPayload(formData);
  const { ids: diagnosisIds, othersRemark } = readDiagnosisFormData(formData);

  if (!payload.resident_name) {
    return { error: "Resident name is required" };
  }
  if (!payload.branch_id) {
    return { error: "Branch is required" };
  }
  if (!payload.reviewed_by && !payload.reviewed_by_other) {
    return { error: "Select who's entering this" };
  }
  if (payload.status && payload.status !== "ACTIVE" && !payload.discharge_date) {
    return { error: "Discharge date is required when status is not Active" };
  }

  const { error } = await supabase.from("tbl_residents").update(payload).eq("id", residentId);

  if (error) {
    return { error: error.message };
  }

  // Replace diagnoses: delete existing then re-insert
  await supabase.from("tbl_resident_diagnoses").delete().eq("resident_id", residentId);
  if (diagnosisIds.length > 0) {
    // Get the "Others" option id by checking labels (not available here, use a quick lookup)
    const { data: othersOpt } = await supabase
      .from("tbl_diagnosis_options")
      .select("id")
      .eq("name_en", "Others")
      .single();
    const othersId = othersOpt?.id ?? null;
    const diagnosisRows = diagnosisIds.map((diagnosis_option_id) => ({
      resident_id: residentId,
      diagnosis_option_id,
      remark: diagnosis_option_id === othersId ? othersRemark ?? null : null,
    }));
    await supabase.from("tbl_resident_diagnoses").insert(diagnosisRows);
  }

  revalidatePath("/residents");
  revalidatePath(`/residents/${residentId}`);
  redirect(`/residents/${residentId}`);
}
