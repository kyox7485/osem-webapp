import "server-only";
import { loadCategories, loadSuppliers } from "../server";
import { ReportQueryError, type ReportCtx } from "./report-core";
import { loadCountsReport, loadReceivingReport, loadRequestsReport, loadTransfersReport } from "./report-docs";
import { loadChargesReport, loadExpenseReport, loadValuationReport } from "./report-money";
import { loadLedgerReport, loadStockReport, loadSuggestedReport } from "./report-stock";
import { REPORTS, STATIC_FILTER_OPTIONS, filterLabel, type FilterKey, type ReportKey, type ReportResult } from "./types";

const LOADERS: Record<ReportKey, (ctx: ReportCtx) => Promise<ReportResult>> = {
  stock: loadStockReport,
  ledger: loadLedgerReport,
  valuation: loadValuationReport,
  suggested: loadSuggestedReport,
  receiving: loadReceivingReport,
  transfers: loadTransfersReport,
  requests: loadRequestsReport,
  charges: loadChargesReport,
  expense: loadExpenseReport,
  counts: loadCountsReport,
};

/** "Label: value" pairs describing the active filters, for the PDF header. */
async function describeFilters(ctx: ReportCtx, key: ReportKey): Promise<{ label: string; value: string }[]> {
  const { t, params, sb } = ctx;
  const out: { label: string; value: string }[] = [];
  const add = (filter: FilterKey, value: string) => {
    if (value) out.push({ label: t(filterLabel(key, filter)), value });
  };
  const [categories, suppliers] = await Promise.all([
    REPORTS[key].filters.includes("category") && params.category !== null ? loadCategories(sb) : Promise.resolve([]),
    REPORTS[key].filters.includes("supplier") && params.supplier !== null ? loadSuppliers(sb, { includeInactive: true }) : Promise.resolve([]),
  ]);
  for (const filter of REPORTS[key].filters) {
    switch (filter) {
      case "category":
        add(filter, categories.find((c) => c.id === params.category)?.name ?? "");
        break;
      case "supplier":
        add(filter, suppliers.find((s) => s.id === params.supplier)?.name ?? "");
        break;
      case "q":
      case "from":
      case "to":
        add(filter, params[filter]);
        break;
      case "month":
        add(filter, params.month);
        break;
      default: {
        const value = String(params[filter] ?? "");
        const label = STATIC_FILTER_OPTIONS[filter]?.find((o) => o.value === value)?.label;
        if (label && value) add(filter, t(label));
      }
    }
  }
  return out;
}

/** Runs one report. Never throws: a failed query comes back as `error: "QUERY_FAILED"`. */
export async function loadReport(key: ReportKey, ctx: ReportCtx): Promise<ReportResult> {
  try {
    const result = await LOADERS[key](ctx);
    return { ...result, filters: await describeFilters(ctx, key) };
  } catch (error) {
    console.error(`inventory report ${key} failed`, error instanceof ReportQueryError ? error.message : error);
    return {
      key,
      title: ctx.t(REPORTS[key].label),
      columns: [],
      rows: [],
      totals: null,
      truncated: false,
      notes: [],
      filters: [],
      error: "QUERY_FAILED",
    };
  }
}

export type { ReportCtx };
