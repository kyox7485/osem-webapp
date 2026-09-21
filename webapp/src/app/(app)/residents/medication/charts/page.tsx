import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getBranches, getDemoBranchIds } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { ResidentsModuleTabs } from "../../module-tabs";
import { MedicationSubTabs } from "../medication-tabs";
import { MedicationChartsModule } from "./charts-module";

export default async function MedicationChartsPage() {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/");

  const admin = isAdmin(currentUser);

  // ── Branch data ──────────────────────────────────────────────────────────
  // Only nursing branches (Function = "NUR") have residents and medication charts.
  const [allNurBranches, demoBranchIds] = admin
    ? await Promise.all([getBranches("NUR"), getDemoBranchIds()])
    : [await getBranches("NUR"), [] as number[]];

  const isDemoUser = demoBranchIds.includes(currentUser.branch_id);
  // Real admins never see demo branches; demo accounts see their own data.
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  let branches: { id: number; name: string }[];
  if (admin) {
    branches = allNurBranches
      .filter((b) => !excludedBranchIds.includes(Number(b.id)))
      .map((b) => ({ id: Number(b.id), name: b.label }));
  } else {
    // Non-admin: only their own branch (if it is a NUR branch).
    branches = allNurBranches
      .filter((b) => Number(b.id) === currentUser.branch_id)
      .map((b) => ({ id: Number(b.id), name: b.label }));
  }

  // ── Resident data ─────────────────────────────────────────────────────────
  // Only active residents with a ResidentID are included — a null ResidentID
  // cannot be passed to the Apps Script chart generator.
  type ResidentRow = {
    ResidentID: string;
    resident_name: string;
    branch_id: number;
  };

  let residents: { residentId: string; name: string }[] = [];
  const supabase = await createClient();

  // Use explicit any to avoid TS2589 (Supabase query chain inference depth).
  // The result is cast to ResidentRow[] after the await.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("tbl_residents")
    .select("ResidentID, resident_name, branch_id")
    .eq("status", "ACTIVE")
    .not("ResidentID", "is", null)
    .order("resident_name");

  if (admin) {
    if (excludedBranchIds.length > 0) {
      query = query.not(
        "branch_id",
        "in",
        `(${excludedBranchIds.join(",")})`
      );
    }
  } else {
    query = query.eq("branch_id", currentUser.branch_id);
  }

  const { data: residentsData } = await query;
  residents = ((residentsData ?? []) as ResidentRow[]).map((r) => ({
    residentId: r.ResidentID,
    name: r.resident_name,
  }));

  // ── Default chart period: current date ───────────────────────────────────
  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1; // 1-indexed

  return (
    <div>
      <PageTitle title={t("Medication")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6">
        <MedicationSubTabs />
      </div>
      <MedicationChartsModule
        residents={residents}
        branches={branches}
        defaultYear={defaultYear}
        defaultMonth={defaultMonth}
      />
    </div>
  );
}
