import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { loadCatalogue, loadResidentLines, loadStaffOptions, type StaffPick } from "@/lib/consumables-server";
import type { CatalogueItem, ConsumableLine } from "@/lib/consumables";
import { ResidentsModuleTabs } from "../../module-tabs";
import { ConsumablesSubTabs } from "../consumables-tabs";
import { InventoryModule, type InventoryResident, type InventoryView } from "./inventory-module";

// Weekly count, resident by resident, in two sub-tabs (?view=):
//   new (default) — the count sheet: every RestockRequired catalogue item is
//     listed automatically, plus any other item the resident already has;
//     saving appends a count row per item (Sheet first, then Supabase).
//   previous — past counts grouped by count session: items, qty, who.
export default async function ConsumablesInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ resident?: string; view?: string }>;
}) {
  const { t } = await getServerTranslator();
  const account = await getCurrentUser();
  if (!account) redirect("/");

  const admin = canAccessAllBranches(account);
  const supabase = await createClient();

  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let residentsQuery: any = supabase
    .from("tbl_residents")
    .select("id, resident_name, ResidentID, branch_id")
    .eq("status", "ACTIVE")
    .not("ResidentID", "is", null)
    .order("resident_name");
  if (admin) {
    if (excludedBranchIds.length > 0) {
      residentsQuery = residentsQuery.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
    }
  } else {
    residentsQuery = residentsQuery.eq("branch_id", account.branch_id);
  }
  const { data: residentsRaw } = await residentsQuery;
  const residents: InventoryResident[] = (
    (residentsRaw ?? []) as { id: number; resident_name: string; ResidentID: string; branch_id: number }[]
  ).map((r) => ({ id: r.id, name: r.resident_name, residentTextId: r.ResidentID, branchId: r.branch_id }));

  const { resident: residentParam, view: viewParam } = await searchParams;
  const view: InventoryView = viewParam === "previous" ? "previous" : "new";
  const selected = residents.find((r) => String(r.id) === residentParam) ?? null;

  let catalogue: CatalogueItem[] = [];
  let lines: ConsumableLine[] = [];
  let staffOptions: StaffPick[] = [];
  let loadError: string | null = null;

  const catalogueResult = await loadCatalogue(supabase);
  if ("error" in catalogueResult) loadError = catalogueResult.error;
  else catalogue = catalogueResult.items;

  if (selected && !loadError) {
    const linesResult = await loadResidentLines(supabase, [selected.id], catalogue);
    if ("error" in linesResult) loadError = linesResult.error;
    else lines = linesResult.lines.get(selected.id) ?? [];
    staffOptions = await loadStaffOptions(supabase, selected.branchId, excludedBranchIds);
  }

  return (
    <div>
      <PageTitle title={t("Consumables")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6">
        <ConsumablesSubTabs />
      </div>

      <InventoryModule
        key={`${selected?.id ?? "none"}-${view}`}
        view={view}
        residents={residents}
        selectedResidentId={selected?.id ?? null}
        catalogue={catalogue}
        lines={lines}
        staffOptions={staffOptions}
        loadError={loadError}
      />
    </div>
  );
}
