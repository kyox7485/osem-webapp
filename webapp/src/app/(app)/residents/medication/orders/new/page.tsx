import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { ResidentsModuleTabs } from "../../../module-tabs";
import { MedicationSubTabs } from "../../medication-tabs";
import { OrderForm } from "../order-form";
import type { ResidentOption, StaffEntry } from "../order-form";

export default async function NewMedicationOrderPage() {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/");

  const admin = isAdmin(currentUser);
  const supabase = await createClient();

  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(currentUser.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  // ── Active residents with a ResidentID (required for the Sheet) ──────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let residentsQuery: any = supabase
    .from("tbl_residents")
    .select("id, resident_name, ResidentID, branch_id")
    .eq("status", "ACTIVE")
    .not("ResidentID", "is", null)
    .order("resident_name");

  if (admin) {
    if (excludedBranchIds.length > 0) {
      residentsQuery = residentsQuery.not(
        "branch_id",
        "in",
        `(${excludedBranchIds.join(",")})`
      );
    }
  } else {
    residentsQuery = residentsQuery.eq("branch_id", currentUser.branch_id);
  }

  const { data: residentsRaw } = await residentsQuery;

  type ResidentRow = {
    id: number;
    resident_name: string;
    ResidentID: string;
    branch_id: number;
  };

  const residents: ResidentOption[] = (
    (residentsRaw ?? []) as ResidentRow[]
  ).map((r) => ({
    id: r.id,
    name: r.resident_name,
    residentTextId: r.ResidentID,
    branchId: r.branch_id,
  }));

  // ── Staff for Noted By picker ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let staffQuery: any = supabase
    .from("tbl_staff")
    .select("staff_name, branch_id")
    .order("staff_name");

  if (admin) {
    if (excludedBranchIds.length > 0) {
      staffQuery = staffQuery.not(
        "branch_id",
        "in",
        `(${excludedBranchIds.join(",")})`
      );
    }
  } else {
    staffQuery = staffQuery.eq("branch_id", currentUser.branch_id);
  }

  const { data: staffRaw } = await staffQuery;

  type StaffRow = { staff_name: string; branch_id: number };

  const staffOptions: StaffEntry[] = ((staffRaw ?? []) as StaffRow[]).map(
    (s) => ({
      name: s.staff_name,
      branchId: s.branch_id,
    })
  );

  return (
    <div>
      <PageTitle title={t("Medication")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6">
        <MedicationSubTabs />
      </div>

      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-base font-semibold text-gray-800">
          {t("New Medication Order")}
        </h2>
      </div>

      <OrderForm mode="create" residents={residents} staffOptions={staffOptions} />
    </div>
  );
}
