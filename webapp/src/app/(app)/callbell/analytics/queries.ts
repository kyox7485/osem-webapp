// Server-side aggregation for the Call Bell analytics dashboard.
//
// Everything is done in Postgres (counts, timings, buckets) and reduced to
// plain summary numbers before it reaches the browser — the dashboard never
// ships raw call rows, so it stays fast with a large call history.
//
// Only ONE narrow range is read (the selected branch × selected date range)
// plus, for all-branch accounts, the same range across every permitted branch
// for the comparison table.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeBellVolume,
  computeCallsByHour,
  computeFrequentPatterns,
  computeKpis,
  computeResponseBuckets,
  summariseDisarms,
  toCallEvent,
  type BellRow,
  type BranchStat,
  type CallEvent,
  type CallKpis,
  type DateRange,
  type DisarmEvent,
  type DisarmSummary,
  type HourRow,
  type PatternRow,
  type ResponseBucket,
} from "./data";

const DAY_MS = 24 * 60 * 60_000;

const CALL_COLUMNS =
  "id, receiver_id, device_num, resident_name_snapshot, resident_nickname, call_time, response_time, is_cancel_call";

/**
 * Call events for one branch over `range`, excluding rows whose receiver stores
 * its own cancel-button record (a response, not a call).
 */
async function fetchCalls(
  supabase: SupabaseClient,
  receiverIds: number[],
  range: DateRange
): Promise<CallEvent[]> {
  if (receiverIds.length === 0) return [];
  const { data, error } = await supabase
    .from("cb_call_logs")
    .select(CALL_COLUMNS)
    .in("receiver_id", receiverIds)
    .or("is_cancel_call.is.null,is_cancel_call.neq.1")
    .gte("call_time", range.start.getTime())
    .lte("call_time", range.end.getTime())
    .order("call_time", { ascending: true })
    .limit(20000);
  if (error) throw new Error(`cb_call_logs: ${error.message}`);
  return (data ?? []).map((r) =>
    toCallEvent({
      receiver_id: r.receiver_id as number,
      device_num: r.device_num as string | null,
      resident_name_snapshot: r.resident_name_snapshot as string | null,
      resident_nickname: r.resident_nickname as string | null,
      call_time: r.call_time as number | null,
      response_time: r.response_time as number | null,
    })
  );
}

type DisarmDbRow = {
  receiver_id: number;
  device_num: string;
  disarm_start: string;
  disarm_end: string;
  reason: string | null;
  authorized_by: string | null;
};

async function fetchDisarms(
  supabase: SupabaseClient,
  receiverIds: number[],
  range: DateRange,
  nowMs: number
): Promise<DisarmDbRow[]> {
  if (receiverIds.length === 0) return [];
  const { data, error } = await supabase
    .from("cb_disarm_events")
    .select("receiver_id, device_num, disarm_start, disarm_end, reason, authorized_by")
    .in("receiver_id", receiverIds)
    .lt("disarm_start", new Date(range.end.getTime()).toISOString())
    // Keep still-running disarms: their end is in the future.
    .gt("disarm_end", new Date(Math.min(range.start.getTime(), nowMs) - DAY_MS).toISOString())
    .order("disarm_start", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`cb_disarm_events: ${error.message}`);
  return (data ?? []) as DisarmDbRow[];
}

/** Resident name for each bell (receiver + device) currently assigned. */
export async function fetchBellResidents(
  supabase: SupabaseClient,
  receiverIds: number[]
): Promise<Map<string, { resident: string; bell_no: string }>> {
  const map = new Map<string, { resident: string; bell_no: string }>();
  if (receiverIds.length === 0) return map;
  const { data } = await supabase
    .from("cb_assignments")
    .select("receiver_id, device_num, room_label, tbl_residents(resident_name)")
    .in("receiver_id", receiverIds);
  for (const row of data ?? []) {
    const res = Array.isArray(row.tbl_residents) ? row.tbl_residents[0] : row.tbl_residents;
    const key = `${row.receiver_id}:${String(row.device_num ?? "").toUpperCase()}`;
    map.set(key, {
      resident: (res?.resident_name as string) ?? "",
      bell_no: (row.room_label as string) ?? String(row.device_num ?? ""),
    });
  }
  return map;
}

type DisarmWindow = {
  receiver_id: number;
  device_num: string;
  startMs: number;
  endMs: number;
  reason: string;
  authorized_by: string;
};

/** Every fetched disarm as a time window, including still-running ones. */
function disarmWindows(rows: DisarmDbRow[], nowMs: number): DisarmWindow[] {
  return rows
    .map((r) => ({
      receiver_id: Number(r.receiver_id),
      device_num: (r.device_num ?? "").toUpperCase(),
      startMs: Date.parse(r.disarm_start),
      // A disarm with no end yet is still running; treat it as ending now.
      endMs: Number.isFinite(Date.parse(r.disarm_end)) ? Date.parse(r.disarm_end) : nowMs,
      reason: r.reason ?? "",
      authorized_by: r.authorized_by ?? "",
    }))
    .filter((d) => Number.isFinite(d.startMs) && Number.isFinite(d.endMs));
}

/**
 * Build the disarms that STARTED inside the range, resolved to their resident
 * and bell number, for the Temporary Disarm Activity table.
 */
export function buildDisarmRows(
  rows: DisarmDbRow[],
  bellByKey: Map<string, { resident: string; bell_no: string }>,
  range: DateRange,
  nowMs: number
): DisarmEvent[] {
  return disarmWindows(rows, nowMs)
    .map((w) => {
      const info = bellByKey.get(`${w.receiver_id}:${w.device_num}`);
      return {
        device_num: w.device_num,
        bell_no: info?.bell_no || w.device_num || "—",
        resident: info?.resident || "",
        startMs: w.startMs,
        endMs: w.endMs,
        durationMs: Math.max(0, w.endMs - w.startMs),
        reason: w.reason,
        authorized_by: w.authorized_by,
      };
    })
    .filter((d) => d.startMs >= range.start.getTime() && d.startMs <= range.end.getTime())
    .sort((a, b) => b.startMs - a.startMs);
}

/**
 * A call made on a disarmed bell is withdrawn by the receiver APK without ever
 * being announced, so its "response" is instant and would drag every timing
 * metric down. Drop those from the answered-call population.
 */
function stripDisarmedCalls(calls: CallEvent[], disarms: DisarmWindow[]): CallEvent[] {
  if (disarms.length === 0) return calls;
  const byReceiver = new Map<number, { startMs: number; endMs: number; device: string }[]>();
  for (const d of disarms) {
    const list = byReceiver.get(d.receiver_id);
    const entry = { startMs: d.startMs, endMs: d.endMs, device: (d.device_num ?? "").toUpperCase() };
    if (list) list.push(entry);
    else byReceiver.set(d.receiver_id, [entry]);
  }
  return calls.filter((c) => {
    const windows = byReceiver.get(c.receiver_id);
    if (!windows) return true;
    const device = c.device_num.toUpperCase();
    return !windows.some((w) => w.device === device && c.callMs >= w.startMs && c.callMs <= w.endMs);
  });
}

export type DashboardData = {
  kpis: CallKpis;
  buckets: ResponseBucket[];
  hourRows: HourRow[];
  bellRows: BellRow[];
  patternRows: PatternRow[];
  disarms: DisarmEvent[];
  disarmSummary: DisarmSummary;
};

/** Aggregate one branch's slice of the call history for the dashboard. */
export async function buildDashboard(
  supabase: SupabaseClient,
  receiverIds: number[],
  range: DateRange,
  bellByKey: Map<string, { resident: string; bell_no: string }>
): Promise<DashboardData> {
  const nowMs = Date.now();
  const [calls, disarmRows] = await Promise.all([
    fetchCalls(supabase, receiverIds, range),
    fetchDisarms(supabase, receiverIds, range, nowMs),
  ]);

  const disarms = buildDisarmRows(disarmRows, bellByKey, range, nowMs);
  // Timing stats exclude calls that landed inside a disarm window.
  const timingCalls = stripDisarmedCalls(calls, disarmWindows(disarmRows, nowMs));

  // Every call counts towards the volume KPIs; only the timing stats drop the
// disarmed ones.
  const kpis = computeKpis(timingCalls, calls.length);
  const buckets = computeResponseBuckets(timingCalls);
  const hourRows = computeCallsByHour(calls);

  // Bell rows use every call (including disarmed ones — they still happened),
  // but fall back to the current assignment for names missing from the snapshot.
  const withNames = calls.map((c) => {
    const info = bellByKey.get(`${c.receiver_id}:${c.device_num.toUpperCase()}`);
    return {
      ...c,
      bell_no: c.bell_no || info?.bell_no || c.device_num,
      resident: c.resident || info?.resident || "",
    };
  });

  return {
    kpis,
    buckets,
    hourRows,
    bellRows: computeBellVolume(withNames),
    patternRows: computeFrequentPatterns(withNames),
    disarms,
    disarmSummary: summariseDisarms(disarms),
  };
}

/** Same range, aggregated per branch — for the multi-branch comparison table. */
export async function buildBranchStats(
  supabase: SupabaseClient,
  receivers: { id: number; branch_id: number }[],
  branchLabelById: Map<number, string>,
  range: DateRange
): Promise<BranchStat[]> {
  const byBranch = new Map<number, number[]>();
  for (const r of receivers) {
    const list = byBranch.get(r.branch_id);
    if (list) list.push(r.id);
    else byBranch.set(r.branch_id, [r.id]);
  }

  const results = await Promise.all(
    [...byBranch.entries()].map(async ([branchId, receiverIds]) => {
      const calls = stripDisarmedCalls(await fetchCalls(supabase, receiverIds, range), []);
      const k = computeKpis(calls);
      return {
        branch_id: branchId,
        label: branchLabelById.get(branchId) ?? `Branch ${branchId}`,
        totalCalls: k.totalCalls,
        answeredCalls: k.answeredCalls,
        avgResponseMs: k.avgResponseMs,
      } satisfies BranchStat;
    })
  );
  return results.sort((a, b) => b.totalCalls - a.totalCalls);
}