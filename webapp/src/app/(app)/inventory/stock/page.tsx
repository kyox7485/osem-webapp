import { getServerTranslator } from "@/lib/i18n/server";
import { INV_TIER, LOCATION_KIND_OPTIONS, formatMoney, formatQty, labelOf } from "@/lib/inventory/core";
import { InventoryShell, requireInventory } from "../shell";
import { EmptyState } from "../components/form-bits";

const MAX_ROWS = 1000;

// Stock on hand per bucket (Store, Floor, Transit per resident) for the
// selected branch, from v_inv_stock_balance (RLS: the caller's scope).
// Costs are shown from the Head-Nurse tier up (§8.4 row 2).
export default async function InventoryStockPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const ctx = await requireInventory(searchParams);
  const { t } = await getServerTranslator();
  const showCost = ctx.rank >= INV_TIER.VIEW_COST;

  type Row = {
    location_kind: string;
    product_id: number;
    sku: string;
    product_name: string;
    resident_id: number | null;
    qty: number;
    effective_max: number | null;
    pool_wac: number | null;
    value_at_wac: number | null;
  };
  let rows: Row[] = [];
  const residentNames = new Map<number, string>();
  if (ctx.branchId !== null) {
    const { data } = await ctx.supabase
      .from("v_inv_stock_balance")
      .select("location_kind, product_id, sku, product_name, resident_id, qty, effective_max, pool_wac, value_at_wac")
      .eq("branch_id", ctx.branchId)
      .neq("qty", 0)
      .order("product_name")
      .limit(MAX_ROWS);
    rows = (data ?? []) as Row[];
    const residentIds = [...new Set(rows.map((r) => r.resident_id).filter((id): id is number => id !== null))];
    if (residentIds.length > 0) {
      const { data: res } = await ctx.supabase.from("tbl_residents").select("id, resident_name").in("id", residentIds);
      (res ?? []).forEach((r) => residentNames.set(Number(r.id), r.resident_name));
    }
  }

  return (
    <InventoryShell ctx={ctx} title="Stock">
      {rows.length === 0 ? (
        <EmptyState text={t("No stock recorded yet.")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">{t("Product")}</th>
                <th className="px-3 py-2 font-medium">{t("Location")}</th>
                <th className="px-3 py-2 font-medium">{t("Resident")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Qty (base unit)")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Max")}</th>
                {showCost && <th className="px-3 py-2 text-right font-medium">{t("WAC")}</th>}
                {showCost && <th className="px-3 py-2 text-right font-medium">{t("Value (indicative)")}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {rows.map((r, i) => {
                const low = r.effective_max !== null && Number(r.qty) < 0;
                return (
                  <tr key={i} className="hover:bg-hover">
                    <td className="px-3 py-2 text-fg">
                      {r.product_name} <span className="text-xs text-fg-subtle">{r.sku}</span>
                    </td>
                    <td className="px-3 py-2 text-fg-secondary">{t(labelOf(LOCATION_KIND_OPTIONS, r.location_kind))}</td>
                    <td className="px-3 py-2 text-fg-secondary">{r.resident_id ? residentNames.get(r.resident_id) ?? r.resident_id : ""}</td>
                    <td className={`px-3 py-2 text-right font-medium ${Number(r.qty) < 0 || low ? "text-red-600 dark:text-red-400" : "text-fg"}`}>
                      {formatQty(r.qty)}
                    </td>
                    <td className="px-3 py-2 text-right text-fg-subtle">{formatQty(r.effective_max)}</td>
                    {showCost && <td className="px-3 py-2 text-right text-fg-secondary">{formatMoney(r.pool_wac, 4)}</td>}
                    {showCost && <td className="px-3 py-2 text-right text-fg-secondary">{formatMoney(r.value_at_wac)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </InventoryShell>
  );
}
