import { isDemoBranch, loadCatalogue, loadLocations, loadResidents, loadStaff } from "@/lib/inventory/server";
import type { InventoryContext } from "@/lib/inventory/server";
import { IssueForm } from "./issue-form";

// Issue to a resident (charged at the frozen catalogue price) or to OSEM
// expense, from Store, Floor or the resident's own Transit bucket.
export async function IssuePanel({ ctx }: { ctx: InventoryContext }) {
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
    data && <IssueForm key={branchId} locations={data[0]} catalogue={data[1]} staff={data[2]} residents={data[3]} />
  );
}
