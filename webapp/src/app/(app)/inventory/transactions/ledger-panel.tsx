import { getServerTranslator } from "@/lib/i18n/server";
import { INV_TIER, LOCATION_KIND_OPTIONS, TXN_TYPE_LABELS, formatMoney, formatQty, labelOf } from "@/lib/inventory/core";
import { isDemoBranch, loadStaff } from "@/lib/inventory/server";
import type { InventoryContext } from "@/lib/inventory/server";
import { ReportQueryError } from "@/lib/inventory/reports/report-core";
import { queryLedger, type LedgerLine } from "@/lib/inventory/reports/report-stock";
import { loadFilterOptions } from "@/lib/inventory/reports/filter-options";
import type { RawParams } from "@/lib/inventory/reports/params";
import { MAX_RANGE_DAYS, REPORTS, SCREEN_ROW_CAP } from "@/lib/inventory/reports/types";
import { EmptyState } from "../components/form-bits";
import { ExportButtons } from "../components/export-buttons";
import { ReportFilters } from "../components/report-filters";
import { rangeMessage, readReportParams } from "../components/report-section";
import { ReverseButton } from "./reverse-button";

const NOT_REVERSIBLE = new Set(["REVERSAL", "BRANCH_TRANSFER_OUT"]); // a dispatch is cancelled on Transfers

type TxnGroup = { txnId: number; txnNo: string; txnType: string; txnDate: string; staff: string; remarks: string | null; isReversed: boolean; lines: LedgerLine[] };

/** Ledger lines (already newest first) gathered under their transaction, order kept. */
function groupByTxn(lines: LedgerLine[]): TxnGroup[] {
  const groups = new Map<number, TxnGroup>();
  for (const l of lines) {
    const group = groups.get(l.txnId) ?? {
      txnId: l.txnId,
      txnNo: l.txnNo,
      txnType: l.txnType,
      txnDate: l.txnDate,
      staff: l.staff,
      remarks: l.remarks,
      isReversed: l.isReversed,
      lines: [],
    };
    groups.set(l.txnId, { ...group, lines: [...group.lines, l] });
  }
  return [...groups.values()];
}

// The branch movements in a date range, newest first, with their lines,
// filtered by product (barcode / name / SKU), storage location and
// transaction type; PDF and CSV export the same filtered view (Phase 7).
// MODERATOR/ADMIN get a Reverse action (reversal posts into an open period;
// an opening balance needs ADMIN): schema/011 inv_reverse_txn.
export async function LedgerPanel({ ctx, raw }: { ctx: InventoryContext; raw: RawParams }) {
  const { t, language } = await getServerTranslator();
  const branchId = ctx.branchId;
  if (branchId === null) return null;
  const def = REPORTS.ledger;
  const showCost = ctx.rank >= INV_TIER.VIEW_COST;
  const canReverse = ctx.rank >= INV_TIER.REVERSE;
  const { params, error } = readReportParams("ledger", raw);
  const options = await loadFilterOptions(ctx, branchId, "ledger", language);

  let lines: LedgerLine[] = [];
  let truncated = false;
  let failed = false;
  if (!error) {
    try {
      ({ lines, truncated } = await queryLedger({ sb: ctx.supabase, branchId, rank: ctx.rank, isHqAdmin: ctx.isHqAdmin, t, cap: SCREEN_ROW_CAP, params }));
    } catch (e) {
      failed = true;
      console.error("inventory ledger failed", e instanceof ReportQueryError ? e.message : e);
    }
  }
  const txns = groupByTxn(lines);
  const staff = canReverse && txns.length > 0 ? await loadStaff(ctx.supabase, branchId, await isDemoBranch(branchId)) : [];
  const partial = Boolean(params.q || params.location || params.type);

  return (
    <div className="space-y-4">
      <ReportFilters
        report="ledger"
        filters={def.filters}
        params={params}
        options={options}
        branchId={branchId}
        action="/inventory/transactions"
        hidden={{ tab: "ledger" }}
        requiredRange
        rangeError={rangeMessage(error, t)}
        t={t}
      />
      {failed && <EmptyState text={t("The report could not be loaded. Please try again.")} />}
      {!error && !failed && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-subtle">
              {t("From {from} to {to} (at most {days} days).", { from: params.from, to: params.to, days: MAX_RANGE_DAYS })}
              {partial && ` ${t("Only the lines that match the filters are shown.")}`}
            </p>
            <ExportButtons report="ledger" filters={def.filters} params={params} branchId={branchId} labels={{ csv: t("Download CSV"), pdf: t("Open PDF") }} />
          </div>
          {txns.length === 0 ? (
            <EmptyState text={t("No transactions for these filters.")} />
          ) : (
            <div className="space-y-3">
              {txns.map((x) => {
                const reversible =
                  canReverse &&
                  !NOT_REVERSIBLE.has(x.txnType) &&
                  !x.isReversed &&
                  (x.txnType !== "OPENING_BALANCE" || ctx.rank >= INV_TIER.OPENING_BALANCE);
                return (
                  <div key={x.txnId} className="rounded-lg border border-line bg-surface shadow-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-subtle px-4 py-2 text-sm">
                      <span className="font-semibold text-fg">{x.txnNo}</span>
                      <span className="rounded bg-surface-strong px-2 py-0.5 text-xs text-fg-secondary">{t(TXN_TYPE_LABELS[x.txnType] ?? x.txnType)}</span>
                      <span className="text-fg-subtle">{x.txnDate}</span>
                      <span className="text-fg-subtle">{x.staff}</span>
                      {x.isReversed && (
                        <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{t("Reversed")}</span>
                      )}
                      <span className="flex-1" />
                      {reversible && <ReverseButton txnId={x.txnId} txnNo={x.txnNo} staff={staff} />}
                    </div>
                    {x.remarks && <p className="px-4 pt-2 text-xs text-fg-subtle">{x.remarks}</p>}
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-line-subtle">
                        {x.lines.map((l) => (
                          <tr key={l.id}>
                            <td className="px-4 py-1.5 text-fg">
                              {l.productName} <span className="text-xs text-fg-subtle">{l.sku}</span>
                            </td>
                            <td className="px-2 py-1.5 text-fg-secondary">{t(labelOf(LOCATION_KIND_OPTIONS, l.locationKind))}</td>
                            <td className={`px-2 py-1.5 text-right ${l.qtyBase < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                              {l.qtyBase > 0 ? "+" : ""}
                              {formatQty(l.qtyBase)}
                            </td>
                            <td className="px-2 py-1.5 text-fg-subtle">
                              {formatQty(l.qtyEntered)} {l.uomCode}
                            </td>
                            {showCost && <td className="px-4 py-1.5 text-right text-fg-secondary">{formatMoney(l.value)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
          {truncated && (
            <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
              {t("Showing the first {count} rows. Narrow the filters, or export to see more.", { count: SCREEN_ROW_CAP })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
