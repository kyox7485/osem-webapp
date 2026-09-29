import { INV_TIER } from "@/lib/inventory/core";
import { isDemoBranch, loadStaff, loadSuppliers } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../../shell";
import { SetupSubTabs } from "../../inventory-tabs";
import { SuppliersModule } from "./suppliers-module";

// Suppliers (§8.3): global rows by HQ ADMIN or a real branch's Head-Nurse tier
// (senior staff attributed); the DEMO login keeps its own demo-owned list.
export default async function InventorySuppliersPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const ctx = await requireInventory(searchParams);
  const branchId = ctx.branchId;
  const data =
    branchId === null
      ? null
      : await Promise.all([
          loadSuppliers(ctx.supabase, { includeInactive: true }),
          isDemoBranch(branchId).then((demo) => loadStaff(ctx.supabase, branchId, demo)),
        ]);
  const demoAdmin = ctx.isDemoUser && ctx.rank >= 4;
  const branchEditor = !ctx.isDemoUser && !ctx.isHqAdmin && ctx.rank >= INV_TIER.SUPPLIER_EDIT && ctx.account.branch_function === "NUR";

  return (
    <InventoryShell ctx={ctx} title="Setup">
      <SetupSubTabs branchId={branchId} />
      {data && (
        <SuppliersModule
          key={branchId}
          suppliers={data[0]}
          staff={data[1]}
          canEditGlobal={ctx.isHqAdmin || branchEditor}
          needsStaff={branchEditor}
          canEditDemo={demoAdmin}
          canCreate={ctx.isHqAdmin || branchEditor || demoAdmin}
        />
      )}
    </InventoryShell>
  );
}
