// Server-only: queries behind the branch-wide Medication Purchase List (the
// "Purchase" sub-tab). Never import this from a "use client" component — it
// takes the server Supabase client. The shared pure logic and types live in
// medication-purchase-core.ts, which is client-safe.
//
// Unlike medication-stock-report.ts (per-resident status), this aggregates
// every qualifying OSEM-supplied order in ONE branch into a single order
// sheet: grouped by resident, one line per medicine, with a branch-wide total.
// Forecast numbers come from computeStockStatus exactly as the Stock screen
// and the existing PDFs, so the three never disagree.

import type { createClient } from "@/lib/supabase/server";
import { computeStockStatus, type StockOrder } from "@/lib/medication-stock";
import { STOCK_ORDER_COLUMNS } from "@/lib/medication-stock-server";
import {
  groupPurchaseRows,
  needsRestock,
  suggestOrderQty,
  summarize,
  type PurchaseList,
  type PurchaseListOption,
  type PurchaseListRow,
} from "@/lib/medication-purchase-core";

export type {
  PurchaseList,
  PurchaseListGroup,
  PurchaseListOption,
  PurchaseListRow,
} from "@/lib/medication-purchase-core";
export { groupPurchaseRows, summarize, suggestOrderQty, EMPTY_PURCHASE_LIST } from "@/lib/medication-purchase-core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type OrderRaw = StockOrder & {
  id: number;
  external_ref_id: string;
  dosage_form: string | null;
  brand_name: string | null;
  active_ingredient: string;
  resident_id: number;
  resident_name: string;
  ResidentID: string | null;
};

function medicineLabel(o: OrderRaw): string {
  const name = o.brand_name ? `${o.brand_name} (${o.active_ingredient})` : o.active_ingredient;
  return [o.dosage_form, name].filter(Boolean).join(" ");
}

function scheduleLabel(o: OrderRaw): string {
  const dose = o.dose !== null ? `${o.dose} ${o.unit ?? ""}`.trim() : "";
  const days =
    o.dosing_days && o.dosing_days !== "Everyday"
      ? o.dosing_days
          .split(",")
          .map((d) => d.trim().slice(0, 3))
          .filter(Boolean)
          .join("/")
      : "";
  return [dose, o.frequency ?? "", days].filter(Boolean).join(" · ");
}

/** Unit label for a never-recorded order, so the row still names a unit. */
function unitFor(o: OrderRaw, stockUnit: string | null): string {
  if (stockUnit) return stockUnit;
  return o.unit ?? "Unit";
}

function reasonFor(st: { forecast: boolean; daysRemaining: number | null; balance: number | null }): string {
  if (st.forecast) {
    const days = st.daysRemaining ?? 0;
    return days === 0 ? "Out of stock" : `${days} days left`;
  }
  return st.balance !== null && st.balance <= 0 ? "Out of stock" : "Low quantity";
}

/**
 * Every active OSEM-supplied order in `branchId` that needs restocking, plus
 * the branch's stock medicines for the review screen's "add item" dropdown.
 */
export async function buildPurchaseList(
  supabase: Supabase,
  branchId: number,
  now: Date
): Promise<{ list: PurchaseList } | { error: string }> {
  // Deliberately NO PostgREST embed of tbl_residents here. A bare
  // `tbl_residents!inner(...)` needs PostgREST to auto-detect the FK and
  // fails outright when it cannot, and an inner join also compounds
  // tbl_residents' RLS on top of the orders' own RLS. Resident names are
  // fetched separately below and joined in memory — one extra round-trip
  // is cheaper than a silently empty list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ordersRaw, error: ordersError } = await (supabase as any)
    .from("tbl_medication_orders")
    .select(`${STOCK_ORDER_COLUMNS}, dosage_form, brand_name, active_ingredient`)
    .eq("branch_id", branchId)
    .eq("status", "Active")
    .eq("supplied_by", "OSEM")
    .not("external_ref_id", "is", null)
    .order("id");
  if (ordersError) return { error: ordersError.message };

  const rawOrders = (ordersRaw ?? []) as OrderRaw[];

  // ── Residents of this branch, by id ──────────────────────────────────────
  const residentById = new Map<number, { resident_name: string; ResidentID: string | null }>();
  if (rawOrders.length > 0) {
    const residentIds = [...new Set(rawOrders.map((o) => o.resident_id))];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: residentsRaw, error: residentsError } = await (supabase as any)
      .from("tbl_residents")
      .select("id, resident_name, ResidentID")
      .in("id", residentIds);
    if (residentsError) return { error: residentsError.message };
    for (const r of (residentsRaw ?? []) as { id: number; resident_name: string; ResidentID: string | null }[]) {
      residentById.set(r.id, r);
    }
  }

  const orders: OrderRaw[] = rawOrders.map((o) => {
    const resident = residentById.get(o.resident_id);
    return {
      ...o,
      resident_name: resident?.resident_name ?? "Unknown resident",
      ResidentID: resident?.ResidentID ?? null,
    };
  });

  // Latest stock event per order (rows arrive newest first).
  const latestByOrder = new Map<number, { balance: number; unit: string; stock_date: string }>();
  if (orders.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stockRaw, error: stockError } = await (supabase as any)
      .from("tbl_medication_stock")
      .select("medication_order_id, balance, unit, stock_date")
      .in("medication_order_id", orders.map((o) => o.id))
      .order("stock_date", { ascending: false })
      .order("id", { ascending: false });
    if (stockError) return { error: stockError.message };
    for (const s of (stockRaw ?? []) as { medication_order_id: number; balance: number; unit: string; stock_date: string }[]) {
      if (!latestByOrder.has(s.medication_order_id)) {
        latestByOrder.set(s.medication_order_id, { balance: Number(s.balance), unit: s.unit, stock_date: s.stock_date });
      }
    }
  }

  const rows: PurchaseListRow[] = [];
  for (const o of orders) {
    const latest = latestByOrder.get(o.id) ?? null;
    const st = computeStockStatus(latest, o, now);
    if (!needsRestock(st, latest !== null)) continue;

    const countable = st.forecast && st.dailyUsage !== null;
    rows.push({
      key: o.external_ref_id,
      residentId: o.resident_id,
      residentName: o.resident_name,
      residentTextId: o.ResidentID,
      medicine: medicineLabel(o),
      schedule: scheduleLabel(o),
      unit: unitFor(o, st.unit),
      balance: st.balance,
      dailyUsage: st.dailyUsage,
      daysRemaining: st.forecast ? st.daysRemaining : null,
      countable,
      suggestedQty: suggestOrderQty(st.dailyUsage, countable),
      reason: reasonFor(st),
    });
  }

  const groups = groupPurchaseRows(rows);
  return {
    list: { groups, stockOptions: await listStockOptions(supabase, branchId, orders), ...summarize(groups) },
  };
}

/**
 * The branch's own stock medicines, for the review screen's "add item"
 * dropdown. Read-only — selecting one never writes to tbl_medication_stock.
 */
async function listStockOptions(
  supabase: Supabase,
  branchId: number,
  orders?: OrderRaw[]
): Promise<PurchaseListOption[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stockRaw } = await (supabase as any)
    .from("tbl_medication_stock")
    .select("unit, medication_order_id")
    .eq("branch_id", branchId)
    .limit(2000);
  const rows = (stockRaw ?? []) as { unit: string; medication_order_id: number }[];

  const unitByOrder = new Map<number, string>();
  for (const s of rows) if (!unitByOrder.has(s.medication_order_id)) unitByOrder.set(s.medication_order_id, s.unit);

  // Name each option from its order where we have it; otherwise fall back to
  // the raw unit so the dropdown is never full of blank entries.
  const options = new Map<string, PurchaseListOption>();
  for (const [orderId, unit] of unitByOrder) {
    const o = orders?.find((x) => x.id === orderId);
    const label = o ? `${medicineLabel(o)} — ${unit}` : unit;
    options.set(`${label}|${unit}`, { value: String(orderId), label });
  }
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}
