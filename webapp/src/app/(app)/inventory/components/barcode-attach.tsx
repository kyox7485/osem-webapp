"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { productUoms, uomLabel, type InvBarcode, type InvCatalogue, type InvProduct } from "@/lib/inventory/core";
import { lookupSku } from "@/lib/inventory/scan";
import { getBarcodeAttachContext, type BarcodeAttachContext } from "../actions";
import { ErrorNotice, Field, INPUT_CLS, PRIMARY_BTN_CLS, SECONDARY_BTN_CLS, Spinner, StaffSelect } from "./form-bits";
import { useInvSubmit } from "./use-inv-submit";

/**
 * "Not found -> attach this barcode to a product" (D-128, senior staff only).
 * The product is picked by its exact SKU, never by name search. The RPC is the
 * authority on who may attach; the panel only shows for BARCODE_ATTACH-tier logins.
 */
export function BarcodeAttach({
  code,
  catalogue,
  skuMap,
  accept,
  onAttached,
  onCancel,
}: {
  code: string;
  catalogue: InvCatalogue;
  skuMap: Map<string, InvProduct>;
  accept: (product: InvProduct) => boolean;
  onAttached: (barcode: InvBarcode, product: InvProduct) => void;
  onCancel: () => void;
}) {
  const t = useTranslation();
  const [ctx, setCtx] = useState<BarcodeAttachContext | null>(null);
  const [sku, setSku] = useState("");
  const [uomId, setUomId] = useState("");
  const [staffId, setStaffId] = useState("");
  const product = sku.trim() === "" ? null : lookupSku(skuMap, sku);
  const valid = product && product.isActive && accept(product) ? product : null;
  const chosenUom = valid ? (uomId && productUoms(valid).some((u) => String(u.uomId) === uomId) ? uomId : String(valid.baseUomId)) : "";

  useEffect(() => {
    let live = true;
    getBarcodeAttachContext()
      .then((c) => live && setCtx(c))
      .catch(() => live && setCtx({ allowed: false, needsStaff: false, staff: [] }));
    return () => {
      live = false;
    };
  }, []);

  const state = useInvSubmit("inv_add_barcode", "inv-attach-barcode", () => {
    if (!valid) return;
    onAttached(
      { id: 0, barcode: code, productId: valid.id, uomId: Number(chosenUom), ownerBranchId: null },
      valid,
    );
  });
  // a new idempotency key after an edit, but this side panel must not dirty the page's form guard
  const edited = () => {
    state.touch();
    state.discard();
  };

  if (!ctx?.allowed) return null;

  function attach() {
    if (!valid) return state.setError("PRODUCT_NOT_FOUND");
    state.submit({
      product_id: valid.id,
      uom_id: Number(chosenUom),
      barcode: code,
      ...(ctx?.needsStaff ? { performed_by_staff: staffId } : {}),
    });
  }

  return (
    <div
      data-scanner-ignore
      className="mt-2 space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
    >
      <p className="text-sm font-medium text-fg">{t("Attach this barcode to a product")}</p>
      <p className="break-all text-xs text-fg-secondary">
        {t("Barcode")}: <span className="font-mono">{code}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t("Exact SKU of the product")}
          required
          hint={sku.trim() === "" ? undefined : valid ? valid.name : t("No product with that exact SKU.")}
        >
          <input
            className={INPUT_CLS}
            value={sku}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(e) => {
              setSku(e.target.value);
              setUomId("");
              edited();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // never submits the surrounding form
                if (valid && !state.isPending) attach();
              }
            }}
          />
        </Field>
        {valid && (
          <Field label={t("Unit this barcode stands for")} required>
            <select
              className={INPUT_CLS}
              value={chosenUom}
              onChange={(e) => {
                setUomId(e.target.value);
                edited();
              }}
            >
              {productUoms(valid).map((u) => (
                <option key={u.uomId} value={u.uomId}>
                  {uomLabel(catalogue.uoms, u.uomId)}
                  {u.factor !== 1 ? ` (${u.factor})` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {ctx.needsStaff && (
          <StaffSelect
            staff={ctx.staff}
            value={staffId}
            onChange={(v) => {
              setStaffId(v);
              edited();
            }}
            seniorOnly
          />
        )}
      </div>
      <ErrorNotice code={state.error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY_BTN_CLS}
          disabled={state.isPending || !valid || (ctx.needsStaff && !staffId)}
          onClick={attach}
        >
          {state.isPending && <Spinner />}
          {t("Attach barcode")}
        </button>
        <button type="button" className={SECONDARY_BTN_CLS} disabled={state.isPending} onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
