import { getServerTranslator } from "@/lib/i18n/server";
import { currentMonthKL, INV_TIER } from "@/lib/inventory/core";
import type { InventoryContext } from "@/lib/inventory/server";
import { loadReport } from "@/lib/inventory/reports";
import { loadFilterOptions } from "@/lib/inventory/reports/filter-options";
import { parseReportParams, type RawParams } from "@/lib/inventory/reports/params";
import { MAX_RANGE_DAYS, REPORTS, SCREEN_ROW_CAP, type ReportKey, type ReportParams } from "@/lib/inventory/reports/types";
import { EmptyState } from "./form-bits";
import { ExportButtons } from "./export-buttons";
import { ReportFilters } from "./report-filters";
import { ReportTable } from "./report-table";

/** Validated filters for a report page, with the per-report defaults applied. */
export function readReportParams(report: ReportKey, raw: RawParams) {
  const parsed = parseReportParams(raw, REPORTS[report].filters);
  // Resident charges are always one month: default to the current one so the form and the export links carry it.
  const params: ReportParams = report === "charges" && !parsed.params.month ? { ...parsed.params, month: currentMonthKL() } : parsed.params;
  return { params, error: parsed.error };
}

/** Translated message for a date-range problem, or null. */
export function rangeMessage(error: "RANGE_INVALID" | "RANGE_TOO_LONG" | null, t: (text: string, p?: Record<string, string | number>) => string) {
  if (error === "RANGE_INVALID") return t("The start date must not be after the end date.");
  if (error === "RANGE_TOO_LONG") return t("The date range can be at most {days} days.", { days: MAX_RANGE_DAYS });
  return null;
}

/**
 * One report on a page: filter form (GET, so the URL carries the filters),
 * PDF and CSV links for the same filters, and the on-screen table capped at
 * 500 rows. The rank is re-checked here; the export route checks it again.
 */
export async function ReportSection({
  ctx,
  report,
  raw,
  action,
  hidden,
}: {
  ctx: InventoryContext;
  report: ReportKey;
  raw: RawParams;
  action: string;
  hidden?: Record<string, string>;
}) {
  const def = REPORTS[report];
  const { t, language } = await getServerTranslator();
  const branchId = ctx.branchId;
  if (branchId === null || ctx.rank < def.minRank) return <EmptyState text={t("You are not allowed to do this here.")} />;

  const { params, error } = readReportParams(report, raw);
  const [options, result] = await Promise.all([
    loadFilterOptions(ctx, branchId, report, language),
    error ? Promise.resolve(null) : loadReport(report, { sb: ctx.supabase, branchId, rank: ctx.rank, isHqAdmin: ctx.isHqAdmin, t, cap: SCREEN_ROW_CAP, params }),
  ]);

  return (
    <div className="space-y-4">
      <ReportFilters
        report={report}
        filters={def.filters}
        params={params}
        options={options}
        branchId={branchId}
        action={action}
        hidden={hidden}
        requiredRange={def.ranged}
        rangeError={rangeMessage(error, t)}
        t={t}
      />
      {result?.error && <EmptyState text={t("The report could not be loaded. Please try again.")} />}
      {result && !result.error && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">{result.title}</h2>
            <ExportButtons report={report} filters={def.filters} params={params} branchId={branchId} labels={{ csv: t("Download CSV"), pdf: t("Open PDF") }} />
          </div>
          <ReportTable
            report={result}
            emptyText={t("No rows for these filters.")}
            truncatedText={t("Showing the first {count} rows. Narrow the filters, or export to see more.", { count: SCREEN_ROW_CAP })}
            canQuickEdit={ctx.rank >= INV_TIER.PRODUCT_EDIT}
          />
        </>
      )}
    </div>
  );
}
