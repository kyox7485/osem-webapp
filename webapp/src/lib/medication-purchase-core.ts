// Medication Purchase List — pure, client-safe helpers and types (no server
// imports). The server builder in medication-purchase.ts re-exports these;
// the review screen imports them directly, so it never has to touch
// lib/supabase/server.ts (see the Turbopack footgun in CLAUDE.md).

import { LOW_STOCK_DAYS, round2, type StockStatus } from "@/lib/medication-stock";

/** Days of cover a countable order is topped up to when we suggest a quantity. */
export const PURCHASE_COVER_DAYS = 30;

/**
 * Uncountable stock (Estimate units, PRN) has no daily usage, so a 30-day
 * projection is meaningless — suggest a single unit to get the item moving and
 * let the reviewer set the real figure.
 */
export const UNCOUNTABLE_SUGGESTED_QTY = 1;

/**
 * Suggested quantity to order. The current balance is deliberately NOT
 * deducted: it is the buffer stock, so we order a full cover period on top of
 * whatever is left. Reviewers can still net it off manually.
 *
 * Countable → coverDays × dailyUsage, rounded UP to a whole unit (pharmacies
 * issue whole tablets/capsules). Uncountable → 1.
 */
export function suggestOrderQty(dailyUsage: number | null, countable: boolean): number {
  if (!countable || dailyUsage === null || !isFinite(dailyUsage) || dailyUsage <= 0) {
    return UNCOUNTABLE_SUGGESTED_QTY;
  }
  return Math.ceil(round2(dailyUsage * PURCHASE_COVER_DAYS));
}

/**
 * True when an order must be reordered:
 *  - countable: forecast is running out (< LOW_STOCK_DAYS, out of stock included)
 *  - uncountable: whatever the nurse last estimated is nearly gone (<= 0.5)
 * A never-recorded order is excluded — there is no quantity to reorder against.
 * (computeStockStatus already reports forecast:false with a null balance in
 * that case; the explicit check keeps the contract true for any caller.)
 */
export function needsRestock(st: StockStatus, latestRecorded: boolean): boolean {
  if (!latestRecorded || st.balance === null) return false;
  if (st.forecast) {
    if (st.lastsUntilOrderEnd) return false;
    return (st.daysRemaining ?? 0) < LOW_STOCK_DAYS;
  }
  return st.balance <= 0.5;
}

export type PurchaseListRow = {
  key: string; // stable client id — the order's external_ref_id, or "extra:<n>"
  residentId: number;
  residentName: string;
  residentTextId: string | null; // ResidentID text, e.g. "AMN-0007"
  medicine: string;
  schedule: string; // "1 Tablet · BD · Mon/Wed/Fri"
  unit: string;
  balance: number | null; // live forecast, reviewer-editable
  dailyUsage: number | null;
  daysRemaining: number | null; // null = uncountable; recomputed when balance is edited
  countable: boolean; // forecastable → daily-usage math applies
  suggestedQty: number; // 30 × dailyUsage (countable) or 1 (uncountable)
  reason: string; // why it qualified, e.g. "8 days left" / "Low quantity"
  addedManually?: boolean; // reviewer-added line (never persisted)
  /** StaffID of the staff member who prepared this list; null until chosen. */
  preparedBy?: string | null;
  /** Display name resolved server-side for `preparedBy`; never from the client. */
  preparedByName?: string | null;
};

/** Rows grouped under one resident heading — the unit both the UI and PDF print. */
export type PurchaseListGroup = {
  residentId: number;
  residentName: string;
  residentTextId: string | null;
  rows: PurchaseListRow[]; // one line per medicine, medicine-sorted
  subtotalQty: number;
};

/**
 * One medicine a resident is currently prescribed, for the review screen's
 * "add item" picker. Scoped to that resident's OWN active orders so a
 * reviewer can only add what this resident is actually taking (plus the free
 * -text "Other…" escape hatch for anything else).
 */
export type ResidentMedicineOption = {
  /** The order's external_ref_id. */
  value: string;
  label: string;
  unit: string;
  /** Full dosing line, e.g. "1 Tablet · BD · Mon/Wed/Fri". */
  schedule: string;
  /** Live forecast balance for this order, or null if never recorded. */
  balance: number | null;
  dailyUsage: number | null;
  daysRemaining: number | null;
  countable: boolean;
};

/**
 * Days left for a manually-adjusted balance. Uses the same rounded-down-to-
 * the-nearest-half rule the Stock screen and PDFs use, so an edited balance
 * shows a number consistent with the rest of the app.
 *
 * Only meaningful when the row is countable AND has a daily usage — an
 * uncountable row (Estimate unit, PRN) has no rate to project from, so it
 * stays "Not forecast" however the balance is edited.
 */
export function daysLeftFor(balance: number | null, dailyUsage: number | null): number | null {
  if (balance === null || dailyUsage === null || dailyUsage <= 0) return null;
  if (!isFinite(balance) || balance < 0) return null;
  return Math.floor((balance / dailyUsage) * 2 + 1e-9) / 2;
}

export type PurchaseListStaff = { staffId: string; name: string; ownBranch: boolean };

export type PurchaseList = {
  groups: PurchaseListGroup[];
  /** Active OSEM medicines by resident id, for the "add item" picker. */
  residentMedicines: Record<number, ResidentMedicineOption[]>;
  /** Staff who may prepare the list (branch + HQ, ACTIVE only). */
  staffOptions: PurchaseListStaff[];
  totalQty: number; // branch-wide quantity to order
  totalItems: number;
  residentCount: number;
};

export const EMPTY_PURCHASE_LIST: PurchaseList = {
  groups: [],
  residentMedicines: {},
  staffOptions: [],
  totalQty: 0,
  totalItems: 0,
  residentCount: 0,
};

/**
 * Group flat rows into resident sections. Residents in name order; medicines
 * alphabetical within a resident. Rows without a resident are dropped — every
 * line must belong to exactly one resident, so the PDF can never show an
 * unassigned bucket.
 *
 * `qtyOf` lets the review screen total the *edited* quantities while the
 * server totals the suggested ones.
 */
export function groupPurchaseRows(
  rows: PurchaseListRow[],
  qtyOf: (row: PurchaseListRow) => number = (r) => r.suggestedQty
): PurchaseListGroup[] {
  const byResident = new Map<number, PurchaseListGroup>();
  for (const r of rows) {
    if (r.residentId === null || r.residentId === undefined) continue;
    let g = byResident.get(r.residentId);
    if (!g) {
      g = {
        residentId: r.residentId,
        residentName: r.residentName,
        residentTextId: r.residentTextId,
        rows: [],
        subtotalQty: 0,
      };
      byResident.set(r.residentId, g);
    }
    g.rows.push(r);
  }
  const groups = [...byResident.values()];
  for (const g of groups) {
    g.rows.sort((a, b) => a.medicine.localeCompare(b.medicine));
    g.subtotalQty = g.rows.reduce((sum, r) => sum + qtyOf(r), 0);
  }
  groups.sort((a, b) => a.residentName.localeCompare(b.residentName) || a.residentId - b.residentId);
  return groups;
}

export function summarize(groups: PurchaseListGroup[]): {
  totalQty: number;
  totalItems: number;
  residentCount: number;
} {
  return {
    totalQty: groups.reduce((sum, g) => sum + g.subtotalQty, 0),
    totalItems: groups.reduce((sum, g) => sum + g.rows.length, 0),
    residentCount: groups.length,
  };
}
