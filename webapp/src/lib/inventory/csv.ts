import { EXPORT_HEADERS } from "./core";

// CSV builder for the charge export (schema/019 inv_export_charges). UTF-8 with
// a BOM so Excel and Bukku read the accents; CRLF line ends; every text cell
// quoted only when needed. A text cell that starts with = + - @ (or a control
// character) is prefixed with an apostrophe so a spreadsheet cannot run it as
// a formula; numbers and booleans are never touched, so negative amounts stay
// numeric.

const BOM = "﻿";
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
