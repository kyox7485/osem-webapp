"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { sendTelegramMessage } from "@/lib/telegram";
import { formatDateTime } from "@/lib/format-date";

export type BehaviourEntry = {
  id: number;
  resident_id: number;
  entry_timestamp: string;
  verbal_behavior: string[] | null;
  complaints: string | null;
  physical_behavior: string[] | null;
  sleep_from: string | null;
  sleep_to: string | null;
  restraint: string[] | null;
  emotion_mood: string[] | null;
  disturbance_level: number | null;
  created_by: string | null;
  created_by_other: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  tbl_staff: { StaffID: string; staff_name: string } | null;
};

type CreateBehaviourChartInput = {
  residentId: number;
  residentName: string;
  entryTimestamp: string;
  verbalBehavior: string[];
  complaints: string | null;
  physicalBehavior: string[];
  sleepFrom: string | null;
  sleepTo: string | null;
  restraint: string[];
  emotionMood: string[];
  disturbanceLevel: number | null;
  createdBy: string;
  createdByName: string | null;
  createdByOther: string | null;
};

const DISTURBANCE_LABELS: Record<number, string> = {
  0: "No disturb",
  1: "Occasionally sound",
  2: "Frequent sound (others can sleep)",
  3: "Frequent sound (others can't sleep)",
  4: "Persistent sound (disturbing activity)",
};

export async function createBehaviourChart(
  input: CreateBehaviourChartInput
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

  const { error } = await supabase.from("tbl_behaviour_charts").insert({
    branch_id: resident.data.branch_id,
    resident_id: input.residentId,
    entry_timestamp: input.entryTimestamp,
    verbal_behavior: input.verbalBehavior.length > 0 ? input.verbalBehavior : null,
    complaints: input.complaints || null,
    physical_behavior: input.physicalBehavior.length > 0 ? input.physicalBehavior : null,
    sleep_from: input.sleepFrom || null,
    sleep_to: input.sleepTo || null,
    restraint: input.restraint.length > 0 ? input.restraint : null,
    emotion_mood: input.emotionMood.length > 0 ? input.emotionMood : null,
    disturbance_level: input.disturbanceLevel,
    created_by: input.createdBy || null,
    created_by_other: input.createdByOther || null,
  });

  if (error) return { success: false, error: error.message };

  const staffLabel = input.createdByOther || input.createdByName || input.createdBy || "Unknown";
  const val = (v: string | null | undefined) => (v ? v : "--");
  const arr = (v: string[]) => (v.length > 0 ? v.join(", ") : "--");

  const sleepLine =
    input.sleepFrom && input.sleepTo
      ? `${input.sleepFrom} – ${input.sleepTo}`
      : input.sleepFrom || input.sleepTo
        ? input.sleepFrom ?? input.sleepTo
        : "--";

  const disturbLine =
    input.disturbanceLevel != null
      ? `${input.disturbanceLevel} – ${DISTURBANCE_LABELS[input.disturbanceLevel]}`
      : "--";

  const lines = [
    `🔔 <b>Behaviour Chart Update</b>`,
    ``,
    `👤 <b>${input.residentName}</b>`,
    `📅 ${formatDateTime(input.entryTimestamp)}`,
    ``,
    `🗣️ <b>Verbal Behavior:</b> ${arr(input.verbalBehavior)}`,
    input.complaints ? `💬 Complaints: ${input.complaints}` : null,
    ``,
    `✋ <b>Physical Behavior:</b> ${arr(input.physicalBehavior)}`,
    ``,
    `🛌 <b>Rest &amp; Restraint</b>`,
    `  Sleep: ${val(sleepLine)}`,
    `  Restraint: ${arr(input.restraint)}`,
    ``,
    `😌 <b>Emotion/Mood:</b> ${arr(input.emotionMood)}`,
    ``,
    `🤯 <b>Level of Disturbance:</b> ${disturbLine}`,
    ``,
    `✍️ Entered by: ${staffLabel}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendTelegramMessage(lines, branchChatId);

  return { success: true };
}

export async function getBehaviourCharts(filters: {
  residentId?: string;
  start?: string;
  end?: string;
  excludedBranchIds?: number[];
}): Promise<{ entries: BehaviourEntry[]; error: string | null }> {
  const account = await getCurrentUser();
  if (!account) return { entries: [], error: "Not authenticated" };

  const supabase = await createClient();

  let query = supabase
    .from("tbl_behaviour_charts")
    .select(
      `
      id, resident_id, entry_timestamp,
      verbal_behavior, complaints, physical_behavior,
      sleep_from, sleep_to, restraint, emotion_mood,
      disturbance_level, created_by, created_by_other,
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
