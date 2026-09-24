// Pure (client-safe) helpers for the Resident Dashboard "Recent vitals"
// trends. Deliberately free of any server-only import so it can be used
// from "use client" components -- see the lib/lookups.ts footgun in
// CLAUDE.md.
//
// Two very different rules apply here, and they must not be mixed up:
//   * BP / HR / Temp / SpO2 -- grouped by calendar day, one point per day,
//     each point the DAILY AVERAGE of that day's actual readings.
//   * DXT -- never averaged. DXT is tested far less often than the other
//     vitals (some residents only twice a week), so collapsing it to a
//     daily average would invent readings that never happened. Every
//     actual reading is kept, with its real timestamp.
//
// Calendar days are computed in Asia/Kuala_Lumpur (the app's one timezone,
// see lib/format-date.ts) rather than UTC, so a 19:39 reading is never
// bucketed into the wrong day.

import { formatDate, formatDateTime } from "@/lib/format-date";

export type Vital = {
  entry_timestamp: string;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  spo2_condition: string | null;
  dxt: number | null;
  dxt_remark: string | null;
};

export type DailyAveragePoint = {
  /** YYYY-MM-DD, in Asia/Kuala_Lumpur. */
  dateKey: string;
  /** e.g. "22 Sep 2026" -- deliberately date-only; a daily average has no time of day. */
  label: string;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  /** SpO2 condition from the most recent reading of that day, if any. */
  spo2_condition: string | null;
};

export type DXTReading = {
  id: string;
  timestamp: string;
  value: number;
  remark: string | null;
};

/** YYYY-MM-DD for an ISO timestamp, in Asia/Kuala_Lumpur. */
export function getKLDateKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(d);
}

/** Shift a YYYY-MM-DD key back by whole days, without any timezone round-trip. */
function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d - days));
  return shifted.toISOString().slice(0, 10);
}

function isValidDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(new Date(`${key}T00:00:00Z`).getTime());
}

export type DateRangeOption = 7 | 14 | 28 | "custom";

export type DateRange = {
  option: DateRangeOption;
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, inclusive. */
  end: string;
};

/**
 * Resolve a range option against the resident's most recent reading.
 *
 * Presets are anchored to the LATEST reading, not to today: a resident who
 * was last charted a fortnight ago should still get a meaningful 7-day
 * view rather than an empty chart. Custom is inclusive on both ends.
 */
export function resolveDateRange(vitals: Vital[], option: DateRangeOption, customStart: string, customEnd: string): DateRange | null {
  if (option === "custom") {
    const start = isValidDateKey(customStart) ? customStart : "";
    const end = isValidDateKey(customEnd) ? customEnd : "";
    // An inverted or half-entered custom range is a caller-displayable
    // error, not something to silently paper over.
    if (start && end && start > end) return null;
    if (!start && !end) return null;
    return { option, start, end };
  }

  const latestKey = latestDateKey(vitals);
  if (!latestKey) return null;
  return {
    option,
    start: shiftDateKey(latestKey, option - 1),
    end: latestKey,
  };
}

export function latestDateKey(vitals: Vital[]): string {
  let latest = "";
  for (const v of vitals) {
    const key = getKLDateKey(v.entry_timestamp);
    if (key && key > latest) latest = key;
  }
  return latest;
}

/** Default fill for the Custom date inputs: last 28 days of real data. */
export function defaultCustomRange(vitals: Vital[]): { start: string; end: string } {
  const latest = latestDateKey(vitals);
  if (!latest) return { start: "", end: "" };
  return { start: shiftDateKey(latest, 27), end: latest };
}

export function filterVitalsByRange(vitals: Vital[], range: DateRange | null): Vital[] {
  if (!range) return [];
  return vitals.filter((v) => {
    const key = getKLDateKey(v.entry_timestamp);
    if (!key) return false;
    if (range.start && key < range.start) return false;
    if (range.end && key > range.end) return false;
    return true;
  });
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function averageOf(values: number[], decimals: number): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((a, b) => a + b, 0) / values.length, decimals);
}

/**
 * Group readings by calendar day and average them. Days with no readings
 * produce no point at all -- gaps are left as gaps, never interpolated.
 * Output is oldest-first so it plots left-to-right in time.
 */
export function getDailyAverages(vitals: Vital[]): DailyAveragePoint[] {
  type Bucket = {
    systolic: number[];
    diastolic: number[];
    heartRate: number[];
    temperature: number[];
    spo2: number[];
    latestTimestamp: string;
    spo2Condition: string | null;
  };

  const buckets = new Map<string, Bucket>();

  for (const v of vitals) {
    const key = getKLDateKey(v.entry_timestamp);
    if (!key) continue;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        systolic: [],
        diastolic: [],
        heartRate: [],
        temperature: [],
        spo2: [],
        latestTimestamp: v.entry_timestamp,
        spo2Condition: null,
      };
      buckets.set(key, bucket);
    }

    if (v.entry_timestamp > bucket.latestTimestamp) bucket.latestTimestamp = v.entry_timestamp;

    if (typeof v.systolic_bp === "number") bucket.systolic.push(v.systolic_bp);
    if (typeof v.diastolic_bp === "number") bucket.diastolic.push(v.diastolic_bp);
    if (typeof v.heart_rate === "number") bucket.heartRate.push(v.heart_rate);
    if (typeof v.temperature === "number") bucket.temperature.push(v.temperature);
    if (typeof v.spo2 === "number") bucket.spo2.push(v.spo2);

    // Attach the condition of the day's most recent SpO2 reading -- that is
    // the one a clinician reading "today's" card is thinking about.
    if (v.spo2_condition && v.spo2 !== null) {
      if (bucket.latestTimestamp === v.entry_timestamp) bucket.spo2Condition = v.spo2_condition;
    }
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, b]) => ({
      dateKey,
      label: formatDate(`${dateKey}T00:00:00+08:00`),
      systolic_bp: averageOf(b.systolic, 0),
      diastolic_bp: averageOf(b.diastolic, 0),
      heart_rate: averageOf(b.heartRate, 0),
      temperature: averageOf(b.temperature, 1),
      spo2: averageOf(b.spo2, 0),
      spo2_condition: b.spo2Condition,
    }));
}

/**
 * Every actual DXT reading, oldest-first. `limit` keeps only the most
 * recent N (used for the main-page card); the history modal passes none
 * so the whole selected range is shown.
 */
export function getDXTReadings(vitals: Vital[], limit?: number): DXTReading[] {
  const readings = vitals
    .filter((v): v is Vital & { dxt: number } => typeof v.dxt === "number")
    .sort((a, b) => b.entry_timestamp.localeCompare(a.entry_timestamp));

  const newestFirst = limit ? readings.slice(0, limit) : readings;

  return newestFirst
    .map((v, i) => ({
      id: `${v.entry_timestamp}#${i}`,
      timestamp: v.entry_timestamp,
      value: v.dxt,
      remark: v.dxt_remark ?? null,
    }))
    .reverse();
}

/**
 * "22/09/2026, 19:39" -- used for DXT card + tooltip headers, where the value
 * is a real reading at a real time.
 *
 * "22/09/2026" -- used for the daily-average cards + tooltips. Deliberately
 * date-only: showing a time would imply the average was taken at that moment.
 *
 * Both delegate to lib/format-date's pinned en-GB / Asia/Kuala_Lumpur
 * formatting, so the card matches every other date in the app and can't
 * drift between server and browser render.
 */
export { formatDate as formatVitalDate, formatDateTime as formatVitalDateTime };
