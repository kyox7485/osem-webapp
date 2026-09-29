import { getServerTranslator } from "@/lib/i18n/server";
import {
  INV_TIER,
  currentMonthKL,
  formatMoney,
  groupCharges,
  isMonthParam,
  type InvCatalogue,
} from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadCharges, loadPeriods, loadResidents, loadStaff } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../shell";
import { resolveSubTabs, type SubTabDef } from "../components/sub-page";
import { SubTabs } from "../components/sub-tabs";
import { EmptyState } from "../components/form-bits";
import { ChargesFilters } from "./charges-filters";
import { ChargesTable } from "./charges-table";
import { ManualAdjustmentForm } from "./manual-adjustment-form";
import { ServiceChargeForm } from "./service-charge-form";

const TABS: SubTabDef[] = [
  { key: "charges", label: "Charges", minRank: INV_TIER.VIEW_CHARGES },
  { key: "service", label: "Charge a service", minRank: INV_TIER.SERVICE_CHARGE },
  { key: "adjust", label: "Manual adjustment", minRank: INV_TIER.MANUAL_CHARGE_ADJ },
];

// Resident charges (D-70, D-121, D-75). The branch login (rank 2) may read
// them (D-148) and charge a service; pricing, reversing a service charge and
// manual adjustments are moderator actions.
export default async function InventoryChargesPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; month?: string; resident?: string; tab?: string }>;
}) {
  const ctx = await requireInventory(searchParams);
  const sp = await searchParams;
  const { t } = await getServerTranslator();
  const branchId = ctx.branchId;
  if (branchId === null || ctx.rank < INV_TIER.VIEW_CHARGES) {
    return (
      <InventoryShell ctx={ctx} title="Charges" minRank={INV_TIER.VIEW_CHARGES}>
        {null}
      </InventoryShell>
    );
  }

  const month = isMonthParam(sp.month) ? sp.month : currentMonthKL();
  const residentFilter = Number(sp.resident) > 0 ? Number(sp.resident) : null;
  const { allowed, active } = resolveSubTabs(TABS, ctx.rank, sp.tab);

  const demo = await isDemoBranch(branchId);
  const needCatalogue = active === "service";
  const emptyCatalogue: InvCatalogue = { products: [], uoms: [], barcodes: [] };
  const [rows, residents, staff, periods, catalogue] = await Promise.all([
    loadCharges(ctx.supabase, branchId, month, residentFilter),
    loadResidents(ctx.supabase, branchId, false),
    loadStaff(ctx.supabase, branchId, demo),
    loadPeriods(ctx.supabase, branchId),
    needCatalogue ? loadCatalogue(ctx.supabase) : Promise.resolve(emptyCatalogue),
  ]);
  const lines = groupCharges(rows);
  const residentName = new Map(residents.map((r) => [r.id, r.name]));
  const isLocked = periods.some((p) => p.month.slice(0, 7) === month && p.status === "LOCKED");

  const totals = new Map<number, number>();
  for (const r of rows) {
    if (r.residentId !== null) totals.set(r.residentId, Math.round(((totals.get(r.residentId) ?? 0) + r.amount) * 100) / 100);
  }
  const monthTotal = Math.round([...totals.values()].reduce((a, b) => a + b, 0) * 100) / 100;

  return (
    <InventoryShell ctx={ctx} title="Charges" minRank={INV_TIER.VIEW_CHARGES}>
      <SubTabs basePath="/inventory/charges" items={allowed} active={active} branchId={branchId} />
      {active === "charges" && (
        <div className="space-y-6">
          <ChargesFilters
            branchId={branchId}
            month={month}
            residentId={residentFilter}
            residents={residents.map((r) => ({ id: r.id, label: r.residentCode ? `${r.name} (${r.residentCode})` : r.name }))}
          />
          {isLocked && <p className="text-sm text-amber-700 dark:text-amber-300">{t("This month is locked.")}</p>}
          {lines.length === 0 ? (
            <EmptyState text={t("No charges in this month.")} />
          ) : (
            <>
              <ChargesTable
                key={`${branchId}-${month}-${residentFilter ?? "all"}`}
                lines={lines}
                residentNames={Object.fromEntries(residentName)}
                rank={ctx.rank}
                staff={staff}
                isLocked={isLocked}
              />
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-fg">{t("Totals by resident")}</h2>
                <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t("Resident")}</th>
                        <th className="px-3 py-2 text-right font-medium">{t("Amount")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-subtle">
                      {[...totals.entries()]
                        .sort((a, b) => (residentName.get(a[0]) ?? "").localeCompare(residentName.get(b[0]) ?? ""))
                        .map(([id, total]) => (
                          <tr key={id}>
                            <td className="px-3 py-2 text-fg">{residentName.get(id) ?? `#${id}`}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-fg">RM {formatMoney(total)}</td>
                          </tr>
                        ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line font-semibold">
                        <td className="px-3 py-2 text-fg">{t("Total")}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg">RM {formatMoney(monthTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}
      {active === "service" && (
        <ServiceChargeForm
          key={branchId}
          catalogue={catalogue}
          staff={staff}
          residents={residents.filter((r) => r.status === "ACTIVE")}
        />
      )}
      {active === "adjust" && (
        <ManualAdjustmentForm
          key={branchId}
          staff={staff}
          residents={residents}
          charges={lines.filter((l) => !l.isChild && l.residentId !== null)}
          month={month}
        />
      )}
    </InventoryShell>
  );
}
