import { daysAgoKL, todayKL, TXN_TYPE_LABELS, REQUEST_STATUS_OPTIONS } from "../core";
import { MAX_RANGE_DAYS, type FilterKey, type ReportParams } from "./types";

export type RawParams = Record<string, string | string[] | undefined>;
export type ParamError = "RANGE_INVALID" | "RANGE_TOO_LONG";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const MAX_Q = 60;
const DAY_MS = 86_400_000;

function first(raw: RawParams, name: string): string {
  const v = raw[name];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function positiveId(value: string): number | null {
  return /^\d{1,12}$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

/** Whole days from -> to (0 when equal). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Validates every report query parameter against a whitelist. A missing or
 * malformed date falls back to the last 31 days; a range that is reversed or
 * longer than 366 days is reported as an error (the caller shows or returns
 * it) instead of being silently trimmed. The range is only checked for a
 * report that has a date range, so a report without dates never fails on a
 * stale ?from=.
 */
export function parseReportParams(raw: RawParams, filters: FilterKey[]): { params: ReportParams; error: ParamError | null } {
  const q = first(raw, "q").replace(CONTROL_RE, " ").trim().slice(0, MAX_Q);
  const fromRaw = first(raw, "from");
  const toRaw = first(raw, "to");
  const from = isRealDate(fromRaw) ? fromRaw : daysAgoKL(30);
  const to = isRealDate(toRaw) ? toRaw : todayKL();
  const status = first(raw, "status");
  const location = first(raw, "location");
  const type = first(raw, "type");
  const kind = first(raw, "kind");
  const reqstatus = first(raw, "reqstatus");
  const month = first(raw, "month");

  const params: ReportParams = {
    q,
    category: positiveId(first(raw, "category")),
    status: status === "inactive" || status === "active" ? status : "all",
    supplier: positiveId(first(raw, "supplier")),
    from,
    to,
    location: location === "STORE" || location === "FLOOR" || location === "TRANSIT" ? location : "",
    type: Object.prototype.hasOwnProperty.call(TXN_TYPE_LABELS, type) ? type : "",
    month: MONTH_RE.test(month) ? month : "",
    view: first(raw, "view") === "lines" ? "lines" : "summary",
    kind: kind === "internal" || kind === "branch" ? kind : "",
    reqstatus: REQUEST_STATUS_OPTIONS.some((o) => o.value === reqstatus) ? reqstatus : "",
    only: first(raw, "only") === "variance" ? "variance" : "",
  };

  let error: ParamError | null = null;
  if (filters.includes("from") && filters.includes("to")) {
    const days = daysBetween(from, to);
    if (days < 0) error = "RANGE_INVALID";
    else if (days > MAX_RANGE_DAYS) error = "RANGE_TOO_LONG";
  }
  return { params, error };
}

/** The query string (without branch/tab) that re-creates this report's filters; used by the export links. */
export function filterQuery(params: ReportParams, filters: FilterKey[]): URLSearchParams {
  const qs = new URLSearchParams();
  for (const key of filters) {
    const value = params[key];
    if (value !== null && value !== "") qs.set(key, String(value));
  }
  return qs;
}
