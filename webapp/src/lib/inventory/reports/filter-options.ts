import "server-only";
import { loadCategories, loadPeriods, loadSuppliers, type InventoryContext } from "../server";
import { REPORTS, STATIC_FILTER_OPTIONS, type FilterKey, type ReportKey } from "./types";

export type FilterOption = { value: string; label: string };

/**
 * Options for the select filters of a report: the fixed vocabularies (labels
 * stay English keys, the form translates them) plus the branch categories,
 * suppliers and (Valuation only) locked months, which are loaded per request.
 */
export async function loadFilterOptions(
  ctx: InventoryContext,
  branchId: number,
  report: ReportKey,
  language: "en" | "ms"
): Promise<Partial<Record<FilterKey, FilterOption[]>>> {
  const filters = REPORTS[report].filters;
  const out: Partial<Record<FilterKey, FilterOption[]>> = {};
  for (const key of filters) {
    const fixed = STATIC_FILTER_OPTIONS[key];
    if (fixed) out[key] = fixed.map((o) => ({ value: o.value, label: o.label }));
  }
  const [categories, suppliers, periods] = await Promise.all([
    filters.includes("category") ? loadCategories(ctx.supabase) : Promise.resolve([]),
    filters.includes("supplier") ? loadSuppliers(ctx.supabase, { includeInactive: true }) : Promise.resolve([]),
    report === "valuation" ? loadPeriods(ctx.supabase, branchId) : Promise.resolve([]),
  ]);
  if (filters.includes("category")) {
    out.category = categories.map((c) => ({ value: String(c.id), label: language === "ms" && c.nameMs ? c.nameMs : c.name }));
  }
  if (filters.includes("supplier")) {
    out.supplier = suppliers.map((s) => ({ value: String(s.id), label: s.name }));
  }
  if (report === "valuation") {
    out.month = periods.filter((p) => p.status === "LOCKED").map((p) => ({ value: p.month.slice(0, 7), label: p.month.slice(0, 7) }));
  }
  return out;
}
