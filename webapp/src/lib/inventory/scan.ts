import { barcodeVariants, type InvBarcode, type InvProduct } from "./core";

// Pure scan helpers for the Inventory operational forms (§9.6, D-95, D-109,
// docs/inventory-design.md §16). No React, no server imports: safe on the client.
// Operational forms find products ONLY by barcode or exact SKU (owner rule §0.2).

export type BarcodeHit = { productId: number; uomId: number };

/** D-95: preloaded map, keyed by the trimmed barcode. First entry wins. */
export function buildBarcodeMap(barcodes: InvBarcode[]): Map<string, BarcodeHit> {
  const map = new Map<string, BarcodeHit>();
  for (const b of barcodes) {
    if (!map.has(b.barcode)) map.set(b.barcode, { productId: b.productId, uomId: b.uomId });
  }
  return map;
}

/** Exact code first, then UPC-A ↔ EAN-13 (leading 0 added or dropped). */
export function lookupBarcode(map: Map<string, BarcodeHit>, raw: string): BarcodeHit | null {
  for (const variant of barcodeVariants(raw)) {
    const hit = map.get(variant);
    if (hit) return hit;
  }
  return null;
}

/** Lower-cased SKU → product (SKUs are unique case-insensitively). */
export function buildSkuMap(products: InvProduct[]): Map<string, InvProduct> {
  const map = new Map<string, InvProduct>();
  for (const p of products) map.set(p.sku.trim().toLowerCase(), p);
  return map;
}

export function lookupSku(map: Map<string, InvProduct>, raw: string): InvProduct | null {
  return map.get(raw.trim().toLowerCase()) ?? null;
}

/** A code the attach RPC would accept (printable ASCII, 3-64 chars). */
export function isPlausibleBarcode(code: string): boolean {
  return /^[\x21-\x7E]{3,64}$/.test(code);
}

// ------------------------------------------------------------ scanner bursts (D-109)

export const SCAN_MIN_CHARS = 6;
export const SCAN_MAX_GAP_MS = 35;

export type BurstState = { chars: string; lastAt: number };
export const EMPTY_BURST: BurstState = { chars: "", lastAt: 0 };

/** Does a key at `at` continue the current burst (gap under the threshold)? */
export function continuesBurst(state: BurstState, at: number): boolean {
  return state.chars.length > 0 && at - state.lastAt < SCAN_MAX_GAP_MS;
}

/** Add one printable key; a slow key starts a new burst. */
export function feedBurstKey(state: BurstState, key: string, at: number): BurstState {
  return continuesBurst(state, at)
    ? { chars: state.chars + key, lastAt: at }
    : { chars: key, lastAt: at };
}

/** The scanned code if Enter ends a fast burst of enough characters, else null. */
export function burstCodeOnEnter(state: BurstState, at: number): string | null {
  return state.chars.length >= SCAN_MIN_CHARS && at - state.lastAt < SCAN_MAX_GAP_MS ? state.chars : null;
}

// ------------------------------------------------------------ qty input guard (D-109)

const QTY_TYPING_RE = /^\d{0,7}(\.\d{0,4})?$/;

/** Qty inputs reject more than 7 integer digits (and 4 decimals): keep `prev` if `next` breaks it. */
export function limitQtyInput(next: string, prev: string): string {
  return QTY_TYPING_RE.test(next) ? next : prev;
}
