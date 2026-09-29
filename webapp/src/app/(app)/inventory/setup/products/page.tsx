import { INV_TIER } from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadCategories, loadStaff, loadSuppliers } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../../shell";
import { SetupSubTabs } from "../../inventory-tabs";
import { ProductsModule } from "./products-module";

// Product master (D-102, D-106, D-128). Global products: HQ ADMIN only; the
// DEMO login edits only its own demo-owned products. Branch logins read the
// catalogue and may attach a barcode to a global product (senior staff).
export default async function InventoryProductsPage({ searchParams }: { searchParams: Promise<{ branch?: string; product?: string }> }) {
  const ctx = await requireInventory(searchParams);
  const { product } = await searchParams;
  const branchId = ctx.branchId;
  const data =
    branchId === null
      ? null
      : await Promise.all([
          loadCatalogue(ctx.supabase, { includeInactive: true }),
          loadCategories(ctx.supabase),
          loadSuppliers(ctx.supabase),
          isDemoBranch(branchId).then((demo) => loadStaff(ctx.supabase, branchId, demo)),
        ]);
  const canCreate = ctx.isHqAdmin || (ctx.isDemoUser && ctx.rank >= 4);

  return (
    <InventoryShell ctx={ctx} title="Setup" minRank={INV_TIER.VIEW}>
      <SetupSubTabs branchId={branchId} />
      {data && (
        <ProductsModule
          key={`${branchId}-${product ?? ""}`}
          catalogue={data[0]}
          categories={data[1]}
          suppliers={data[2]}
          staff={data[3]}
          canCreate={canCreate}
          isHqAdmin={ctx.isHqAdmin}
          isDemoAdmin={ctx.isDemoUser && ctx.rank >= 4}
          canAttachBarcode={!ctx.isDemoUser && ctx.rank >= INV_TIER.BARCODE_ATTACH}
          initialProductId={product ? Number(product) : null}
        />
      )}
    </InventoryShell>
  );
}
