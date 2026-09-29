import { isDemoBranch, loadCatalogue, loadLocations, loadResidents, loadStaff } from "@/lib/inventory/server";
import type { InventoryContext } from "@/lib/inventory/server";
import { WriteOffForm } from "./write-off-form";

// Damaged / expired stock written off at WAC from Store, Floor or a
// resident's Transit bucket. No limit or approval (owner decision D-158).
export async function WriteOffPanel({ ctx }: { ctx: InventoryContext }) {
  const branchId = ctx.branchId;
  const data =
    branchId === null
      ? null
      : await Promise.all([
          loadLocations(ctx.supabase, branchId),
          loadCatalogue(ctx.supabase),
          isDemoBranch(branchId).then((demo) => loadStaff(ctx.supabase, branchId, demo)),
          loadResidents(ctx.supabase, branchId, false),
        ]);
  return (
    data && <WriteOffForm key={branchId} locations={data[0]} catalogue={data[1]} staff={data[2]} residents={data[3]} />
  );
}
