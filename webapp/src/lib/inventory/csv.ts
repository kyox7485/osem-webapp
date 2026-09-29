import { EXPORT_HEADERS } from "./core";
import type { ColKind, ReportColumn, ReportRow } from "./reports/types";

// CSV builder for the charge export (schema/019 inv_export_charges). UTF-8 with
// a BOM so Excel and Bukku read the accents; CRLF line ends; every text cell
// quoted only when needed. A text cell that starts with = + - @ (or a control
// character) is prefixed with an apostrophe so a spreadsheet cannot run it as
// a formula; numbers and booleans are never touched, so negative amounts stay
// numeric.

const BOM = "﻿";
const CRLF = String.fromCharCode(13, 10);
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildChargesCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const header = columns.map((c) => cell(EXPORT_HEADERS[c] ?? c)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join(","));
  return BOM + [header, ...body].join("\r\n") + "\r\n";
}

/** A download name that is safe in a header and on every file system. */
export function exportFileName(exportNo: string, period: string, layout: string, full: boolean): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "-");
  return `${safe(exportNo)}_${safe(period)}_${layout.toLowerCase()}${full ? "_full" : ""}.csv`;
}

const CSV_DIGITS: Partial<Record<ColKind, number>> = { money: 2, money4: 4 };

/** One report cell as CSV text: money at fixed decimals, quantities trimmed to 4 dp, text made formula-safe. */
function reportCell(kind: ColKind, value: string | number | null): string {
  if (typeof value !== "number") return cell(value);
  const digits = CSV_DIGITS[kind];
  return digits === undefined ? String(Math.round(value * 10000) / 10000) : value.toFixed(digits);
}

/** CSV of a report result (same UTF-8 BOM / CRLF / formula-safe text as the charge export). Headers are the already translated column labels. */
export function buildReportCsv(columns: ReportColumn[], rows: ReportRow[], totals: ReportRow | null): string {
  const header = columns.map((c) => cell(c.label)).join(",");
  const line = (r: ReportRow) => columns.map((c) => reportCell(c.kind, r[c.key] ?? null)).join(",");
  const body = [...rows.map(line), ...(totals ? [line(totals)] : [])];
  return BOM + [header, ...body].join(CRLF) + CRLF;
}

/** Download name for a report export, e.g. inventory-ledger_ALMA_2026-09-29.csv. */
export function reportFileName(report: string, branchLabel: string, day: string, extension: "csv" | "pdf"): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "-");
  return `inventory-${safe(report)}_${safe(branchLabel)}_${safe(day)}.${extension}`;
}
