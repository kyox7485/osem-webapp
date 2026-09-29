"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScanLine, Trash2 } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import {
  parseQty,
  productUoms,
  uomLabel,
  type InvCatalogue,
  type InvProduct,
} from "@/lib/inventory/core";
import { isPlausibleBarcode, limitQtyInput } from "@/lib/inventory/scan";
import { BarcodeAttach } from "./barcode-attach";
import { SMALL_INPUT_CLS } from "./form-bits";
import { useProductLookup } from "./use-product-lookup";
import { useScannerCapture } from "./use-scanner-capture";

export type EditorLine = {
  key: string;
  productId: number;
  uomId: number;
  qty: string;
  extra: Record<string, string>;
};

export type ExtraColumn = {
  id: string;
  label: string;
  width?: string;
  render: (
    line: EditorLine,
    set: (value: string) => void,
    product: InvProduct | undefined,
  ) => React.ReactNode;
};

let lineSeq = 0;
export function newLine(
  productId: number,
  uomId: number,
  qty = "1",
  extra: Record<string, string> = {},
): EditorLine {
  lineSeq += 1;
  return { key: `l${Date.now()}-${lineSeq}`, productId, uomId, qty, extra };
}

/**
 * Product lines with barcode scanning (§9.6, D-95, D-109): a keyboard-wedge
 * scanner sends a fast burst ending in Enter; `useScannerCapture` routes it here
 * whatever has focus (and takes the characters back out of the focused input),
 * or it is typed into the scan box. The code is looked up in the preloaded
 * barcode map (exact, then UPC-A <-> EAN-13), then by exact SKU, then once on
 * the server. A hit adds a line or increments the same product+UOM (a box
 * barcode adds 1 of its own unit). Enter in the scan box never submits the
 * form. There is deliberately NO search-by-name (owner rule, design 0.2):
 * an unknown code offers "attach to a product" to senior staff, by exact SKU.
 * On a phone each line stacks into a card.
 */
export function LineEditor({
  catalogue,
  lines,
  onChange,
  defaultUom = "base",
  columns = [],
  allowUomChange = true,
  serviceOnly = false,
}: {
  catalogue: InvCatalogue;
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  defaultUom?: "base" | "purchase";
  columns?: ExtraColumn[];
  allowUomChange?: boolean;
  /** true: only service items can be added (Charge a service); false: only stock items */
  serviceOnly?: boolean;
}) {
  const t = useTranslation();
  const [scan, setScan] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef(lines);
  const { byId, skuMap, resolve, resolveLocal, addAttached } = useProductLookup(catalogue);

  useEffect(() => {
    linesRef.current = lines;
  });

  const accepts = useCallback(
    (p: InvProduct) => p.isActive && p.isStockItem === !serviceOnly,
    [serviceOnly],
  );

  function addOrIncrement(product: InvProduct, uomId: number) {
    const current = linesRef.current;
    const existing = current.find((l) => l.productId === product.id && l.uomId === uomId);
    let next: EditorLine[];
    if (existing) {
      const n = Number(existing.qty) || 0;
      next = current.map((l) => (l.key === existing.key ? { ...l, qty: String(n + 1) } : l));
    } else if (current.some((l) => l.productId === product.id)) {
      // one line per product (the RPCs reject duplicates): switch that line's unit
      next = current.map((l) => (l.productId === product.id ? { ...l, uomId, qty: "1" } : l));
    } else {
      next = [...current, newLine(product.id, uomId)];
    }
    linesRef.current = next;
    onChange(next);
  }

  async function handleCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const res = resolveLocal(code) ?? (await resolve(code));
    if (!res || !accepts(res.product)) {
      setNotFound(code);
      setFound(null);
    } else {
      const { product } = res;
      setNotFound(null);
      setFound(product.name);
      addOrIncrement(
        product,
        res.uomId ?? (defaultUom === "purchase" ? product.purchaseUomId : product.baseUomId),
      );
    }
    scanRef.current?.focus();
  }

  useScannerCapture((code) => void handleCode(code), { rootRef });

  const update = (key: string, patch: Partial<EditorLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // phone: each row becomes a card; each cell shows its label from data-label
  const cellCls =
    "px-2 py-2 max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:px-0 max-md:py-1.5 max-md:before:text-xs max-md:before:text-fg-subtle max-md:before:content-[attr(data-label)] max-md:[&>*]:w-3/5";

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="max-w-xl">
        <div className="relative">
          <ScanLine
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-fg-faint max-md:top-3.5"
            aria-hidden
          />
          <input
            ref={scanRef}
            className={`${SMALL_INPUT_CLS} py-2 pl-8`}
            placeholder={t("Scan barcode or type SKU, then Enter")}
            value={scan}
            enterKeyHint="go"
            autoComplete="off"
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // never submits the form
                const code = scan;
                setScan("");
                void handleCode(code);
              }
            }}
            aria-label={t("Scan barcode")}
          />
        </div>
        {notFound && (
          <>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {t("Not found")}: <span className="break-all font-mono">{notFound}</span>.{" "}
              {t("Scan the barcode or enter the exact SKU.")}
            </p>
            {isPlausibleBarcode(notFound) && (
              <BarcodeAttach
                key={notFound}
                code={notFound}
                catalogue={catalogue}
                skuMap={skuMap}
                accept={accepts}
                onCancel={() => setNotFound(null)}
                onAttached={(barcode, product) => {
                  addAttached(barcode);
                  setNotFound(null);
                  setFound(product.name);
                  addOrIncrement(product, barcode.uomId);
                  scanRef.current?.focus();
                }}
              />
            )}
          </>
        )}
        {!notFound && found && (
          <p className="mt-1 text-xs text-fg-secondary">
            {t("Found")}: {found}
          </p>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-fg-subtle">
          {t("No lines yet. Scan a barcode or enter a SKU to add products.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm max-md:block">
            <thead className="bg-surface-muted text-left text-xs text-fg-subtle max-md:hidden">
              <tr>
                <th className="px-2 py-2 font-medium">{t("Product")}</th>
                <th className="w-28 px-2 py-2 font-medium">{t("Unit")}</th>
                <th className="w-28 px-2 py-2 font-medium">{t("Qty")}</th>
                {columns.map((c) => (
                  <th
                    key={c.id}
                    className={`px-2 py-2 font-medium ${c.width ?? ""}`}
                  >
                    {c.label}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle max-md:block max-md:space-y-3 max-md:divide-y-0">
              {lines.map((line) => {
                const product = byId.get(line.productId);
                const uoms = productUoms(product);
                return (
                  <tr
                    key={line.key}
                    className="max-md:block max-md:rounded-lg max-md:border max-md:border-line max-md:bg-surface max-md:p-3"
                  >
                    <td className="px-2 py-2 text-fg max-md:block max-md:px-0 max-md:pt-0">
                      {product?.name ?? "?"}
                      <div className="text-xs text-fg-subtle">
                        {product?.sku}
                      </div>
                    </td>
                    <td className={cellCls} data-label={t("Unit")}>
                      {allowUomChange ? (
                        <select
                          className={SMALL_INPUT_CLS}
                          value={line.uomId}
                          onChange={(e) =>
                            update(line.key, { uomId: Number(e.target.value) })
                          }
                          aria-label={t("Unit")}
                        >
                          {uoms.map((u) => (
                            <option key={u.uomId} value={u.uomId}>
                              {uomLabel(catalogue.uoms, u.uomId)}
                              {u.factor !== 1 ? ` (${u.factor})` : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-fg-secondary">
                          {uomLabel(catalogue.uoms, line.uomId)}
                        </span>
                      )}
                    </td>
                    <td className={cellCls} data-label={t("Qty")}>
                      <input
                        className={SMALL_INPUT_CLS}
                        inputMode="decimal"
                        maxLength={12}
                        value={line.qty}
                        onChange={(e) =>
                          update(line.key, { qty: limitQtyInput(e.target.value, line.qty) })
                        }
                        aria-label={t("Qty")}
                      />
                    </td>
                    {columns.map((c) => (
                      <td key={c.id} className={cellCls} data-label={c.label}>
                        {c.render(
                          line,
                          (value) =>
                            update(line.key, {
                              extra: { ...line.extra, [c.id]: value },
                            }),
                          product,
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right max-md:block max-md:px-0 max-md:pb-0">
                      <button
                        type="button"
                        className="rounded p-1 text-fg-faint hover:bg-hover hover:text-red-600 max-md:inline-flex max-md:min-h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
                        onClick={() =>
                          onChange(lines.filter((l) => l.key !== line.key))
                        }
                        aria-label={t("Remove line")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Editor lines → RPC lines [{product_id, uom_id, qty, ...extra}]; null if a qty is invalid. */
export function linesToPayload(
  lines: EditorLine[],
  mapExtra: (line: EditorLine) => Record<string, unknown> = () => ({}),
): Record<string, unknown>[] | null {
  const out: Record<string, unknown>[] = [];
  for (const l of lines) {
    const qty = parseQty(l.qty);
    if (qty === null) return null;
    out.push({ product_id: l.productId, uom_id: l.uomId, qty, ...mapExtra(l) });
  }
  return out;
}
