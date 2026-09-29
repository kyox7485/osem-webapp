"use client";

import { useCallback, useMemo, useState } from "react";
import type { InvBarcode, InvCatalogue, InvProduct } from "@/lib/inventory/core";
import { buildBarcodeMap, buildSkuMap, lookupBarcode, lookupSku } from "@/lib/inventory/scan";
import { lookupBarcodeAction } from "../actions";

/** uomId is set when the code was a barcode (a box barcode carries its own unit), null for an exact SKU. */
export type ScanResolution = { product: InvProduct; uomId: number | null };

/**
 * One product lookup for every operational form (D-95): the preloaded barcode
 * map (exact, then UPC-A <-> EAN-13), then the exact SKU, then a single server
 * lookup for codes attached after the page loaded. There is deliberately no
 * name search (owner rule, docs/inventory-design.md 0.2).
 */
export function useProductLookup(catalogue: InvCatalogue) {
  const [attached, setAttached] = useState<InvBarcode[]>([]);
  const barcodeMap = useMemo(() => buildBarcodeMap([...catalogue.barcodes, ...attached]), [catalogue.barcodes, attached]);
  const skuMap = useMemo(() => buildSkuMap(catalogue.products), [catalogue.products]);
  const byId = useMemo(() => new Map(catalogue.products.map((p) => [p.id, p])), [catalogue.products]);

  const resolveLocal = useCallback(
    (code: string): ScanResolution | null => {
      const hit = lookupBarcode(barcodeMap, code);
      const viaBarcode = hit ? byId.get(hit.productId) : undefined;
      if (hit && viaBarcode) return { product: viaBarcode, uomId: hit.uomId };
      const viaSku = lookupSku(skuMap, code);
      return viaSku ? { product: viaSku, uomId: null } : null;
    },
    [barcodeMap, byId, skuMap],
  );

  /** Local first (synchronous part of the promise); a miss asks the server once. */
  const resolve = useCallback(
    async (code: string): Promise<ScanResolution | null> => {
      const local = resolveLocal(code);
      if (local) return local;
      try {
        const remote = await lookupBarcodeAction(code);
        const product = remote ? byId.get(remote.productId) : undefined;
        return remote && product ? { product, uomId: remote.uomId } : null;
      } catch {
        return null;
      }
    },
    [byId, resolveLocal],
  );

  const addAttached = useCallback((barcode: InvBarcode) => setAttached((prev) => [...prev, barcode]), []);

  return { byId, skuMap, resolve, resolveLocal, addAttached };
}
