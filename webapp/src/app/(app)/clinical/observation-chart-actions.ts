"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { sendTelegramMessage } from "@/lib/telegram";
import { formatDateTime } from "@/lib/format-date";

export type ObservationEntry = {
  id: number;
  resident_id: number;
  entry_timestamp: string;
  active_issue: string | null;
  sob_cough: boolean | null;
  pain: boolean | null;
  pain_location: string | null;
  wound: string | null;
  appetite: string | null;
  vomiting: boolean | null;
  diarrhea: boolean | null;
  urine: string | null;
  behavior: string[] | null;
  behavior_other: string | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  spo2_condition: string | null;
  dxt: number | null;
  avpu: string | null;
  created_by: string | null;
  created_by_other: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  tbl_staff: { StaffID: string; staff_name: string } | null;
};

export type LatestVitals = {
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  spo2_condition: string | null;
  dxt: number | null;
  avpu_label: string | null;
};

export async function getLatestVitalsForResident(residentId: number): Promise<LatestVitals | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("tbl_vital")
    .select("systolic_bp, diastolic_bp, heart_rate, temperature, spo2, spo2_condition, dxt, avpu_id, tbl_avpu_options!avpu_id(label)")
    .eq("resident_id", residentId)
    .order("entry_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const avpuRaw = data.tbl_avpu_options;
  const avpuLabel = Array.isArray(avpuRaw) ? avpuRaw[0]?.label : (avpuRaw as any)?.label;

  return {
    systolic_bp: data.systolic_bp,
    diastolic_bp: data.diastolic_bp,
    heart_rate: data.heart_rate,
    temperature: data.temperature,
    spo2: data.spo2,
    spo2_condition: data.spo2_condition,
    dxt: data.dxt,
    avpu_label: avpuLabel ?? null,
  };
}

type CreateObservationChartInput = {
  residentId: number;
  residentName: string;
  entryTimestamp: string;
  activeIssue: string | null;
  sobCough: boolean | null;
  pain: boolean | null;
  painLocation: string | null;
  wound: string | null;
  appetite: string | null;
  vomiting: boolean | null;
  diarrhea: boolean | null;
  urine: string | null;
  behavior: string[];
  behaviorOther: string | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  temperature: number | null;
  spo2: number | null;
  spo2Condition: string | null;
  dxt: number | null;
  avpu: string | null;
  createdBy: string;
  createdByName: string | null;
  createdByOther: string | null;
};

export async function createObservationChart(
  input: CreateObservationChartInput
): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();

  const resident = await supabase
    .from("tbl_residents")
    .select("branch_id")
    .eq("id", input.residentId)
    .single();

  if (!resident.data) return { success: false, error: "Resident not found" };

  const branchMeta = await supabase
    .from("tbl_branches")
    .select("telegram_chat_id")
    .eq("BranchID", resident.data.branch_id)
    .single();
  const branchChatId = branchMeta.data?.telegram_chat_id ?? null;

  const { error } = await supabase.from("tbl_observation_charts").insert({
    branch_id: resident.data.branch_id,
    resident_id: input.residentId,
    entry_timestamp: input.entryTimestamp,
    active_issue: input.activeIssue || null,
    sob_cough: input.sobCough,
    pain: input.pain,
    pain_location: input.painLocation || null,
    wound: input.wound || null,
    appetite: input.appetite || null,
    vomiting: input.vomiting,
    diarrhea: input.diarrhea,
    urine: input.urine || null,
    behavior: input.behavior.length > 0 ? input.behavior : null,
    behavior_other: input.behaviorOther || null,
    systolic_bp: input.systolicBp,
    diastolic_bp: input.diastolicBp,
    heart_rate: input.heartRate,
    temperature: input.temperature,
    spo2: input.spo2,
    spo2_condition: input.spo2Condition || null,
    dxt: input.dxt,
    avpu: input.avpu || null,
    created_by: input.createdBy || null,
    created_by_other: input.createdByOther || null,
  });

  if (error) return { success: false, error: error.message };

  // Send Telegram notification (silently no-ops if bot not configured)
  const staffLabel = input.createdByOther || input.createdByName || input.createdBy || "Unknown";
  const yesNo = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "--");
  const val = (v: string | number | null | undefined) => (v != null && v !== "" ? String(v) : "--");
  const behaviorLine = [
    ...(input.behavior ?? []),
    ...(input.behaviorOther ? [`Others: ${input.behaviorOther}`] : []),
  ].join(", ") || "--";

  const lines = [
    `🔔 <b>Observation Chart Update</b>`,
    ``,
    `👤 <b>${input.residentName}</b>`,
    `📅 ${formatDateTime(input.entryTimestamp)}`,
    input.activeIssue ? `⚠️ <b>Active Issue:</b> ${input.activeIssue}` : null,
    ``,
    `📋 <b>Nursing Assessment</b>`,
    `🫁 SOB / Cough: ${yesNo(input.sobCough)}`,
    `⚡ Pain: ${yesNo(input.pain)}${input.pain && input.painLocation ? ` — ${input.painLocation}` : ""}`,
    `🤕 Wound: ${val(input.wound)}`,
    `🥣 Appetite: ${val(input.appetite)}`,
    `🤮 Vomiting: ${yesNo(input.vomiting)}`,
    `💩 Diarrhea: ${yesNo(input.diarrhea)}`,
    `💧 Urine: ${val(input.urine)}`,
    `🧠 Behavior: ${behaviorLine}`,
    ``,
    `📊 <b>Vital Signs</b>`,
    `BP: ${val(input.systolicBp)}/${val(input.diastolicBp)} mmHg`,
    `HR: ${val(input.heartRate)} bpm`,
    `Temp: ${val(input.temperature)}°C`,
    `SpO₂: ${val(input.spo2)}%${input.spo2Condition ? ` (${input.spo2Condition})` : ""}`,
    input.dxt != null ? `DXT: ${input.dxt} mmol/L` : null,
    `AVPU: ${val(input.avpu)}`,
    ``,
    `✍️ Entered by: ${staffLabel}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendTelegramMessage(lines, branchChatId);

  return { success: true };
}

export async function getObservationChartsForResidents(filters: {
  residentIds: number[];
  start?: string;
  end?: string;
  excludedBranchIds?: number[];
}): Promise<{ entries: ObservationEntry[]; error: string | null }> {
  if (filters.residentIds.length === 0) return { entries: [], error: null };

  const account = await getCurrentUser();
  if (!account) return { entries: [], error: "Not authenticated" };

  const supabase = await createClient();

  let query = supabase
    .from("tbl_observation_charts")
    .select(
      `
      id, resident_id, entry_timestamp, active_issue,
      sob_cough, pain, pain_location, wound, appetite,
      vomiting, diarrhea, urine, behavior, behavior_other,
      systolic_bp, diastolic_bp, heart_rate, temperature,
      spo2, spo2_condition, dxt, avpu,
      created_by, created_by_other,
      tbl_residents!resident_id(id, resident_name, branch_id),
      tbl_staff!created_by(StaffID, staff_name)
    `
    )
    .in("resident_id", filters.residentIds)
    .order("entry_timestamp", { ascending: false });

  if (account.rights !== "ADMIN") {
    query = query.eq("branch_id", account.branch_id);
  } else if (filters.excludedBranchIds && filters.excludedBranchIds.length > 0) {
    query = query.not("branch_id", "in", `(${filters.excludedBranchIds.join(",")})`);
  }

  if (filters.start) query = query.gte("entry_timestamp", `${filters.start}T00:00:00`);
  if (filters.end) query = query.lte("entry_timestamp", `${filters.end}T23:59:59`);

  const { data, error } = await query;

  const entries = (data ?? []).map((e: any) => ({
    ...e,
    tbl_residents: Array.isArray(e.tbl_residents) ? e.tbl_residents[0] : e.tbl_residents,
    tbl_staff: Array.isArray(e.tbl_staff) ? e.tbl_staff[0] : e.tbl_staff,
  }));

  return { entries, error: error?.message ?? null };
}

export async function getObservationCharts(filters: {
  residentId?: string;
  start?: string;
  end?: string;
  excludedBranchIds?: number[];
}): Promise<{ entries: ObservationEntry[]; error: string | null }> {
  const account = await getCurrentUser();
  if (!account) return { entries: [], error: "Not authenticated" };

  const supabase = await createClient();

  let query = supabase
    .from("tbl_observation_charts")
    .select(
      `
      id, resident_id, entry_timestamp, active_issue,
      sob_cough, pain, pain_location, wound, appetite,
      vomiting, diarrhea, urine, behavior, behavior_other,
      systolic_bp, diastolic_bp, heart_rate, temperature,
      spo2, spo2_condition, dxt, avpu,
      created_by, created_by_other,
      tbl_residents!resident_id(id, resident_name, branch_id),
      tbl_staff!created_by(StaffID, staff_name)
    `
    )
    .order("entry_timestamp", { ascending: false });

  if (account.rights !== "ADMIN") {
    query = query.eq("branch_id", account.branch_id);
  } else if (filters.excludedBranchIds && filters.excludedBranchIds.length > 0) {
    query = query.not("branch_id", "in", `(${filters.excludedBranchIds.join(",")})`);
  }

  if (filters.residentId) query = query.eq("resident_id", parseInt(filters.residentId));
  if (filters.start) query = query.gte("entry_timestamp", `${filters.start}T00:00:00`);
  if (filters.end) query = query.lte("entry_timestamp", `${filters.end}T23:59:59`);

  const { data, error } = await query;

  const entries = (data ?? []).map((e: any) => ({
    ...e,
    tbl_residents: Array.isArray(e.tbl_residents) ? e.tbl_residents[0] : e.tbl_residents,
    tbl_staff: Array.isArray(e.tbl_staff) ? e.tbl_staff[0] : e.tbl_staff,
  }));

  return { entries, error: error?.message ?? null };
}
