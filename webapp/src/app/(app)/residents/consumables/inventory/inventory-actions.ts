"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { revalidatePath } from "next/cache";
import { createConsumableCounts } from "@/lib/medication-orders-script";
import { generateRecordIds, loadCatalogue, resolveBranchStaff } from "@/lib/consumables-server";
import { OTHER_UNITS, isOtherItem, isSupplier, lineKey, type Supplier } from "@/lib/consumables";
import { toSheetStockDate } from "@/lib/medication-stock";

export type CountEntryInput = {
  consumableId: string;
  /** Only for the catalogue's "Other" item. */
  otherConsumable?: string;
  otherUnit?: string;
  supplier: Supplier;
  quantity: number;
};

export type CountInput = {
  residentId: number; // tbl_residents.id
  countedBy: string; // tbl_staff.StaffID
  countDate?: string; // ISO; defaults to now, never in the future
  entries: CountEntryInput[];
};

export type CountResult = { success: boolean; error?: string; saved?: number; pendingSync?: boolean };

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 100;
const MAX_TEXT = 100;

// Weekly count: one row per counted item, appended to the Sheet first
// (source of truth) via Apps Script, which mirrors it to Supabase. Nothing
// is written to tbl_resident_consumables directly.
export async function recordConsumableCountAction(input: CountInput): Promise<CountResult> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  if (!Array.isArray(input.entries) || input.entries.length === 0)
    return { success: false, error: "Enter at least one count" };
  if (input.entries.length > MAX_ENTRIES) return { success: false, error: "Too many items" };
  if (!input.countedBy) return { success: false, error: "Counted By is required" };

  const when = input.countDate ? new Date(input.countDate) : new Date();
  if (isNaN(when.getTime())) return { success: false, error: "A valid count date/time is required" };
  if (when.getTime() > Date.now() + FUTURE_TOLERANCE_MS)
    return { success: false, error: "Count date/time cannot be in the future" };

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: resident } = await (supabase as any)
    .from("tbl_residents")
    .select("id, ResidentID, branch_id, status")
    .eq("id", input.residentId)
    .maybeSingle();
  if (!resident) return { success: false, error: "Resident not found" };
  if (!resident.ResidentID) return { success: false, error: "Resident has no ResidentID — cannot record a count" };

  if (!canAccessAllBranches(account) && resident.branch_id !== account.branch_id)
    return { success: false, error: "Access denied" };
  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  if (!isDemoUser && demoBranchIds.includes(resident.branch_id)) return { success: false, error: "Access denied" };

  const staff = await resolveBranchStaff(supabase, input.countedBy, resident.branch_id);
  if (!staff) return { success: false, error: "Counted By must be a staff member from the list" };

  const catalogueResult = await loadCatalogue(supabase);
  if ("error" in catalogueResult) return { success: false, error: catalogueResult.error };
  const byId = new Map(catalogueResult.items.map((c) => [c.consumableId, c]));

  const seen = new Set<string>();
  const rows: { consumableId: string; other: string; otherUnit: string; supplier: Supplier; qty: number }[] = [];
  for (const e of input.entries) {
    const item = byId.get(e.consumableId);
    if (!item) return { success: false, error: "Unknown item" };
    if (!isSupplier(e.supplier)) return { success: false, error: `Select who supplies ${item.consumable}` };
    const qty = Number(e.quantity);
    if (!isFinite(qty) || qty < 0) return { success: false, error: `A valid quantity is required for ${item.consumable}` };

    let other = "";
    let otherUnit = "";
    if (isOtherItem(item)) {
      other = String(e.otherConsumable ?? "").trim().slice(0, MAX_TEXT);
      otherUnit = String(e.otherUnit ?? "").trim();
      if (!other) return { success: false, error: "Enter the item name for Other" };
      if (!(OTHER_UNITS as readonly string[]).includes(otherUnit))
        return { success: false, error: `Select a unit for ${other}` };
    }

    const key = lineKey(item.consumableId, other || null);
    if (seen.has(key)) return { success: false, error: `${other || item.consumable} is listed twice` };
    seen.add(key);
    rows.push({ consumableId: item.consumableId, other, otherUnit, supplier: e.supplier, qty: Math.round(qty * 100) / 100 });
  }

  let ids: string[];
  try {
    ids = await generateRecordIds(supabase, rows.length);
  } catch {
    return { success: false, error: "Failed to generate record IDs. Please try again." };
  }

  const lastCount = toSheetStockDate(when);
  let pendingSync = false;
  try {
    const result = await createConsumableCounts(
      rows.map((r, i) => ({
        RecordID: ids[i],
        ResidentID: resident.ResidentID,
        ConsumableID: r.consumableId,
        OtherConsumable: r.other,
        OtherUnit: r.otherUnit,
        Supplier: r.supplier,
        CurrentStock: r.qty,
        LastCount: lastCount,
        CountedBy: staff.staffId,
      }))
    );
    pendingSync = result.supabaseSync?.success === false;
  } catch (err) {
    console.error("recordConsumableCountAction — Apps Script error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Failed to save the count" };
  }

  revalidatePath("/residents/consumables/inventory");
  revalidatePath("/residents/consumables/restock");
  return { success: true, saved: rows.length, pendingSync };
}
