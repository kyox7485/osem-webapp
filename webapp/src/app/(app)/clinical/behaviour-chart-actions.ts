"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
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

export type BehaviourEpisode = {
  id: number;
  chart_id: number;
  resident_id: number;
  branch_id: number;
  category: string;
  behaviour: string;
  started_at: string | null; // null = untimed (behaviour observed, time not recorded)
  ended_at: string | null;
  note: string | null;
};

export type EpisodeInput = {
  category: "Verbal" | "Physical" | "Mood"; // Restraint is observation-level, not timed
  behaviour: string;
  startTime: string | null; // null = untimed
  endTime: string | null;
  note: string | null;
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
  episodes: EpisodeInput[];
};

const DISTURBANCE_LABELS: Record<number, string> = {
  0: "No disturb",
  1: "Occasionally sound",
  2: "Frequent sound (others can sleep)",
  3: "Frequent sound (others can't sleep)",
  4: "Persistent sound (disturbing activity)",
};

const TIME_ZONE = "Asia/Kuala_Lumpur";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const EPISODE_CATEGORY_CONFIG: Array<{ key: "Verbal" | "Physical" | "Mood"; icon: string; label: string }> = [
  { key: "Verbal", icon: "🗣️", label: "Verbal Behavior" },
  { key: "Physical", icon: "✋", label: "Physical Behavior" },
  { key: "Mood", icon: "😌", label: "Emotion/Mood" },
];

function buildEpisodeSections(episodes: EpisodeInput[]): string {
  const sections: string[] = [];
  for (const { key, icon, label } of EPISODE_CATEGORY_CONFIG) {
    const catEps = episodes.filter((ep) => ep.category === key);
    if (catEps.length === 0) continue;
    const lines: string[] = [`${icon} <b>${label}</b>`];
    for (const ep of catEps) {
      lines.push(`  • ${esc(ep.behaviour)}`);
      if (ep.startTime && ep.endTime) {
        lines.push(`    ${ep.startTime} – ${ep.endTime}`);
      } else {
        lines.push(`    Time not specified — observed during the day`);
      }
      if (ep.note) lines.push(`    Note: ${esc(ep.note)}`);
    }
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

function obsDateMYT(isoUtc: string): string {
  return new Date(isoUtc).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

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
  const branchId = resident.data.branch_id;

  const branchMeta = await supabase
    .from("tbl_branches")
    .select("telegram_chat_id")
    .eq("BranchID", branchId)
    .single();
  const branchChatId = branchMeta.data?.telegram_chat_id ?? null;

  const { data: chartData, error: chartError } = await supabase
    .from("tbl_behaviour_charts")
    .insert({
      branch_id: branchId,
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
    })
    .select("id")
    .single();

  if (chartError || !chartData) return { success: false, error: chartError?.message ?? "Insert failed" };

  // Save timed episodes if provided
  if (input.episodes.length > 0) {
    const obsDate = obsDateMYT(input.entryTimestamp);
    const episodeRows = input.episodes.map((ep) => ({
      chart_id: chartData.id,
      branch_id: branchId,
      resident_id: input.residentId,
      category: ep.category,
      behaviour: ep.behaviour,
      started_at: ep.startTime ? `${obsDate}T${ep.startTime}:00+08:00` : null,
      ended_at: ep.endTime ? `${obsDate}T${ep.endTime}:00+08:00` : null,
      note: ep.note || null,
    }));
    const { error: epError } = await supabase.from("tbl_behaviour_episodes").insert(episodeRows);
    if (epError) return { success: false, error: epError.message };
  }

  const staffLabel = input.createdByOther || input.createdByName || input.createdBy || "Unknown";

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

  const restraintLine =
    input.restraint.length > 0 ? input.restraint.map(esc).join(", ") : "Not on any restrain";

  const episodeSections = buildEpisodeSections(input.episodes);

  const lines = [
    `🔔 <b>Behaviour Chart Update</b>`,
    ``,
    `👤 <b>${esc(input.residentName)}</b>`,
    `📅 ${formatDateTime(input.entryTimestamp)}`,
    episodeSections ? `\n${episodeSections}` : null,
    ``,
    `🛌 <b>Rest &amp; Restraint</b>`,
    `  Sleep: ${sleepLine}`,
    `  Restraint: ${restraintLine}`,
    ``,
    `🤯 <b>Level of Disturbance:</b> ${disturbLine}`,
    input.complaints ? `\n💬 <b>Active Complaints:</b> ${esc(input.complaints)}` : null,
    ``,
    `✍️ Entered by: ${esc(staffLabel)}`,
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

  if (!canAccessAllBranches(account)) {
    query = query.eq("branch_id", account.branch_id);
  } else if (filters.excludedBranchIds && filters.excludedBranchIds.length > 0) {
    query = query.not("branch_id", "in", `(${filters.excludedBranchIds.join(",")})`);
  }

  if (filters.residentId) query = query.eq("resident_id", parseInt(filters.residentId));
  if (filters.start) query = query.gte("entry_timestamp", `${filters.start}T00:00:00`);
  if (filters.end) query = query.lte("entry_timestamp", `${filters.end}T23:59:59`);

  const { data, error } = await query;

  // Supabase returns joined rows as single-element arrays; unwrap them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: BehaviourEntry[] = (data ?? []).map((e: any) => ({
    ...e,
    tbl_residents: Array.isArray(e.tbl_residents) ? e.tbl_residents[0] : e.tbl_residents,
    tbl_staff: Array.isArray(e.tbl_staff) ? e.tbl_staff[0] : e.tbl_staff,
  }));

  return { entries, error: error?.message ?? null };
}

export async function getBehaviourEpisodes(filters: {
  residentId: string;
  start?: string;
  end?: string;
  excludedBranchIds?: number[];
}): Promise<{ episodes: BehaviourEpisode[]; error: string | null }> {
  if (!filters.residentId) return { episodes: [], error: null };

  const account = await getCurrentUser();
  if (!account) return { episodes: [], error: "Not authenticated" };

  const supabase = await createClient();

  let query = supabase
    .from("tbl_behaviour_episodes")
    .select("id, chart_id, resident_id, branch_id, category, behaviour, started_at, ended_at, note")
    .eq("resident_id", parseInt(filters.residentId))
    .order("started_at", { ascending: true });

  if (!canAccessAllBranches(account)) {
    query = query.eq("branch_id", account.branch_id);
  } else if (filters.excludedBranchIds && filters.excludedBranchIds.length > 0) {
    query = query.not("branch_id", "in", `(${filters.excludedBranchIds.join(",")})`);
  }

  if (filters.start) query = query.gte("started_at", `${filters.start}T00:00:00+08:00`);
  if (filters.end) query = query.lte("started_at", `${filters.end}T23:59:59+08:00`);

  const { data, error } = await query;

  return { episodes: (data ?? []) as BehaviourEpisode[], error: error?.message ?? null };
}
