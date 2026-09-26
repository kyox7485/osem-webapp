import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getBranches, getDemoBranchIds } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { loadCatalogue, loadResidentLines, loadStaffOptions } from "@/lib/consumables-server";
import { isOtherItem, lineKey, suggestRestock, type RestockRow } from "@/lib/consumables";
import { ResidentsModuleTabs } from "../../module-tabs";
import { ConsumablesSubTabs } from "../consumables-tabs";
import { RestockModule, type AddOption } from "./restock-module";

// Restock review for the branch: every item line whose latest count needs a
// restock (lib/consumables.ts suggestRestock), for both suppliers. The client
// filters it into the Family reminder (per resident) or the OSEM pick-up list
// (whole branch or one resident). Nothing here writes to the database.
export default async function ConsumablesRestockPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const { t } = await getServerTranslator();
  const account = await getCurrentUser();
  if (!account) redirect("/");

  const admin = canAccessAllBranches(account);

  // Same branch scoping as Medication → Purchase.
  const allNurBranches = await getBranches("NUR");
  const demoBranchIds = await getDemoBranchIds(); // always unconditional
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  let branches: { id: number; name: string }[] = allNurBranches
    .filter((b) => (admin ? !excludedBranchIds.includes(Number(b.id)) : Number(b.id) === account.branch_id))
    .map((b) => ({ id: Number(b.id), name: b.label }));
  if (branches.length === 0) branches = [{ id: account.branch_id, name: t("Your branch") }];

  const { branch: branchParam } = await searchParams;
  const selectedBranch = branches.find((b) => b.id === Number(branchParam)) ?? branches[0];

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: residentsRaw } = await (supabase as any)
    .from("tbl_residents")
    .select("id, resident_name, ResidentID")
    .eq("branch_id", selectedBranch.id)
    .eq("status", "ACTIVE")
    .not("ResidentID", "is", null)
    .order("resident_name");
  const residents = ((residentsRaw ?? []) as { id: number; resident_name: string; ResidentID: string | null }[]).map(
    (r) => ({ id: r.id, name: r.resident_name, residentTextId: r.ResidentID })
  );

  let loadError: string | null = null;
  const rows: RestockRow[] = [];
  const addOptions: Record<number, AddOption[]> = {};

  const catalogueResult = await loadCatalogue(supabase);
  if ("error" in catalogueResult) {
    loadError = catalogueResult.error;
  } else {
    const catalogue = catalogueResult.items;
    const linesResult = await loadResidentLines(supabase, residents.map((r) => r.id), catalogue);
    if ("error" in linesResult) {
      loadError = linesResult.error;
    } else {
      for (const r of residents) {
        const lines = linesResult.lines.get(r.id) ?? [];
        const options: AddOption[] = [];
        for (const l of lines) {
          const s = suggestRestock(l);
          if (s.needed && l.supplier) {
            rows.push({
              key: `${r.id}#${l.key}`,
              residentId: r.id,
              consumableId: l.consumableId,
              item: l.name,
              unit: l.unit,
              supplier: l.supplier,
              currentStock: l.currentStock,
              lastCount: l.lastCount,
              suggestedQty: s.qty,
              addedManually: false,
            });
          } else {
            options.push({
              key: `${r.id}#${l.key}`,
              consumableId: l.consumableId,
              item: l.name,
              unit: l.unit,
              supplier: l.supplier,
              currentStock: l.currentStock,
              lastCount: l.lastCount,
            });
          }
        }
        // Catalogue items this resident has never been counted for.
        const has = new Set(lines.map((l) => l.key));
        for (const c of catalogue) {
          if (isOtherItem(c) || has.has(lineKey(c.consumableId, null))) continue;
          options.push({
            key: `${r.id}#${lineKey(c.consumableId, null)}`,
            consumableId: c.consumableId,
            item: c.consumable,
            unit: c.unit,
            supplier: null,
            currentStock: null,
            lastCount: null,
          });
        }
        addOptions[r.id] = options.sort((a, b) => a.item.localeCompare(b.item));
      }
    }
  }

  const staffOptions = await loadStaffOptions(supabase, selectedBranch.id, excludedBranchIds);

  return (
    <div>
      <PageTitle title={t("Consumables")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6">
        <ConsumablesSubTabs />
      </div>

      {/* key: a ?branch= switch must remount so the draft re-seeds
          (see docs/medication-stock.md §7e trap 3). */}
      <RestockModule
        key={selectedBranch.id}
        branches={branches}
        selectedBranchId={selectedBranch.id}
        residents={residents}
        rows={rows}
        addOptions={addOptions}
        staffOptions={staffOptions}
        loadError={loadError}
      />
    </div>
  );
}
