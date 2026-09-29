"use client";

import { useMemo, useRef, useState } from "react";
import { ScanLine, Trash2 } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import {
  findBarcode,
  parseQty,
  productUoms,
  uomLabel,
  type InvCatalogue,
  type InvProduct,
} from "@/lib/inventory/core";
import { SMALL_INPUT_CLS } from "./form-bits";

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
 * Product lines with barcode scanning (§9.6, D-95): a keyboard-wedge scanner
 * types into the scan box and sends Enter; the code is looked up in the
 * preloaded barcode map (exact, then UPC-A ↔ EAN-13) and adds a line or
 * increments the same product+UOM. Enter in the scan box never submits the
 * form. An exact SKU typed into the scan box also works. There is deliberately
 * NO search-by-name: similar product names made picking the wrong item too easy.
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

  const stockProducts = useMemo(
    () => catalogue.products.filter((p) => p.isStockItem === !serviceOnly && p.isActive),
    [catalogue.products, serviceOnly],
  );
  const byId = useMemo(
    () => new Map(catalogue.products.map((p) => [p.id, p])),
    [catalogue.products],
  );

  function addOrIncrement(product: InvProduct, uomId: number) {
    const existing = lines.find(
      (l) => l.productId === product.id && l.uomId === uomId,
    );
    if (existing) {
      const n = Number(existing.qty) || 0;
      onChange(
        lines.map((l) =>
          l.key === existing.key ? { ...l, qty: String(n + 1) } : l,
        ),
      );
    } else if (lines.some((l) => l.productId === product.id)) {
      // one line per product (the RPCs reject duplicates): switch that line's unit
      onChange(
        lines.map((l) =>
          l.productId === product.id ? { ...l, uomId, qty: "1" } : l,
        ),
      );
    } else {
      onChange([...lines, newLine(product.id, uomId)]);
    }
  }

  function handleScan() {
    const code = scan.trim();
    if (!code) return;
    const hit = findBarcode(catalogue.barcodes, code);
    const product = hit
      ? byId.get(hit.productId)
      : stockProducts.find((p) => p.sku.toLowerCase() === code.toLowerCase());
    if (!product || product.isStockItem === serviceOnly || !product.isActive) {
      setNotFound(code);
      setFound(null);
    } else {
      setNotFound(null);
      setFound(product.name);
      addOrIncrement(
        product,
        hit
          ? hit.uomId
          : defaultUom === "purchase"
            ? product.purchaseUomId
            : product.baseUomId,
      );
    }
    setScan("");
    scanRef.current?.focus();
  }

  const update = (key: string, patch: Partial<EditorLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3">
      <div className="max-w-xl">
        <div className="relative">
          <ScanLine
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-fg-faint"
            aria-hidden
          />
          <input
            ref={scanRef}
            className={`${SMALL_INPUT_CLS} py-2 pl-8`}
            placeholder={t("Scan barcode or type SKU, then Enter")}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // never submits the form
                handleScan();
              }
            }}
            aria-label={t("Scan barcode")}
          />
          {notFound && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {t("Not found")}: {notFound}.{" "}
              {t("Scan the barcode or enter the exact SKU.")}
            </p>
          )}
          {!notFound && found && (
            <p className="mt-1 text-xs text-fg-secondary">
              {t("Found")}: {found}
            </p>
          )}
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-fg-subtle">
          {t("No lines yet. Scan a barcode or enter a SKU to add products.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
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
            <tbody className="divide-y divide-line-subtle">
              {lines.map((line) => {
                const product = byId.get(line.productId);
                const uoms = productUoms(product);
                return (
                  <tr key={line.key}>
                    <td className="px-2 py-2 text-fg">
                      {product?.name ?? "?"}
                      <div className="text-xs text-fg-subtle">
                        {product?.sku}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {allowUomChange ? (
                        <select
                          className={SMALL_INPUT_CLS}
                          value={line.uomId}
                          onChange={(e) =>
                            update(line.key, { uomId: Number(e.target.value) })
                          }
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
                    <td className="px-2 py-2">
                      <input
                        className={SMALL_INPUT_CLS}
                        inputMode="decimal"
                        maxLength={12}
                        value={line.qty}
                        onChange={(e) =>
                          update(line.key, { qty: e.target.value })
                        }
                        aria-label={t("Qty")}
                      />
                    </td>
                    {columns.map((c) => (
                      <td key={c.id} className="px-2 py-2">
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
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        className="rounded p-1 text-fg-faint hover:bg-hover hover:text-red-600"
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
