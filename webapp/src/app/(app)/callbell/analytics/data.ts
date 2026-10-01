// Pure computation utilities for the Call Bell analytics dashboard.
// No Supabase imports here — all DB fetching lives in page.tsx, so this
// file is safe to import from anywhere.

export type PeriodKey = "today" | "7d" | "30d" | "custom";
export type DateRange = { start: Date; end: Date };

export const TZ = "Asia/Kuala_Lumpur";

function toStartOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function toEndOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/** Wall-clock hour (0-23) in Malaysia time for a given epoch-ms stamp. */
export function hourInTz(ms: number): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date(ms))
  );
}

/** "HH:MM" in Malaysia time for a given epoch-ms stamp. */
export function fmtClockInTz(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function fmtDayInTz(ms: number): string {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
  }).format(new Date(ms));
}

export function resolveDateRange(period: PeriodKey, customFrom: string, customTo: string): DateRange {
  const today = new Date();
  switch (period) {
    case "today":
      return { start: toStartOfDay(today), end: toEndOfDay(today) };
    case "7d":
      return { start: toStartOfDay(new Date(today.getTime() - 6 * 24 * 60 * 60_000)), end: toEndOfDay(today) };
    case "30d":
      return { start: toStartOfDay(new Date(today.getTime() - 29 * 24 * 60 * 60_000)), end: toEndOfDay(today) };
    case "custom": {
      if (customFrom && customTo) {
        const s = toStartOfDay(new Date(customFrom));
        const e = toEndOfDay(new Date(customTo));
        if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s <= e) return { start: s, end: e };
      }
      return { start: toStartOfDay(today), end: toEndOfDay(today) };
    }
  }
}

// ─── Duration formatting ──────────────────────────────────────────────────────
// Never surface a raw millisecond/epoch value: everything the dashboard shows
// goes through formatDuration so it reads "42 sec", "1 min 04 sec", "1 hr 12 min".

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec} sec`;
  const totalMin = Math.floor(totalSec / 60);
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const sec = totalSec % 60;
  if (hr > 0) {
    return min > 0 ? `${hr} hr ${String(min).padStart(2, "0")} min` : `${hr} hr`;
  }
  return `${min} min ${String(sec).padStart(2, "0")} sec`;
}

export function fmtShortDuration(ms: number | null): string {
  return ms === null ? "—" : formatDuration(ms);
}

// ─── Call rows ────────────────────────────────────────────────────────────────

export type CallEvent = {
  receiver_id: number;
  device_num: string;
  /** Bell number / call number as recorded at call time. */
  bell_no: string;
  /** Resident nickname as recorded at call time (history stays stable). */
  resident: string;
  callMs: number;
  responseMs: number;
  /** RESPONSE_TIME - CALL_TIME, or null when the call was never answered. */
  durationMs: number | null;
};

export function toCallEvent(row: {
  receiver_id: number;
  device_num: string | null;
  resident_name_snapshot: string | null;
  resident_nickname: string | null;
  call_time: number | string | null;
  response_time: number | string | null;
}): CallEvent {
  const callMs = Number(row.call_time) || 0;
  const responseMs = Number(row.response_time) || 0;
  // Calls on a disarmed bell are withdrawn by the receiver APK without being
  // announced, so their "response" is instant and meaningless. The dashboard
  // excludes any call whose response falls inside a disarm window.
  const durationMs = callMs > 0 && responseMs > callMs ? responseMs - callMs : null;
  return {
    receiver_id: Number(row.receiver_id),
    device_num: (row.device_num ?? "").trim(),
    bell_no: (row.resident_name_snapshot ?? "").trim(),
    resident: (row.resident_nickname ?? "").trim(),
    callMs,
    responseMs,
    durationMs,
  };
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

export type CallKpis = {
  totalCalls: number;
  answeredCalls: number;
  avgResponseMs: number | null;
  medianResponseMs: number | null;
  longestResponseMs: number | null;
  callersCount: number;
  callsPerResident: number | null;
};

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeKpis(calls: CallEvent[], totalCallsOverride?: number): CallKpis {
  // Only calls with a usable response duration take part in the timing stats,
  // so unanswered calls cannot drag the average / median / longest up.
  const answered = calls
    .map((c) => c.durationMs)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);
  const callers = new Set(calls.map((c) => c.resident).filter(Boolean));
  const callerCount = callers.size;
  // `totalCallsOverride` lets the caller keep the real total when the timing
  // population has had disarmed calls removed — a call still counts as a call.
  const totalCalls = totalCallsOverride ?? calls.length;
  return {
    totalCalls,
    answeredCalls: answered.length,
    avgResponseMs: answered.length ? answered.reduce((s, d) => s + d, 0) / answered.length : null,
    medianResponseMs: answered.length ? median(answered) : null,
    longestResponseMs: answered.length ? answered[answered.length - 1] : null,
    callersCount: callerCount,
    callsPerResident: callerCount > 0 ? totalCalls / callerCount : null,
  };
}

// ─── Response-time buckets ────────────────────────────────────────────────────

export type ResponseBucket = {
  key: string;
  label: string;
  minMs: number;
  /** Exclusive upper bound; Infinity for the last bucket. */
  maxMs: number;
  count: number;
  pct: number;
};

const BUCKET_DEFS: { key: string; label: string; minMs: number; maxMs: number }[] = [
  { key: "le1", label: "≤ 1 min", minMs: 0, maxMs: 60_000 },
  { key: "1to10", label: ">1–10 min", minMs: 60_000, maxMs: 10 * 60_000 },
  { key: "10to15", label: ">10–15 min", minMs: 10 * 60_000, maxMs: 15 * 60_000 },
  { key: "15to20", label: ">15–20 min", minMs: 15 * 60_000, maxMs: 20 * 60_000 },
  { key: "ge20", label: "≥20 min", minMs: 20 * 60_000, maxMs: Infinity },
];

export function computeResponseBuckets(calls: CallEvent[]): ResponseBucket[] {
  const answered = calls.filter((c) => c.durationMs !== null);
  return BUCKET_DEFS.map((b) => {
    const count = answered.filter((c) => c.durationMs! >= b.minMs && c.durationMs! < b.maxMs).length;
    return {
      ...b,
      count,
      pct: answered.length ? Math.round((count / answered.length) * 100) : 0,
    };
  });
}

// ─── Calls by hour ────────────────────────────────────────────────────────────

export type HourRow = { hour: number; label: string; count: number };

export function computeCallsByHour(calls: CallEvent[]): HourRow[] {
  const counts = new Array(24).fill(0);
  for (const c of calls) {
    if (c.callMs > 0) counts[hourInTz(c.callMs)] += 1;
  }
  return counts.map((count, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    count,
  }));
}

// ─── Call volume by bell ──────────────────────────────────────────────────────

export type BellRow = {
  key: string;
  bell_no: string;
  resident: string;
  device_num: string;
  calls: number;
  avgResponseMs: number | null;
};

export function computeBellVolume(calls: CallEvent[], limit = 50): BellRow[] {
  const map = new Map<string, { bell_no: string; resident: string; device_num: string; calls: number; total: number; answered: number }>();
  for (const c of calls) {
    // device_num is the physical bell, so it — not the call number, which the
    // receiver can rename — is what identifies a bell across the table.
    const key = `${c.receiver_id}:${c.device_num || c.bell_no || "?"}`;
    let row = map.get(key);
    if (!row) {
      row = { bell_no: c.bell_no || c.device_num || "—", resident: c.resident, device_num: c.device_num, calls: 0, total: 0, answered: 0 };
      map.set(key, row);
    }
    // The resident shown is whoever the bell belonged to most recently in the
    // window — identity at call time is kept per-row in Call Logs.
    if (c.resident) row.resident = c.resident;
    if (c.device_num) row.device_num = c.device_num;
    row.calls += 1;
    if (c.durationMs !== null) {
      row.total += c.durationMs;
      row.answered += 1;
    }
  }
  return [...map.entries()]
    .map(([key, r]) => ({
      key,
      bell_no: r.bell_no,
      resident: r.resident,
      device_num: r.device_num,
      calls: r.calls,
      avgResponseMs: r.answered ? r.total / r.answered : null,
    }))
    .sort((a, b) => b.calls - a.calls || a.bell_no.localeCompare(b.bell_no, undefined, { numeric: true }))
    .slice(0, limit);
}

// ─── Frequent call patterns ───────────────────────────────────────────────────

export type PatternRow = {
  key: string;
  resident: string;
  bell_no: string;
  periodLabel: string;
  startMs: number;
  endMs: number;
  calls: number;
};

/**
 * Repeated-call episodes: the same resident pressing the bell several times
 * inside a short window. A sliding window over that resident's calls finds the
 * densest cluster; clusters that overlap are merged so one burst appears once.
 * Calls within `windowMs` of each other AND at least `minCalls` in total form an
 * episode — purely operational, no judgement attached to the resident.
 */
export function computeFrequentPatterns(
  calls: CallEvent[],
  opts: { windowMs?: number; minCalls?: number; limit?: number } = {}
): PatternRow[] {
  const windowMs = opts.windowMs ?? 30 * 60_000;
  const minCalls = opts.minCalls ?? 3;
  const limit = opts.limit ?? 25;

  const byResident = new Map<string, CallEvent[]>();
  for (const c of calls) {
    if (!c.resident || c.callMs <= 0) continue;
    const list = byResident.get(c.resident);
    if (list) list.push(c);
    else byResident.set(c.resident, [c]);
  }

  const episodes: PatternRow[] = [];
  for (const [resident, list] of byResident) {
    const sorted = [...list].sort((a, b) => a.callMs - b.callMs);
    let cluster: CallEvent[] = [];

    const flush = () => {
      if (cluster.length >= minCalls) {
        episodes.push({
          key: `${resident}:${cluster[0].callMs}`,
          resident,
          bell_no: cluster[cluster.length - 1].bell_no || cluster[cluster.length - 1].device_num || "—",
          periodLabel: `${fmtDayInTz(cluster[0].callMs)} ${fmtClockInTz(cluster[0].callMs)}–${fmtClockInTz(cluster[cluster.length - 1].callMs)}`,
          startMs: cluster[0].callMs,
          endMs: cluster[cluster.length - 1].callMs,
          calls: cluster.length,
        });
      }
      cluster = [];
    };

    for (const c of sorted) {
      // Reaching this call from the cluster's start would exceed the window, so
      // the previous cluster (if any) is finished.
      if (cluster.length > 0 && c.callMs - cluster[0].callMs > windowMs) flush();
      cluster.push(c);
    }
    flush();
  }

  return episodes.sort((a, b) => b.calls - a.calls || a.startMs - b.startMs).slice(0, limit);
}

// ─── Disarm activity ──────────────────────────────────────────────────────────

export type DisarmEvent = {
  device_num: string;
  bell_no: string;
  resident: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  reason: string;
  authorized_by: string;
};

export type DisarmSummary = {
  events: number;
  totalDurationMs: number;
  avgDurationMs: number | null;
  mostEventsResident: string;
  mostEventsCount: number;
};

export function summariseDisarms(disarms: DisarmEvent[]): DisarmSummary {
  const byResident = new Map<string, number>();
  for (const d of disarms) {
    byResident.set(d.resident, (byResident.get(d.resident) ?? 0) + 1);
  }
  let topResident = "";
  let topCount = 0;
  for (const [name, n] of byResident) {
    if (n > topCount) {
      topResident = name;
      topCount = n;
    }
  }
  const total = disarms.reduce((s, d) => s + d.durationMs, 0);
  return {
    events: disarms.length,
    totalDurationMs: total,
    avgDurationMs: disarms.length ? total / disarms.length : null,
    mostEventsResident: topCount > 0 ? topResident : "",
    mostEventsCount: topCount,
  };
}

// ─── Branch comparison ────────────────────────────────────────────────────────

export type BranchStat = {
  branch_id: number;
  label: string;
  totalCalls: number;
  answeredCalls: number;
  avgResponseMs: number | null;
};