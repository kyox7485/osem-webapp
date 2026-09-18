import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/current-user";

export type PatientTypeKey = "inpatient" | "outpatient" | "housecall";

export const PATIENT_TYPE_LABELS: Record<PatientTypeKey, string> = {
  inpatient: "Inpatient",
  outpatient: "Outpatient (walk-in)",
  housecall: "Housecall",
};

// Team baseline used to read individual/team totals against -- NOT a cap.
// A therapist can (and does) go over this; see workload-bar.tsx for how
// "over" is rendered as neutral/positive rather than a warning.
export const WEEKLY_BASELINE_HOURS = 45;

export type PeriodKey = "week" | "month" | "quarter" | "custom";

export type DateRange = { start: Date; end: Date };

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
function startOfWeek(d: Date): Date {
  // Monday-start week, matching the 45hr/week working-week convention.
  const r = startOfDay(d);
  const day = r.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1;
  r.setDate(r.getDate() - diff);
  return r;
}

export function resolveDateRange(period: PeriodKey, customStart: string, customEnd: string): DateRange {
  const today = endOfDay(new Date());

  if (period === "custom" && customStart && customEnd) {
    const start = startOfDay(new Date(customStart));
    const end = endOfDay(new Date(customEnd));
    if (start <= end) return { start, end };
  }

  if (period === "week") {
    return { start: startOfWeek(today), end: today };
  }
  if (period === "quarter") {
    const start = startOfDay(new Date(today));
    start.setDate(start.getDate() - 90);
    return { start, end: today };
  }
  // month (default)
  const start = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
  return { start, end: today };
}

// The same-length window immediately preceding the selected range, used for
// the "vs previous period" deltas on the KPI tiles.
export function previousPeriod(range: DateRange): DateRange {
  const spanMs = range.end.getTime() - range.start.getTime();
  const end = new Date(range.start.getTime() - 1);
  const start = new Date(end.getTime() - spanMs);
  return { start, end };
}

export type AssessmentRow = {
  branch_id: number;
  care_setting: "IP" | "OP";
  treatment_type: string | null;
  credit_hours: number | null;
  documented_by: string;
  entry_timestamp: string;
  therapist_name: string;
  branch_label: string;
};

export function classify(row: { care_setting: "IP" | "OP"; treatment_type: string | null }): PatientTypeKey {
  if (row.treatment_type === "Housecall") return "housecall";
  return row.care_setting === "IP" ? "inpatient" : "outpatient";
}

// Which tbl_branches rows are relevant to the physiotherapy module at all
// (residential homes + the physio hub) -- HQ is excluded, it never holds
// patients.
export async function getPhysioRelevantBranches(): Promise<{ id: number; label: string; function: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_branches")
    .select('id:BranchID, locale:BranchLocale, code:BranchCode, function:Function')
    .in("Function", ["NUR", "PHY"])
    .order("BranchCode");
  const rows = (data ?? []) as { id: number; locale: string | null; code: string; function: string }[];

  // Per-branch-id scoping means multiple branches can share the same
  // BranchLocale (e.g. three separate "ALMA" branches: a nursing home, the
  // physio hub, and the demo branch) -- append the code so the branch
  // filter dropdown and breakdown charts can tell them apart. Only done
  // where the locale is actually ambiguous, so a normal single-branch
  // locale still reads as just "BAGAN"/"KOTA PERMAI".
  const localeCounts = new Map<string, number>();
  for (const r of rows) {
    const key = r.locale ?? r.code;
    localeCounts.set(key, (localeCounts.get(key) ?? 0) + 1);
  }

  return rows.map((r) => {
    const base = r.locale ?? r.code;
    const label = (localeCounts.get(base) ?? 0) > 1 ? `${base} (${r.code})` : base;
    return { id: r.id, label, function: r.function };
  });
}

// Mirrors the access model used elsewhere in the physio module
// (getPhysioIpBranchIds): a physio-hub account covers every nursing branch
// plus its own hub; a nursing-branch account sees only itself; ADMIN sees
// everything. Applied here across both IP and OP data (the existing helper
// is IP-only), since the dashboard reports on both.
export async function getAllowedBranchIds(account: CurrentUser): Promise<number[] | null> {
  if (account.rights === "ADMIN") return null; // null = unrestricted
  if (account.branch_function === "PHY") {
    const nur = await getPhysioRelevantBranches();
    const ids = nur.filter((b) => b.function === "NUR").map((b) => b.id);
    return [...new Set([...ids, account.branch_id])];
  }
  return [account.branch_id];
}

// Re-exported for callers that only need the dashboard's data module --
// the physiotherapist roster itself lives in lib/lookups.ts since it's
// shared with the assessment form's "Documented by" picker.
export { getPhysiotherapyStaff as getPhysioTherapists } from "@/lib/lookups";

export async function fetchAssessments(params: {
  range: DateRange;
  allowedBranchIds: number[] | null;
  branchFilter: number | null;
  therapistFilter: string | null;
}): Promise<AssessmentRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("physio_assessments")
    .select(
      "branch_id, care_setting, treatment_type, credit_hours, documented_by, entry_timestamp, tbl_staff!documented_by(staff_name), tbl_branches!branch_id(locale:BranchLocale, code:BranchCode)"
    )
    .gte("entry_timestamp", params.range.start.toISOString())
    .lte("entry_timestamp", params.range.end.toISOString());

  if (params.allowedBranchIds) query = query.in("branch_id", params.allowedBranchIds);
  if (params.branchFilter !== null) query = query.eq("branch_id", params.branchFilter);
  if (params.therapistFilter) query = query.eq("documented_by", params.therapistFilter);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((r: any) => {
    const staff = Array.isArray(r.tbl_staff) ? r.tbl_staff[0] : r.tbl_staff;
    const branch = Array.isArray(r.tbl_branches) ? r.tbl_branches[0] : r.tbl_branches;
    return {
      branch_id: r.branch_id,
      care_setting: r.care_setting,
      treatment_type: r.treatment_type,
      credit_hours: r.credit_hours,
      documented_by: r.documented_by,
      entry_timestamp: r.entry_timestamp,
      therapist_name: staff?.staff_name ?? r.documented_by,
      branch_label: branch?.locale ?? branch?.code ?? "--",
    };
  });
}

export type TypeTotals = Record<PatientTypeKey, number>;

export function emptyTypeTotals(): TypeTotals {
  return { inpatient: 0, outpatient: 0, housecall: 0 };
}

export function sumByType(rows: AssessmentRow[]): TypeTotals {
  const totals = emptyTypeTotals();
  for (const r of rows) {
    totals[classify(r)] += r.credit_hours ?? 0;
  }
  return totals;
}

export function totalHours(totals: TypeTotals): number {
  return totals.inpatient + totals.outpatient + totals.housecall;
}

export type WorkloadRow = {
  id: string;
  name: string;
  totals: TypeTotals;
  branches: string[];
  // The expected weekly credit-hour capacity to compare this row's actual
  // average against -- 45h for one therapist, or 45h * headcount for a
  // branch team rollup (see aggregateByBranch).
  baselineHours: number;
};

export function aggregateByBranch(rows: AssessmentRow[]): WorkloadRow[] {
  const map = new Map<number, { totals: TypeTotals; label: string; therapistIds: Set<string> }>();
  for (const r of rows) {
    let entry = map.get(r.branch_id);
    if (!entry) {
      entry = { totals: emptyTypeTotals(), label: r.branch_label, therapistIds: new Set() };
      map.set(r.branch_id, entry);
    }
    entry.totals[classify(r)] += r.credit_hours ?? 0;
    entry.therapistIds.add(r.documented_by);
  }
  return [...map.entries()]
    .map(([branchId, e]) => ({
      id: String(branchId),
      name: e.label,
      totals: e.totals,
      // Branch rows don't need a sub-label -- the branch name is the row
      // itself, unlike a therapist row where "branches" lists where they
      // worked. TherapistTable skips rendering an empty subtitle line.
      branches: [],
      // Team baseline scales with how many distinct therapists actually
      // logged hours at this branch in the period -- a proxy for headcount
      // since there's no separate branch-staffing-roster query here.
      baselineHours: Math.max(e.therapistIds.size, 1) * WEEKLY_BASELINE_HOURS,
    }))
    .sort((a, b) => totalHours(b.totals) - totalHours(a.totals));
}

export function aggregateByTherapist(rows: AssessmentRow[]): WorkloadRow[] {
  const map = new Map<string, WorkloadRow>();
  for (const r of rows) {
    let entry = map.get(r.documented_by);
    if (!entry) {
      entry = { id: r.documented_by, name: r.therapist_name, totals: emptyTypeTotals(), branches: [], baselineHours: WEEKLY_BASELINE_HOURS };
      map.set(r.documented_by, entry);
    }
    entry.totals[classify(r)] += r.credit_hours ?? 0;
    if (!entry.branches.includes(r.branch_label)) entry.branches.push(r.branch_label);
  }
  return [...map.values()].sort((a, b) => totalHours(b.totals) - totalHours(a.totals));
}

export type WeekBucket = {
  label: string;
  start: Date;
  totals: TypeTotals;
};

// Buckets by day for a single-week view, otherwise by Monday-start week --
// keeps the trend chart legible whether the range is 7 days or 90.
export function bucketByPeriod(rows: AssessmentRow[], range: DateRange, period: PeriodKey): WeekBucket[] {
  const byDay = period === "week";
  const buckets = new Map<string, WeekBucket>();

  const cursor = byDay ? startOfDay(range.start) : startOfWeek(range.start);
  const end = range.end;
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    buckets.set(key, {
      label: byDay
        ? cursor.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })
        : `${cursor.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      start: new Date(cursor),
      totals: emptyTypeTotals(),
    });
    cursor.setDate(cursor.getDate() + (byDay ? 1 : 7));
  }

  for (const r of rows) {
    const d = new Date(r.entry_timestamp);
    const bucketStart = byDay ? startOfDay(d) : startOfWeek(d);
    const key = bucketStart.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) bucket.totals[classify(r)] += r.credit_hours ?? 0;
  }

  return [...buckets.values()];
}

export function rangeInWeeks(range: DateRange): number {
  const ms = range.end.getTime() - range.start.getTime();
  return Math.max(ms / (7 * 24 * 60 * 60 * 1000), 1 / 7);
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}
