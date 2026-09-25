import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getBranches, getDemoBranchIds } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { buildPurchaseList, EMPTY_PURCHASE_LIST } from "@/lib/medication-purchase";
import { ResidentsModuleTabs } from "../../module-tabs";
import { MedicationSubTabs } from "../medication-tabs";
import { PurchaseModule } from "./purchase-module";

// Branch-wide restock order sheet: ONE list for every OSEM-supplied medicine
// in the branch that needs restocking, grouped by resident. The branch is
// chosen with ?branch= so the tab stays bookmarkable and shareable.
export default async function MedicationPurchasePage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/");

  const admin = canAccessAllBranches(currentUser);

  // ── Branch data (same scoping as the Charts tab) ─────────────────────────
  const allNurBranches = await getBranches("NUR");
  const demoBranchIds = await getDemoBranchIds(); // always unconditional
  const isDemoUser = demoBranchIds.includes(currentUser.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  let branches: { id: number; name: string }[];
  if (admin) {
    branches = allNurBranches
      .filter((b) => !excludedBranchIds.includes(Number(b.id)))
      .map((b) => ({ id: Number(b.id), name: b.label }));
  } else {
    branches = allNurBranches
      .filter((b) => Number(b.id) === currentUser.branch_id)
      .map((b) => ({ id: Number(b.id), name: b.label }));
  }

  // Fall back to the account's own branch when they hold no NUR branch at all.
  if (branches.length === 0) {
    branches = [{ id: currentUser.branch_id, name: "Your branch" }];
  }

  const { branch: branchParam } = await searchParams;
  const requested = Number(branchParam);
  const selectedBranch = branches.find((b) => b.id === requested) ?? branches[0];

  const supabase = await createClient();
  const now = new Date();

  // ── Residents of the selected branch (for the required "add item" picker) ─
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: residentsRaw } = await (supabase as any)
    .from("tbl_residents")
    .select("id, resident_name, ResidentID")
    .eq("branch_id", selectedBranch.id)
    .eq("status", "ACTIVE")
    .not("ResidentID", "is", null)
    .order("resident_name");

  const residents = ((residentsRaw ?? []) as { id: number; resident_name: string; ResidentID: string | null }[])
    .map((r) => ({ id: r.id, name: r.resident_name, residentTextId: r.ResidentID }))
    // Keep the list in sync with the sheet's grouping order.
    .sort((a, b) => a.name.localeCompare(b.name));

  const result = await buildPurchaseList(supabase, selectedBranch.id, now);
  const list = "list" in result ? result.list : EMPTY_PURCHASE_LIST;

  return (
    <div>
      <PageTitle title={t("Medication")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6">
        <MedicationSubTabs />
      </div>

      <PurchaseModule
        branches={branches}
        selectedBranchId={selectedBranch.id}
        groups={list.groups}
        stockOptions={list.stockOptions}
        residents={residents}
      />
    </div>
  );
}
