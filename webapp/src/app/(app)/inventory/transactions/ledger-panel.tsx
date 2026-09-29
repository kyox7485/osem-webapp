import { getServerTranslator } from "@/lib/i18n/server";
import { INV_TIER, LOCATION_KIND_OPTIONS, TXN_TYPE_LABELS, formatMoney, formatQty, labelOf } from "@/lib/inventory/core";
import { isDemoBranch, loadStaff } from "@/lib/inventory/server";
import type { InventoryContext } from "@/lib/inventory/server";
import { EmptyState } from "../components/form-bits";
import { ReverseButton } from "./reverse-button";

const PAGE_SIZE = 100;
const NOT_REVERSIBLE = new Set(["REVERSAL", "BRANCH_TRANSFER_OUT"]); // a dispatch is cancelled on Transfers

type LineRow = {
  line_no: number;
  location_kind: string;
  qty_base: number;
  uom_code: string;
  qty_entered: number;
  value: number;
  tbl_inv_products: { name: string; sku: string } | { name: string; sku: string }[] | null;
};
type TxnRow = {
  id: number;
  txn_no: string;
  txn_type: string;
  txn_date: string;
  performed_by_staff: string;
  reason_code: string | null;
  remarks: string | null;
  reverses_txn_id: number | null;
  tbl_inv_txn_lines: LineRow[];
};

// The latest movements of the branch, newest first, with their lines.
// MODERATOR/ADMIN get a Reverse action (reversal posts into an open period;
// an opening balance needs ADMIN) — schema/011 inv_reverse_txn.
export async function LedgerPanel({ ctx }: { ctx: InventoryContext }) {
  const { t } = await getServerTranslator();
  const showCost = ctx.rank >= INV_TIER.VIEW_COST;
  const canReverse = ctx.rank >= INV_TIER.REVERSE;

  let txns: TxnRow[] = [];
  const reversed = new Set<number>();
  let staff: Awaited<ReturnType<typeof loadStaff>> = [];
  if (ctx.branchId !== null) {
    const { data } = await ctx.supabase
      .from("tbl_inv_txns")
      .select(
        "id, txn_no, txn_type, txn_date, performed_by_staff, reason_code, remarks, reverses_txn_id, tbl_inv_txn_lines(line_no, location_kind, qty_base, uom_code, qty_entered, value, tbl_inv_products(name, sku))"
      )
      .eq("branch_id", ctx.branchId)
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
    txns = (data ?? []) as unknown as TxnRow[];
    const ids = txns.map((x) => x.id);
    if (ids.length > 0) {
      const { data: revs } = await ctx.supabase.from("tbl_inv_txns").select("reverses_txn_id").in("reverses_txn_id", ids);
      (revs ?? []).forEach((r) => reversed.add(Number(r.reverses_txn_id)));
    }
    if (canReverse) staff = await loadStaff(ctx.supabase, ctx.branchId, await isDemoBranch(ctx.branchId));
  }

  return (
    <>
      {txns.length === 0 ? (
        <EmptyState text={t("No transactions yet.")} />
      ) : (
        <div className="space-y-3">
          {txns.map((x) => {
            const reversible =
              canReverse &&
              !NOT_REVERSIBLE.has(x.txn_type) &&
              !reversed.has(x.id) &&
              (x.txn_type !== "OPENING_BALANCE" || ctx.rank >= INV_TIER.OPENING_BALANCE);
            return (
              <div key={x.id} className="rounded-lg border border-line bg-surface shadow-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-subtle px-4 py-2 text-sm">
                  <span className="font-semibold text-fg">{x.txn_no}</span>
                  <span className="rounded bg-surface-strong px-2 py-0.5 text-xs text-fg-secondary">{t(TXN_TYPE_LABELS[x.txn_type] ?? x.txn_type)}</span>
                  <span className="text-fg-subtle">{x.txn_date}</span>
                  <span className="text-fg-subtle">{x.performed_by_staff}</span>
                  {reversed.has(x.id) && (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{t("Reversed")}</span>
                  )}
                  <span className="flex-1" />
                  {reversible && <ReverseButton txnId={x.id} txnNo={x.txn_no} staff={staff} />}
                </div>
                {x.remarks && <p className="px-4 pt-2 text-xs text-fg-subtle">{x.remarks}</p>}
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line-subtle">
                    {[...x.tbl_inv_txn_lines]
                      .sort((a, b) => a.line_no - b.line_no)
                      .map((l) => {
                        const p = Array.isArray(l.tbl_inv_products) ? l.tbl_inv_products[0] : l.tbl_inv_products;
                        return (
                          <tr key={l.line_no}>
                            <td className="px-4 py-1.5 text-fg">{p?.name}</td>
                            <td className="px-2 py-1.5 text-fg-secondary">{t(labelOf(LOCATION_KIND_OPTIONS, l.location_kind))}</td>
                            <td className={`px-2 py-1.5 text-right ${Number(l.qty_base) < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                              {Number(l.qty_base) > 0 ? "+" : ""}
                              {formatQty(l.qty_base)}
                            </td>
                            <td className="px-2 py-1.5 text-fg-subtle">
                              {formatQty(l.qty_entered)} {l.uom_code}
                            </td>
                            {showCost && <td className="px-4 py-1.5 text-right text-fg-secondary">{formatMoney(l.value)}</td>}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
