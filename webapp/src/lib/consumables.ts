// Consumables — pure rules and types. Client-safe: no server imports, so the
// Inventory / Restock client components can use it (see the Turbopack
// footgun in CLAUDE.md). Full reference: docs/consumables.md.

export const SUPPLIERS = ["Family", "OSEM"] as const;
export type Supplier = (typeof SUPPLIERS)[number];

export function isSupplier(v: unknown): v is Supplier {
  return v === "Family" || v === "OSEM";
}

/** Units offered for the catalogue's free-text "Other" item. Stored as-is. */
export const OTHER_UNITS = ["Unit", "Piece", "Pack", "Box", "Bottle", "Tin", "Tube", "Roll"] as const;

/**
 * Items with no MaxStock (RestockRequired = No: lotion, milk powder, Other)
 * need restocking when the count is at or below this, and 1 unit is
 * suggested. Staff can edit the quantity on the Restock review.
 */
export const LOW_STOCK_THRESHOLD = 1;

/** A count older than this is flagged as due on the weekly Inventory screen. */
export const COUNT_DUE_DAYS = 7;

export type StaffPick = { staffId: string; name: string; ownBranch: boolean };

export type CatalogueItem = {
  consumableId: string;
  consumable: string;
  unit: string;
  maxStock: number | null;
  restockRequired: boolean;
};

export function isOtherItem(item: Pick<CatalogueItem, "consumable">): boolean {
  return item.consumable.trim().toLowerCase() === "other";
}

/**
 * Identity of one item line for a resident. Catalogue items are one line
 * each; the "Other" item is one line per free-text name.
 */
export function lineKey(consumableId: string, otherConsumable: string | null): string {
  return `${consumableId}|${(otherConsumable ?? "").trim().toLowerCase()}`;
}

export type CountRecord = {
  id: number; // tbl_resident_consumables.id (for the HQ-admin Edit/Delete controls)
  recordId: string;
  currentStock: number;
  lastCount: string; // ISO
  supplier: Supplier | null;
  countedByName: string | null;
};

/** One item a resident has, with its latest count first in `history`. */
export type ConsumableLine = {
  key: string;
  consumableId: string;
  /** Display name: catalogue name, or the free-text name for "Other". */
  name: string;
  unit: string;
  otherConsumable: string | null;
  otherUnit: string | null;
  isOther: boolean;
  maxStock: number | null;
  restockRequired: boolean;
  supplier: Supplier | null;
  currentStock: number;
  lastCount: string;
  lastCountedBy: string | null;
  history: CountRecord[];
};

export type RestockSuggestion = { needed: boolean; qty: number; rule: "max" | "threshold" | "uncountable-threshold" };

/**
 * RestockRequired items with a MaxStock top up to MaxStock (whole units,
 * rounded up) — same rule as the legacy Apps Script (consumable.gs). Other
 * items use LOW_STOCK_THRESHOLD and suggest 1.
 */
export function suggestRestock(line: Pick<ConsumableLine, "maxStock" | "restockRequired" | "currentStock">): RestockSuggestion {
  if (line.restockRequired && line.maxStock !== null && line.maxStock > 0) {
    const qty = Math.max(0, Math.ceil(line.maxStock - line.currentStock));
    return { needed: qty > 0, qty, rule: "max" };
  }
  const needed = line.currentStock <= LOW_STOCK_THRESHOLD;
  return { needed, qty: needed ? 1 : 0, rule: "threshold" };
}

/** Uncountable (no MaxStock): restock only when strictly < 1.0. */
export function uncountableRestock(line: Pick<ConsumableLine, "currentStock">): RestockSuggestion {
  const needed = line.currentStock < LOW_STOCK_THRESHOLD;
  return { needed, qty: needed ? 1 : 0, rule: "uncountable-threshold" };
}

export function isCountableItem(item: Pick<CatalogueItem, "maxStock">): boolean {
  return item.maxStock !== null && item.maxStock > 0;
}

export type HistoryRecord = {
  id: number;
  recordId: string;
  name: string;
  unit: string;
  qty: number;
  supplier: Supplier | null;
  countedBy: string | null;
  lastCount: string;
};

/** Whole days between a count and now (KL calendar not needed at this grain). */
export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000));
}

export function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// ── Restock review rows (shared by the Restock screen and the PDF route) ─────

export type RestockRow = {
  key: string;
  residentId: number;
  consumableId: string;
  item: string;
  unit: string;
  supplier: Supplier;
  currentStock: number | null;
  lastCount: string | null;
  suggestedQty: number;
  addedManually: boolean;
};

export type RestockGroup = {
  residentId: number;
  residentName: string;
  residentTextId: string | null;
  rows: RestockRow[];
};

/** Group by resident (name order), items alphabetical — screen and PDF agree. */
export function groupRestockRows(
  rows: RestockRow[],
  residentName: (id: number) => { name: string; textId: string | null }
): RestockGroup[] {
  const map = new Map<number, RestockGroup>();
  for (const r of rows) {
    let g = map.get(r.residentId);
    if (!g) {
      const who = residentName(r.residentId);
      g = { residentId: r.residentId, residentName: who.name, residentTextId: who.textId, rows: [] };
      map.set(r.residentId, g);
    }
    g.rows.push(r);
  }
  const groups = [...map.values()];
  for (const g of groups) g.rows.sort((a, b) => a.item.localeCompare(b.item));
  return groups.sort((a, b) => a.residentName.localeCompare(b.residentName));
}
