import { getServerTranslator } from "@/lib/i18n/server";
import { INV_TIER, formatQty, uomLabel } from "@/lib/inventory/core";
import { loadCatalogue, loadLocations } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../../shell";
import { SetupSubTabs } from "../../inventory-tabs";
import { EmptyState } from "../../components/form-bits";
import { LevelCell } from "./level-cell";

// Per-location max qty (D-101): an override of the product's default max for
// this branch's Store or Floor. Branch ADMIN only (tier STOCK_LEVELS); others read.
export default async function InventoryLevelsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const ctx = await requireInventory(searchParams);
  const { t } = await getServerTranslator();
  const branchId = ctx.branchId;
  const canEdit = ctx.rank >= INV_TIER.STOCK_LEVELS;
  let body: React.ReactNode = null;

  if (branchId !== null) {
    const [locations, catalogue, levelsRes] = await Promise.all([
      loadLocations(ctx.supabase, branchId),
      loadCatalogue(ctx.supabase),
      ctx.supabase.from("tbl_inv_stock_levels").select("location_id, product_id, max_qty").eq("branch_id", branchId),
    ]);
    const store = locations.find((l) => l.kind === "STORE");
    const floor = locations.find((l) => l.kind === "FLOOR");
    const levels = new Map((levelsRes.data ?? []).map((l) => [`${l.location_id}:${l.product_id}`, Number(l.max_qty)]));
    const products = catalogue.products.filter((p) => p.isStockItem);
    body =
      products.length === 0 || !store || !floor ? (
        <EmptyState text={t("No stock products yet.")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">{t("Product")}</th>
                <th className="px-3 py-2 font-medium">{t("Unit")}</th>
                <th className="px-3 py-2 font-medium">{t("Store max")}</th>
                <th className="px-3 py-2 font-medium">{t("Floor max")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 text-fg">
                    {p.name} <span className="text-xs text-fg-subtle">{p.sku}</span>
                  </td>
                  <td className="px-3 py-2 text-fg-subtle">{uomLabel(catalogue.uoms, p.baseUomId)}</td>
                  {[
                    { loc: store, def: p.defaultMaxStore },
                    { loc: floor, def: p.defaultMaxFloor },
                  ].map(({ loc, def }) => {
                    const current = levels.get(`${loc.id}:${p.id}`);
                    return (
                      <td key={loc.id} className="px-3 py-2">
                        {canEdit ? (
                          <LevelCell locationId={loc.id} productId={p.id} current={current ?? null} fallback={def} />
                        ) : (
                          <span className="text-fg-secondary">{formatQty(current ?? def)}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }

  return (
    <InventoryShell ctx={ctx} title="Setup">
      <SetupSubTabs branchId={branchId} />
      {body}
    </InventoryShell>
  );
}
