"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { revalidatePath } from "next/cache";
import { createMedicationStockEntry } from "@/lib/medication-orders-script";
import {
  STOCK_ORDER_COLUMNS,
  generateStockId,
  isKnownStaffId,
  loadLatestStockEvent,
} from "@/lib/medication-stock-server";
import {
  computeStockStatus,
  dailyUsage,
  daysRemaining,
  isStockUnit,
  klDate,
  round2,
  toSheetStockDate,
  type StockOrder,
} from "@/lib/medication-stock";

export type StockEntryInput = {
  rxOrderId: string;
  entryType: "Stock Count" | "Stock Received";
  // Stock Count: the physically counted/estimated balance.
  // Stock Received: ONLY the newly received quantity — the new balance is
  // calculated here, the nurse never adds it up.
  quantity: number;
  unit: string;
  registeredBy: string; // tbl_staff.StaffID
  // When the count/delivery actually happened (ISO instant). Defaults to now;
  // earlier = a back-dated entry. Never in the future.
  entryDate?: string;
};

// Clock-skew allowance between the browser and the server.
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export type StockEntryResult = {
  success: boolean;
  error?: string;
  // Saved to the Sheet, but the Supabase mirror is lagging (auto-retried).
  pendingSync?: boolean;
};

export async function recordStockEntryAction(input: StockEntryInput): Promise<StockEntryResult> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  if (input.entryType !== "Stock Count" && input.entryType !== "Stock Received")
    return { success: false, error: "Invalid entry type" };
  if (!isStockUnit(input.unit)) return { success: false, error: "Unit is required" };
  if (!input.registeredBy) return { success: false, error: "Registered By is required" };

  const quantity = Number(input.quantity);
  if (!isFinite(quantity) || quantity < 0)
    return { success: false, error: "A valid quantity is required" };
  if (input.entryType === "Stock Received" && quantity <= 0)
    return { success: false, error: "Received quantity must be more than 0" };

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: order } = await (supabase as any)
    .from("tbl_medication_orders")
    .select(STOCK_ORDER_COLUMNS)
    .eq("external_ref_id", input.rxOrderId)
    .single();

  if (!order) return { success: false, error: "Order not found" };
  if (order.status !== "Active") return { success: false, error: "Order is not active" };

  const admin = canAccessAllBranches(account);
  if (!admin && order.branch_id !== account.branch_id)
    return { success: false, error: "Access denied" };

  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  if (!isDemoUser && demoBranchIds.includes(order.branch_id))
    return { success: false, error: "Access denied" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: resident } = await (supabase as any)
    .from("tbl_residents")
    .select("ResidentID")
    .eq("id", order.resident_id)
    .single();
  if (!resident?.ResidentID)
    return { success: false, error: "Resident has no ResidentID — cannot record stock" };

  if (!(await isKnownStaffId(supabase, input.registeredBy)))
    return { success: false, error: "Registered By must be a staff member from the list" };

  // Everything below is calculated as of the entry date, so a back-dated
  // entry builds on the balance as it was then. Later entries are not
  // recalculated (each row is a snapshot).
  const now = input.entryDate ? new Date(input.entryDate) : new Date();
  if (isNaN(now.getTime())) return { success: false, error: "A valid entry date/time is required" };
  if (now.getTime() > Date.now() + FUTURE_TOLERANCE_MS)
    return { success: false, error: "Entry date/time cannot be in the future" };
  if (order.start_date && klDate(now) < String(order.start_date).slice(0, 10))
    return { success: false, error: "Entry date cannot be before the order's start date" };

  const latest = await loadLatestStockEvent(supabase, order.id, now);

  let balance: number;
  if (input.entryType === "Stock Count") {
    balance = round2(quantity);
  } else {
    if (latest && latest.unit !== input.unit) {
      return {
        success: false,
        error: `Current stock is recorded in ${latest.unit}. Record a Stock Count to change the unit.`,
      };
    }
    // Count units: current forecast; Estimate units: last known balance.
    const current = latest ? computeStockStatus(latest, order as StockOrder, now).balance ?? 0 : 0;
    balance = round2(current + quantity);
  }

  const usage = dailyUsage(order as StockOrder, input.unit);
  const remaining = daysRemaining(balance, order as StockOrder, input.unit, klDate(now));

  let stockId: string;
  try {
    stockId = await generateStockId(supabase);
  } catch {
    return { success: false, error: "Failed to generate a unique stock ID. Please try again." };
  }

  let pendingSync = false;
  try {
    const result = await createMedicationStockEntry({
      StockID: stockId,
      ResidentID: resident.ResidentID,
      RxOrderID: input.rxOrderId,
      Balance: balance,
      Unit: input.unit,
      // Sheet/AppSheet convention: 0 = not applicable (shown as "—").
      "Daily Usage": usage ?? 0,
      "Days Remaining": remaining ?? 0,
      StockDate: toSheetStockDate(now),
      RegisteredBy: input.registeredBy,
      EntryType: input.entryType,
    });
    pendingSync = result.supabaseSync?.success === false;
  } catch (err) {
    console.error("recordStockEntryAction — Apps Script error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record stock",
    };
  }

  revalidatePath("/residents/medication/stock");
  return { success: true, pendingSync };
}
