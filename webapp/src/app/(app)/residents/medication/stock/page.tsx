import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";
import { computeStockStatus, isPrn, type StockOrder } from "@/lib/medication-stock";
import { STOCK_ORDER_COLUMNS } from "@/lib/medication-stock-server";
import { ResidentsModuleTabs } from "../../module-tabs";
import { MedicationSubTabs } from "../medication-tabs";
import { StockModule, type StockResident, type StockOrderRow, type StockHistoryRow, type StaffPick } from "./stock-module";

// Patient-by-patient stock screen: pick a resident, then work through each of
// their active (incl. PRN) orders. Current values are computed on every
// request from the latest stock event — no daily rows exist.
export default async function MedicationStockPage({
  searchParams,
}: {
  searchParams: Promise<{ resident?: string }>;
}) {
  const { t } = await getServerTranslator();
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/");

  const admin = canAccessAllBranches(currentUser);
  const supabase = await createClient();

  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(currentUser.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  // ── Residents (same scope as the New Order page) ───────────────────────────
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
    residentsQuery = residentsQuery.eq("branch_id", currentUser.branch_id);
  }

  const { data: residentsRaw } = await residentsQuery;
  const residents: StockResident[] = (
    (residentsRaw ?? []) as { id: number; resident_name: string; ResidentID: string; branch_id: number }[]
  ).map((r) => ({ id: r.id, name: r.resident_name, residentTextId: r.ResidentID, branchId: r.branch_id }));

  const { resident: residentParam } = await searchParams;
  const selected = residents.find((r) => String(r.id) === residentParam) ?? null;

  let orders: StockOrderRow[] = [];
  let history: Record<string, StockHistoryRow[]> = {};
  let staffOptions: StaffPick[] = [];

  if (selected) {
    // ── Active orders (regular + PRN) for this resident ──────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ordersRaw } = await (supabase as any)
      .from("tbl_medication_orders")
      .select(`${STOCK_ORDER_COLUMNS}, dosage_form, brand_name, active_ingredient, supplied_by`)
      .eq("resident_id", selected.id)
      .eq("status", "Active")
      .not("external_ref_id", "is", null);

    type OrderRaw = StockOrder & {
      id: number;
      external_ref_id: string;
      dosage_form: string | null;
      brand_name: string | null;
      active_ingredient: string;
      supplied_by: string | null;
    };
    const orderRows = (ordersRaw ?? []) as OrderRaw[];

    // ── Stock events for those exact orders (newest first) ───────────────────
    type StockRaw = {
      id: number;
      external_ref_id: string;
      medication_order_id: number;
      balance: number;
      unit: string;
      daily_usage: number | null;
      days_remaining: number | null;
      stock_date: string;
      registered_by: string | null;
      entry_type: string;
    };
    let stockRows: StockRaw[] = [];
    if (orderRows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: stockRaw } = await (supabase as any)
        .from("tbl_medication_stock")
        .select("id, external_ref_id, medication_order_id, balance, unit, daily_usage, days_remaining, stock_date, registered_by, entry_type")
        .in("medication_order_id", orderRows.map((o) => o.id))
        .order("stock_date", { ascending: false })
        .order("id", { ascending: false });
      stockRows = (stockRaw ?? []) as StockRaw[];
    }

    // ── Staff: resident's branch + HQ (HQ staff also register stock) ─────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: hqBranches } = await (supabase as any)
      .from("tbl_branches")
      .select("BranchID")
      .eq("Function", "HQ");
    const staffBranchIds = [
      selected.branchId,
      ...((hqBranches ?? []) as { BranchID: number }[]).map((b) => b.BranchID),
    ].filter((id) => !excludedBranchIds.includes(id) || id === selected.branchId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: staffRaw } = await (supabase as any)
      .from("tbl_staff")
      .select("staff_name, branch_id, staffId:StaffID")
      .in("branch_id", staffBranchIds)
      .eq("status", "ACTIVE")
      .order("staff_name");
    staffOptions = ((staffRaw ?? []) as { staff_name: string; branch_id: number; staffId: string }[])
      .map((s) => ({ staffId: s.staffId, name: s.staff_name, ownBranch: s.branch_id === selected.branchId }))
      .sort((a, b) => Number(b.ownBranch) - Number(a.ownBranch));

    // Names for every RegisteredBy in the history (may include inactive staff).
    const registeredIds = [...new Set(stockRows.map((s) => s.registered_by).filter(Boolean))] as string[];
    const staffNames: Record<string, string> = {};
    if (registeredIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: namesRaw } = await (supabase as any)
        .from("tbl_staff")
        .select("staff_name, StaffID")
        .in("StaffID", registeredIds);
      for (const s of (namesRaw ?? []) as { staff_name: string; StaffID: string }[]) {
        staffNames[s.StaffID] = s.staff_name;
      }
    }

    const now = new Date();
    history = {};
    for (const o of orderRows) {
      history[o.external_ref_id] = stockRows
        .filter((s) => s.medication_order_id === o.id)
        .map((s) => ({
          id: s.id,
          stockId: s.external_ref_id,
          stockDate: s.stock_date,
          entryType: s.entry_type,
          balance: Number(s.balance),
          unit: s.unit,
          dailyUsage: s.daily_usage === null ? null : Number(s.daily_usage),
          daysRemaining: s.days_remaining === null ? null : Number(s.days_remaining),
          registeredByName: s.registered_by ? staffNames[s.registered_by] ?? s.registered_by : null,
        }));
    }

    orders = orderRows
      .map((o) => {
        const latest = history[o.external_ref_id][0] ?? null;
        const status = computeStockStatus(
          latest ? { balance: latest.balance, unit: latest.unit, stock_date: latest.stockDate } : null,
          o,
          now
        );
        return {
          rxOrderId: o.external_ref_id,
          dosageForm: o.dosage_form,
          brandName: o.brand_name,
          activeIngredient: o.active_ingredient,
          dose: o.dose,
          orderUnit: o.unit,
          frequency: o.frequency,
          dosingDays: o.dosing_days,
          prn: isPrn(o),
          suppliedBy: o.supplied_by,
          schedule: {
            dose: o.dose,
            unit: o.unit,
            frequency: o.frequency,
            administration_times: o.administration_times,
            dosing_days: o.dosing_days,
            start_date: o.start_date,
            end_date: o.end_date ?? null,
          },
          status,
          lastStockDate: latest?.stockDate ?? null,
          lastRegisteredBy: latest?.registeredByName ?? null,
        };
      })
      // Regular medication first, PRN last, then alphabetical.
      .sort(
        (a, b) =>
          Number(a.prn) - Number(b.prn) ||
          (a.brandName || a.activeIngredient).localeCompare(b.brandName || b.activeIngredient)
      );
  }

  return (
    <div>
      <PageTitle title={t("Medication")} />
      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>
      <div className="mb-6">
        <MedicationSubTabs />
      </div>

      <StockModule
        residents={residents}
        selectedResidentId={selected?.id ?? null}
        orders={orders}
        history={history}
        staffOptions={staffOptions}
      />
    </div>
  );
}
