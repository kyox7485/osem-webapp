// Server-only helpers for Medication Stock. Deliberately NOT a "use server"
// file: recordOrderChangedStock must only run as part of updateOrderAction,
// never be callable from the browser as its own Server Action.
// Never import this from a "use client" component (it pulls in the server
// Supabase client — see the Turbopack footgun in CLAUDE.md).

import crypto from "crypto";
import type { createClient } from "@/lib/supabase/server";
import { createMedicationStockEntry } from "@/lib/medication-orders-script";
import {
  computeStockStatus,
  dailyUsage,
  daysRemaining,
  klDate,
  toSheetStockDate,
  type StockEvent,
  type StockOrder,
} from "@/lib/medication-stock";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const STOCK_ORDER_COLUMNS =
  "id, external_ref_id, resident_id, branch_id, status, dose, unit, frequency, administration_times, dosing_days, start_date, end_date";

export async function generateStockId(supabase: Supabase): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = crypto.randomBytes(4).toString("hex");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("tbl_medication_stock")
      .select("id")
      .eq("external_ref_id", id)
      .maybeSingle();
    if (!data) return id;
  }
  throw new Error("Failed to generate unique StockID after 10 attempts");
}

export async function loadLatestStockEvent(
  supabase: Supabase,
  medicationOrderId: number
): Promise<StockEvent | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("tbl_medication_stock")
    .select("balance, unit, stock_date")
    .eq("medication_order_id", medicationOrderId)
    .order("stock_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { balance: Number(data.balance), unit: data.unit, stock_date: data.stock_date } : null;
}

export async function isKnownStaffId(supabase: Supabase, staffId: string): Promise<boolean> {
  if (!staffId) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("tbl_staff")
    .select("StaffID")
    .eq("StaffID", staffId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * After an order revision (old RxOrderID discontinued, new RxOrderID
 * appended), carry the stock forward onto the new RxOrderID as an
 * "Order Changed" event. The old order's history is left untouched.
 *
 * Balance = what the OLD order had reached at the moment of the change
 * (forecast for Count units, last known for Estimate units). Daily Usage /
 * Days Remaining snapshots use the NEW order's schedule.
 *
 * No-op when the old order never had a stock event. Never throws — the order
 * edit itself already succeeded; a failure here is only logged.
 */
export async function recordOrderChangedStock(params: {
  supabase: Supabase;
  oldRxOrderId: string;
  newRxOrderId: string;
  residentTextId: string;
  newOrder: StockOrder;
  notedBy: string;
}): Promise<void> {
  const { supabase, oldRxOrderId, newRxOrderId, residentTextId, newOrder, notedBy } = params;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: oldOrder } = await (supabase as any)
      .from("tbl_medication_orders")
      .select(STOCK_ORDER_COLUMNS)
      .eq("external_ref_id", oldRxOrderId)
      .single();
    if (!oldOrder) return;

    const latest = await loadLatestStockEvent(supabase, oldOrder.id);
    if (!latest) return;

    const now = new Date();
    const current = computeStockStatus(latest, oldOrder as StockOrder, now);
    const balance = current.balance ?? latest.balance;
    const usage = dailyUsage(newOrder, latest.unit);
    const remaining = daysRemaining(balance, newOrder, latest.unit, klDate(now));

    // Noted By is the only person on the order form. It can be a free-text
    // external name; RegisteredBy must be a real StaffID, so leave it blank then.
    const registeredBy = (await isKnownStaffId(supabase, notedBy)) ? notedBy : "";

    await createMedicationStockEntry({
      StockID: await generateStockId(supabase),
      ResidentID: residentTextId,
      RxOrderID: newRxOrderId,
      Balance: balance,
      Unit: latest.unit,
      "Daily Usage": usage ?? 0,
      "Days Remaining": remaining ?? 0,
      StockDate: toSheetStockDate(now),
      RegisteredBy: registeredBy,
      EntryType: "Order Changed",
    });
  } catch (err) {
    console.error(
      `recordOrderChangedStock — failed to carry stock from ${oldRxOrderId} to ${newRxOrderId}:`,
      err
    );
  }
}
