// Pure computation utilities for the Admission Analytics dashboard.
// No Supabase imports here — all DB fetching lives in page.tsx so this
// file is safe to import from server components without a server/client
// boundary concern.

export type PeriodKey = "month" | "last-month" | "year" | "last-year" | "custom";
export type DateRange = { start: Date; end: Date };

function toEndOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function resolveDateRange(
  period: PeriodKey,
  customFrom: string,
  customTo: string
): DateRange {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();

  switch (period) {
    case "month":
      return { start: new Date(y, m, 1), end: toEndOfDay(today) };
    case "last-month": {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      return { start: new Date(ly, lm, 1), end: toEndOfDay(new Date(ly, lm + 1, 0)) };
    }
    case "year":
      return { start: new Date(y, 0, 1), end: toEndOfDay(today) };
    case "last-year":
      return {
        start: new Date(y - 1, 0, 1),
        end: toEndOfDay(new Date(y - 1, 11, 31)),
      };
    case "custom":
      if (customFrom && customTo) {
        const s = new Date(customFrom);
        s.setHours(0, 0, 0, 0);
        const e = toEndOfDay(new Date(customTo));
        if (s <= e) return { start: s, end: e };
      }
      return { start: new Date(y, m, 1), end: toEndOfDay(today) };
  }
}

export type ResidentRow = {
  id: number;
  resident_name: string;
  branch_id: number;
  age: number | null;
  gender: string | null;
  status: string;
  admission_date: string | null;
  discharge_date: string | null;
  mobility: string | null;
  feeding_type_id: number | null;
  hygiene: string | null;
  care_type: string | null;
};

export type ResidentDetail = ResidentRow & {
  resident_id?: string;
  name?: string;
};

export type BranchCapacityInfo = {
  branch_id: number;
  branch_label: string;
  bed_capacity: number | null;
  active_residents: number;
};

// ─── KPI computations ────────────────────────────────────────────────────────

export function computeAdmissions(residents: ResidentRow[], range: DateRange): number {
  return residents.filter((r) => {
    if (!r.admission_date) return false;
    const d = new Date(r.admission_date);
    return d >= range.start && d <= range.end;
  }).length;
}

export function computeDischarges(residents: ResidentRow[], range: DateRange): number {
  // Intentionally uses discharge_date (not status) -- DECEASED and TRANSFERRED OUT
  // residents with a discharge_date should count as "departed" in this period.
  return residents.filter((r) => {
    if (!r.discharge_date) return false;
    const d = new Date(r.discharge_date);
    return d >= range.start && d <= range.end;
  }).length;
}

export function computeCurrentOccupancy(residents: ResidentRow[]): number {
  return residents.filter((r) => r.status === "ACTIVE").length;
}

export function computeOccupancyByCareType(residents: ResidentRow[]): {
  fullTime: number;
  daycare: number;
} {
  const active = residents.filter((r) => r.status === "ACTIVE");
  return {
    fullTime: active.filter((r) => r.care_type !== "Daycare").length,
    daycare: active.filter((r) => r.care_type === "Daycare").length,
  };
}

// Calculate occupancy percentage given active resident count and total bed capacity.
// Returns null if capacity is not configured (null/0).
export function computeOccupancyPercentage(activeResidents: number, bedCapacity: number | null): number | null {
  if (!bedCapacity || bedCapacity <= 0) return null;
  return Math.round((activeResidents / bedCapacity) * 100);
}

// Get residents admitted in a given date range (for drill-down).
export function getAdmittedResidents(residents: ResidentRow[], range: DateRange): ResidentRow[] {
  return residents.filter((r) => {
    if (!r.admission_date) return false;
    const d = new Date(r.admission_date);
    return d >= range.start && d <= range.end;
  });
}

// Get residents discharged in a given date range (for drill-down).
export function getDischargedResidents(residents: ResidentRow[], range: DateRange): ResidentRow[] {
  return residents.filter((r) => {
    if (!r.discharge_date) return false;
    const d = new Date(r.discharge_date);
    return d >= range.start && d <= range.end;
  });
}

// Get currently active residents (for drill-down).
export function getActiveResidents(residents: ResidentRow[]): ResidentRow[] {
  return residents.filter((r) => r.status === "ACTIVE");
}

// Calculate length of stay for a single resident (in days).
export function calculateResidentLOS(resident: ResidentRow, asOfDate: Date): number | null {
  if (!resident.admission_date) return null;
  const admDate = new Date(resident.admission_date);

  // If discharged, use discharge date; otherwise use asOfDate
  const endDate = resident.discharge_date ? new Date(resident.discharge_date) : asOfDate;

  const days = Math.round((endDate.getTime() - admDate.getTime()) / 86_400_000);
  return Math.max(0, days);
}

export function computeAvgLOS(residents: ResidentRow[]): number | null {
  const completed = residents.filter((r) => r.admission_date && r.discharge_date);
  if (completed.length === 0) return null;
  const total = completed.reduce((sum, r) => {
    const days =
      (new Date(r.discharge_date!).getTime() - new Date(r.admission_date!).getTime()) /
      86_400_000;
    return sum + days;
  }, 0);
  return Math.round(total / completed.length);
}

// ─── Occupancy trend ─────────────────────────────────────────────────────────

export type TrendPoint = { label: string; occupied: number };

// One snapshot per month: the last day of each month (or range.end if the
// month hasn't ended yet). A resident "occupies" on a snapshot date if
// admission_date <= date AND (discharge_date IS NULL OR discharge_date >= date).
export function computeOccupancyTrend(
  residents: ResidentRow[],
  range: DateRange
): TrendPoint[] {
  const points: TrendPoint[] = [];
  const cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1);

  while (cur <= range.end) {
    // Last calendar day of this month, or range.end, whichever is earlier
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);
    const snap = monthEnd < range.end ? monthEnd : range.end;

    const occupied = residents.filter((r) => {
      if (!r.admission_date) return false;
      const adm = new Date(r.admission_date);
      if (adm > snap) return false;
      if (!r.discharge_date) return true;
      const dis = new Date(r.discharge_date);
      dis.setHours(0, 0, 0, 0);
      const snapDay = new Date(snap);
      snapDay.setHours(0, 0, 0, 0);
      return dis >= snapDay;
    }).length;

    const label = snap.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    points.push({ label, occupied });

    cur.setMonth(cur.getMonth() + 1);
  }

  return points;
}

// ─── Age × Gender ─────────────────────────────────────────────────────────────

export type AgeGenderRow = {
  group: string;
  male: number;
  female: number;
  unknown: number;
  total: number;
};

const AGE_GROUPS: { label: string; min: number; max: number }[] = [
  { label: "20–39", min: 20, max: 39 },
  { label: "40–59", min: 40, max: 59 },
  { label: "60+", min: 60, max: Infinity },
];

export function computeAgeGender(residents: ResidentRow[]): AgeGenderRow[] {
  const active = residents.filter((r) => r.status === "ACTIVE");
  return AGE_GROUPS.map(({ label, min, max }) => {
    const inGroup = active.filter((r) => r.age !== null && r.age >= min && r.age <= max);
    const male = inGroup.filter((r) => r.gender === "M").length;
    const female = inGroup.filter((r) => r.gender === "F").length;
    const unknown = inGroup.length - male - female;
    return { group: label, male, female, unknown, total: inGroup.length };
  });
}

// ─── Care categories (mobility / hygiene) ────────────────────────────────────

export type CategoryRow = { label: string; count: number; pct: number };

export function computeCategories(
  residents: ResidentRow[],
  getValue: (r: ResidentRow) => string | null
): CategoryRow[] {
  const active = residents.filter((r) => r.status === "ACTIVE");
  const total = active.length;
  const counts = new Map<string, number>();
  for (const r of active) {
    const key = getValue(r) ?? "Not Recorded";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }));
}

// ─── Length of stay ──────────────────────────────────────────────────────────

export type LOSBucket = { label: string; count: number };

const LOS_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "0–30 days", min: 0, max: 30 },
  { label: "31–90 days", min: 31, max: 90 },
  { label: "91–180 days", min: 91, max: 180 },
  { label: ">180 days", min: 181, max: Infinity },
];

// Calculate LOS distribution including both completed and active residents.
// For active residents, LOS is calculated using the provided asOfDate (calculation date).
export function computeLOSDistribution(residents: ResidentRow[], asOfDate: Date = new Date()): LOSBucket[] {
  // Include all residents with an admission date (completed + active)
  const residents_with_admission = residents.filter((r) => r.admission_date);

  return LOS_BUCKETS.map(({ label, min, max }) => ({
    label,
    count: residents_with_admission.filter((r) => {
      // Calculate LOS using discharge_date if available, otherwise asOfDate
      const endDate = r.discharge_date ? new Date(r.discharge_date) : asOfDate;
      const days = Math.round(
        (endDate.getTime() - new Date(r.admission_date!).getTime()) / 86_400_000
      );
      return days >= min && days <= max;
    }).length,
  }));
}
