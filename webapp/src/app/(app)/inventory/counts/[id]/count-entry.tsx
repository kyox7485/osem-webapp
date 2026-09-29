"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import {
  type InvCatalogue,
  type InvCountLineView,
  type InvProduct,
  type InvResident,
  type InvStaff,
} from "@/lib/inventory/core";
import { isPlausibleBarcode, limitQtyInput } from "@/lib/inventory/scan";
import { BarcodeAttach } from "../../components/barcode-attach";
import { useInvSubmit } from "../../components/use-inv-submit";
import { useProductLookup } from "../../components/use-product-lookup";
import { useScannerCapture } from "../../components/use-scanner-capture";
import {
  CARD_CLS,
  ErrorNotice,
  Field,
  INPUT_CLS,
  PRIMARY_BTN_CLS,
  SECONDARY_BTN_CLS,
  SMALL_INPUT_CLS,
  Spinner,
} from "../../components/form-bits";
import { CancelCount } from "./cancel-count";
import { FoundBadge } from "./count-lines-table";

type FoundDraft = { key: string; productId: number; residentId: string; qty: string };

const QTY_RE = /^\d{1,7}(\.\d{1,4})?$/;
/** "" = not counted (null); a number (0 allowed); undefined = invalid text. */
function parseCounted(raw: string): number | null | undefined {
  const v = raw.trim();
  if (v === "") return null;
  return QTY_RE.test(v) ? Number(v) : undefined;
}

/**
 * Blind count entry (D-104): the sheet shows what to count, never the book
 * quantity. Scan a barcode / exact SKU to jump to a line, or to add a found
 * item (a product not on the sheet). Save keeps progress; Submit saves, then
 * submits (every line must be counted; 0 is a valid count).
 */
export function CountEntry({
  countId,
  branchId,
  isTransit,
  lines,
  catalogue,
  residents,
  staff,
}: {
  countId: number;
  branchId: number;
  isTransit: boolean;
  lines: InvCountLineView[];
  catalogue: InvCatalogue;
  residents: InvResident[];
  staff: InvStaff[];
}) {
  const t = useTranslation();
  const [qty, setQty] = useState<Record<number, string>>({}); // edits over the saved values
  const [extras, setExtras] = useState<FoundDraft[]>([]);
  const [scan, setScan] = useState("");
  const [notice, setNotice] = useState<{ kind: "notFound" | "found"; text: string } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [transitProduct, setTransitProduct] = useState<InvProduct | null>(null);
  const [transitResident, setTransitResident] = useState("");
  const [showInvalid, setShowInvalid] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const scanRef = useRef<HTMLInputElement>(null);
  const submitAfterSave = useRef(false);
  const [intent, setIntent] = useState<"save" | "submit">("save");

  const { byId, skuMap, resolve, resolveLocal, addAttached } = useProductLookup(catalogue);
  const rootRef = useRef<HTMLDivElement>(null);
  const uomCode = (p: InvProduct | undefined) => catalogue.uoms.find((u) => u.id === p?.baseUomId)?.code ?? "";
  const residentName = (id: string) => residents.find((r) => String(r.id) === id)?.name ?? "";

  const submitState = useInvSubmit("inv_submit_count", `inv-count-submit-${countId}`);
  const saveState = useInvSubmit("inv_save_count_lines", `inv-count-save-${countId}`, () => {
    setExtras([]);
    if (submitAfterSave.current) {
      submitAfterSave.current = false;
      submitState.submit({ count_id: countId });
    }
  });

  const valueOf = (l: InvCountLineView) => qty[l.id] ?? (l.physical === null ? "" : String(l.physical));
  const invalid = (raw: string) => parseCounted(raw) === undefined;
  const counted = lines.filter((l) => typeof parseCounted(valueOf(l)) === "number").length;
  const total = lines.length + extras.length;
  const doneExtras = extras.filter((x) => typeof parseCounted(x.qty) === "number").length;
  const allCounted = counted + doneExtras === total && total > 0;
  const busy = saveState.isPending || submitState.isPending;

  function touch() {
    saveState.touch();
    submitState.touch();
  }

  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(timer);
  }, [highlight]);

  function focusSoon(key: string) {
    setHighlight(key);
    setTimeout(() => {
      const el = inputs.current.get(key);
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    }, 0);
  }

  function addFound(product: InvProduct, residentId: string) {
    const existing = extras.find((x) => x.productId === product.id && x.residentId === residentId);
    if (existing) return focusSoon(`x-${existing.key}`);
    const key = crypto.randomUUID();
    setExtras((prev) => [...prev, { key, productId: product.id, residentId, qty: "" }]);
    setNotice({ kind: "found", text: `${t("Not on the sheet, added as a found item")}: ${product.name}` });
    focusSoon(`x-${key}`);
  }

  function routeProduct(product: InvProduct) {
    const onSheet = lines.find((l) => l.productId === product.id);
    if (onSheet) {
      setNotice({ kind: "found", text: product.name });
      return focusSoon(`l-${onSheet.id}`);
    }
    if (isTransit) {
      setNotice(null);
      setTransitProduct(product);
      return;
    }
    addFound(product, "");
  }

  // Scan (typed in the box, or captured from the scanner whatever has focus):
  // jump to the sheet line and focus its qty, or add a found item.
  async function handleCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const res = resolveLocal(code) ?? (await resolve(code));
    setTransitProduct(null);
    if (!res || !res.product.isStockItem || !res.product.isActive) {
      setNotice({ kind: "notFound", text: code });
      return;
    }
    routeProduct(res.product);
  }

  useScannerCapture((code) => void handleCode(code), { rootRef });

  function buildPayload() {
    const changed: { count_line_id: number; physical_qty: number | null }[] = [];
    for (const l of lines) {
      const raw = valueOf(l);
      const parsed = parseCounted(raw);
      if (parsed === undefined) return null;
      if (parsed !== l.physical) changed.push({ count_line_id: l.id, physical_qty: parsed });
    }
    const found = [];
    for (const x of extras) {
      const parsed = parseCounted(x.qty);
      if (parsed === undefined) return null;
      if (parsed === null) continue; // nothing typed yet: stays a draft
      found.push({ product_id: x.productId, resident_id: x.residentId ? Number(x.residentId) : null, physical_qty: parsed });
    }
    return { count_id: countId, lines: changed, found };
  }

  function save(thenSubmit: boolean) {
    const payload = buildPayload();
    if (!payload) {
      setShowInvalid(true);
      return saveState.setError("INVALID_QTY");
    }
    setShowInvalid(false);
    submitAfterSave.current = thenSubmit;
    setIntent(thenSubmit ? "submit" : "save");
    if (payload.lines.length === 0 && payload.found.length === 0 && thenSubmit) {
      submitAfterSave.current = false;
      return submitState.submit({ count_id: countId });
    }
    saveState.submit(payload);
  }

  const inputCls = (raw: string) =>
    `${SMALL_INPUT_CLS} w-24 text-right md:w-28 ${showInvalid && invalid(raw) ? "border-red-500 dark:border-red-400" : ""}`;

  return (
    <div ref={rootRef} className="space-y-4">
      <div className={`${CARD_CLS} space-y-3`}>
        <div className="max-w-xl">
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-fg-faint" aria-hidden />
            <input
              ref={scanRef}
              className={`${SMALL_INPUT_CLS} py-2 pl-8`}
              placeholder={t("Scan barcode or type SKU, then Enter")}
              aria-label={t("Scan barcode")}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault(); // never submits the form
                  const code = scan;
                  setScan("");
                  void handleCode(code);
                }
              }}
            />
          </div>
          {notice?.kind === "notFound" && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {t("Not found")}: <span className="break-all font-mono">{notice.text}</span>. {t("Scan the barcode or enter the exact SKU.")}
            </p>
          )}
          {notice?.kind === "notFound" && isPlausibleBarcode(notice.text) && (
            <BarcodeAttach
              key={notice.text}
              code={notice.text}
              catalogue={catalogue}
              skuMap={skuMap}
              accept={(p) => p.isActive && p.isStockItem}
              onCancel={() => setNotice(null)}
              onAttached={(barcode, product) => {
                addAttached(barcode);
                setNotice(null);
                routeProduct(product);
              }}
            />
          )}
          {notice?.kind === "found" && <p className="mt-1 text-xs text-fg-secondary">{notice.text}</p>}
        </div>
        {transitProduct && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={`${t("Resident")} (${transitProduct.name})`} required>
              <select className={INPUT_CLS} value={transitResident} onChange={(e) => setTransitResident(e.target.value)}>
                <option value="">{t("Select resident")}</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.residentCode ? ` (${r.residentCode})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              className={SECONDARY_BTN_CLS}
              disabled={!transitResident}
              onClick={() => {
                addFound(transitProduct, transitResident);
                setTransitProduct(null);
                setTransitResident("");
              }}
            >
              {t("Add found item")}
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm" onChangeCapture={touch}>
        <table className="w-full text-sm">
          <thead className="bg-surface-strong text-left text-xs text-fg-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">{t("Product")}</th>
              <th className="px-3 py-2 font-medium max-md:hidden">{t("SKU")}</th>
              {isTransit && <th className="px-3 py-2 font-medium">{t("Resident")}</th>}
              <th className="px-3 py-2 text-right font-medium">{t("Counted")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {lines.map((l) => (
              <tr key={l.id} className={`transition-colors ${highlight === `l-${l.id}` ? "bg-amber-100 ring-2 ring-inset ring-amber-400 dark:bg-amber-950/40 dark:ring-amber-500" : ""}`}>
                <td className="px-3 py-2 text-fg">
                  {l.name}
                  {l.isFound && <FoundBadge />}
                  <div className="text-xs text-fg-subtle md:hidden">{l.sku}</div>
                </td>
                <td className="px-3 py-2 text-fg-subtle max-md:hidden">{l.sku}</td>
                {isTransit && <td className="px-3 py-2 text-fg-secondary">{l.residentName ?? ""}</td>}
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <input
                      ref={(el) => {
                        if (el) inputs.current.set(`l-${l.id}`, el);
                        else inputs.current.delete(`l-${l.id}`);
                      }}
                      className={inputCls(valueOf(l))}
                      inputMode="decimal"
                      aria-label={`${t("Counted")} ${l.name}`}
                      value={valueOf(l)}
                      onChange={(e) => setQty((prev) => ({ ...prev, [l.id]: limitQtyInput(e.target.value, prev[l.id] ?? valueOf(l)) }))}
                    />
                    <span className="w-10 text-xs text-fg-subtle">{l.uomCode}</span>
                  </div>
                </td>
              </tr>
            ))}
            {extras.map((x) => {
              const p = byId.get(x.productId);
              return (
                <tr key={x.key} className={`bg-indigo-50/40 dark:bg-indigo-950/20 ${highlight === `x-${x.key}` ? "bg-amber-100 ring-2 ring-inset ring-amber-400 dark:bg-amber-950/40 dark:ring-amber-500" : ""}`}>
                  <td className="px-3 py-2 text-fg">
                    {p?.name}
                    <FoundBadge />
                    <div className="text-xs text-fg-subtle md:hidden">{p?.sku}</div>
                  </td>
                  <td className="px-3 py-2 text-fg-subtle max-md:hidden">{p?.sku}</td>
                  {isTransit && <td className="px-3 py-2 text-fg-secondary">{residentName(x.residentId)}</td>}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        ref={(el) => {
                          if (el) inputs.current.set(`x-${x.key}`, el);
                          else inputs.current.delete(`x-${x.key}`);
                        }}
                        className={inputCls(x.qty)}
                        inputMode="decimal"
                        aria-label={`${t("Counted")} ${p?.name ?? ""}`}
                        value={x.qty}
                        onChange={(e) =>
                          setExtras((prev) => prev.map((y) => (y.key === x.key ? { ...y, qty: limitQtyInput(e.target.value, y.qty) } : y)))
                        }
                      />
                      <span className="w-10 text-xs text-fg-subtle">{uomCode(p)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-fg-secondary">
          {counted + doneExtras} / {total} {t("counted")}
        </p>
        <ErrorNotice code={saveState.error ?? submitState.error} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY_BTN_CLS} disabled={busy} onClick={() => save(false)}>
            {busy && intent === "save" && <Spinner />}
            {t("Save progress")}
          </button>
          <button type="button" className={PRIMARY_BTN_CLS} disabled={busy || !allCounted} onClick={() => save(true)}>
            {busy && intent === "submit" && <Spinner />}
            {busy && intent === "submit" ? t("Saving...") : t("Submit count")}
          </button>
        </div>
        {!allCounted && <p className="text-xs text-fg-subtle">{t("Count every line (enter 0 if none) to submit.")}</p>}
      </div>

      <CancelCount countId={countId} branchId={branchId} submitted={false} staff={staff} />
    </div>
  );
}
