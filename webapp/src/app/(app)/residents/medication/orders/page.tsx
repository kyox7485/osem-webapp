import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { ResidentsModuleTabs } from "../../module-tabs";
import { MedicationSubTabs } from "../medication-tabs";
import { OrdersList } from "./orders-list";

export default async function MedicationOrdersPage() {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/");

  const admin = isAdmin(currentUser);
  const supabase = await createClient();

  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(currentUser.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  // ── Fetch orders ───────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ordersQuery: any = supabase
    .from("tbl_medication_orders")
    .select(
      "id, external_ref_id, active_ingredient, brand_name, dose, unit, frequency, start_date, end_date, status, ordered_by, resident_id, branch_id"
    )
    .order("start_date", { ascending: false })
    .limit(500);

  if (admin) {
    if (excludedBranchIds.length > 0) {
      ordersQuery = ordersQuery.not(
        "branch_id",
        "in",
        `(${excludedBranchIds.join(",")})`
      );
    }
  } else {
    ordersQuery = ordersQuery.eq("branch_id", currentUser.branch_id);
  }

  const { data: ordersRaw } = await ordersQuery;

  type OrderRow = {
    id: number;
    external_ref_id: string;
    active_ingredient: string;
    brand_name: string | null;
    dose: number | null;
    unit: string | null;
    frequency: string | null;
    start_date: string;
    end_date: string | null;
    status: string;
    ordered_by: string;
    resident_id: number;
    branch_id: number;
  };

  const orders: OrderRow[] = (ordersRaw ?? []) as OrderRow[];

  // ── Fetch residents for name/ResidentID display ────────────────────────────
  const residentIds = [...new Set(orders.map((o) => o.resident_id))];

  type ResidentRow = {
    id: number;
    resident_name: string;
    ResidentID: string | null;
  };

  let residentMap = new Map<number, ResidentRow>();

  if (residentIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resQ: any = supabase
      .from("tbl_residents")
      .select("id, resident_name, ResidentID")
      .in("id", residentIds);
    const { data: residentsRaw } = await resQ;

    residentMap = new Map(
      ((residentsRaw ?? []) as ResidentRow[]).map((r) => [r.id, r])
    );
  }

  type OrderItem = {
    id: number;
    rxOrderId: string;
    activeIngredient: string;
    brandName: string | null;
    dose: string | null;
    unit: string | null;
    frequency: string | null;
    startDate: string;
    endDate: string | null;
    status: string;
    orderedBy: string;
    residentName: string;
    residentTextId: string | null;
  };

  const items: OrderItem[] = orders.map((o) => {
    const r = residentMap.get(o.resident_id);
    return {
      id: o.id,
      rxOrderId: o.external_ref_id,
      activeIngredient: o.active_ingredient,
      brandName: o.brand_name,
      dose: o.dose !== null ? String(o.dose) : null,
      unit: o.unit,
      frequency: o.frequency,
      startDate: o.start_date,
      endDate: o.end_date,
      status: o.status,
      orderedBy: o.ordered_by,
      residentName: r?.resident_name ?? "—",
      residentTextId: r?.ResidentID ?? null,
    };
  });

  return (
    <div>
      <PageTitle title={t("Medication")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6">
        <MedicationSubTabs />
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {items.length === 0
            ? t("No orders found.")
            : `${items.length} ${items.length === 1 ? t("order") : t("orders")}`}
        </p>
        <Link
          href="/residents/medication/orders/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          {t("New Order")}
        </Link>
      </div>

      <OrdersList orders={items} />
    </div>
  );
}
