"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";

export type ObservationStatusRow = {
  id: number;
  resident_id: number;
  branch_id: number;
  started_at: string;
  started_by: string | null;
  started_by_other: string | null;
  ended_at: string | null;
  ended_by: string | null;
  ended_by_other: string | null;
  end_reason: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  starter: { StaffID: string; staff_name: string } | null;
  ender: { StaffID: string; staff_name: string } | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapEpisode(e: any): ObservationStatusRow {
  return {
    ...e,
    tbl_residents: Array.isArray(e.tbl_residents) ? e.tbl_residents[0] : e.tbl_residents,
    starter: Array.isArray(e.starter) ? e.starter[0] : e.starter,
    ender: Array.isArray(e.ender) ? e.ender[0] : e.ender,
  };
}

export async function getActiveObservationStatuses(filters: {
  excludedBranchIds?: number[];
}): Promise<{ episodes: ObservationStatusRow[]; error: string | null }> {
  const account = await getCurrentUser();
  if (!account) return { episodes: [], error: "Not authenticated" };

  const supabase = await createClient();

  // Typed as `any`: the double self-join to tbl_staff (started_by + ended_by
  // aliases) pushes Supabase's generated row type past TS's instantiation
  // depth limit (TS2589) when chained with the conditional filters below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("tbl_observation_status")
    .select(
      `
      id, resident_id, branch_id, started_at, started_by, started_by_other,
      ended_at, ended_by, ended_by_other, end_reason,
      tbl_residents!resident_id(id, resident_name, branch_id),
      starter:tbl_staff!started_by(StaffID, staff_name),
      ender:tbl_staff!ended_by(StaffID, staff_name)
    `
    )
    .is("ended_at", null)
    .order("started_at", { ascending: false });

  if (account.rights !== "ADMIN") {
    query = query.eq("branch_id", account.branch_id);
  } else if (filters.excludedBranchIds && filters.excludedBranchIds.length > 0) {
    query = query.not("branch_id", "in", `(${filters.excludedBranchIds.join(",")})`);
  }

  const { data, error } = await query;
  return { episodes: (data ?? []).map(unwrapEpisode), error: error?.message ?? null };
}

export async function getCompletedObservationEpisodes(filters: {
  excludedBranchIds?: number[];
}): Promise<{ episodes: ObservationStatusRow[]; error: string | null }> {
  const account = await getCurrentUser();
  if (!account) return { episodes: [], error: "Not authenticated" };

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("tbl_observation_status")
    .select(
      `
      id, resident_id, branch_id, started_at, started_by, started_by_other,
      ended_at, ended_by, ended_by_other, end_reason,
      tbl_residents!resident_id(id, resident_name, branch_id),
      starter:tbl_staff!started_by(StaffID, staff_name),
      ender:tbl_staff!ended_by(StaffID, staff_name)
    `
    )
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false });

  if (account.rights !== "ADMIN") {
    query = query.eq("branch_id", account.branch_id);
  } else if (filters.excludedBranchIds && filters.excludedBranchIds.length > 0) {
    query = query.not("branch_id", "in", `(${filters.excludedBranchIds.join(",")})`);
  }

  const { data, error } = await query;
  return { episodes: (data ?? []).map(unwrapEpisode), error: error?.message ?? null };
}

export async function startObservation(input: {
  residentId: number;
  startedBy: string;
  startedByOther: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();

  const resident = await supabase
    .from("tbl_residents")
    .select("branch_id")
    .eq("id", input.residentId)
    .single();

  if (!resident.data) return { success: false, error: "Resident not found" };

  const { error } = await supabase.from("tbl_observation_status").insert({
    resident_id: input.residentId,
    branch_id: resident.data.branch_id,
    started_by: input.startedBy || null,
    started_by_other: input.startedByOther || null,
  });

  if (error) {
    if (error.code === "23505") return { success: false, error: "Resident is already under observation" };
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function endObservation(input: {
  episodeId: number;
  endedBy: string;
  endedByOther: string | null;
  endReason: string;
}): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();

  const { error } = await supabase
    .from("tbl_observation_status")
    .update({
      ended_at: new Date().toISOString(),
      ended_by: input.endedBy || null,
      ended_by_other: input.endedByOther || null,
      end_reason: input.endReason,
    })
    .eq("id", input.episodeId)
    .is("ended_at", null);

  if (error) return { success: false, error: error.message };

  return { success: true };
}
