"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { productUoms, uomLabel, type InvBarcode, type InvCatalogue, type InvProduct, type InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../../components/use-inv-submit";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, SECONDARY_BTN_CLS, StaffSelect, SubmitButton } from "../../components/form-bits";

/** Barcodes of one product: attach (editors, or a branch's senior staff for global products) and deactivate (editors). */
export function BarcodePanel({
  product,
  catalogue,
  staff,
  canManage,
  canAttach,
}: {
  product: InvProduct;
  catalogue: InvCatalogue;
  staff: InvStaff[];
  canManage: boolean;
  canAttach: boolean;
}) {
  const t = useTranslation();
  const codes = catalogue.barcodes.filter((b) => b.productId === product.id);
  const uoms = productUoms(product);
  const [code, setCode] = useState("");
  const [uomId, setUomId] = useState(String(product.purchaseUomId));
  const [staffId, setStaffId] = useState("");
  const add = useInvSubmit("inv_add_barcode", `inv-barcode-add-${product.id}`, () => setCode(""));

  return (
    <div className={`${CARD_CLS} space-y-3`}>
      <h3 className="text-sm font-semibold text-fg">{t("Barcodes")}</h3>
      {codes.length === 0 ? (
        <p className="text-sm text-fg-subtle">{t("No barcodes yet.")}</p>
      ) : (
        <ul className="divide-y divide-line-subtle text-sm">
          {codes.map((b) => (
            <BarcodeRow key={b.id} barcode={b} uomCode={uomLabel(catalogue.uoms, b.uomId)} canManage={canManage} />
          ))}
        </ul>
      )}
      {canAttach && (
        <form
          className="grid items-end gap-2 sm:grid-cols-4"
          onChangeCapture={add.touch}
          onSubmit={(e) => {
            e.preventDefault();
            add.submit({ product_id: product.id, uom_id: Number(uomId), barcode: code.trim(), performed_by_staff: canManage ? null : staffId });
          }}
        >
          <Field label={t("Barcode")} required>
            <input
              className={INPUT_CLS}
              maxLength={64}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("Scan or type")}
            />
          </Field>
          <Field label={t("Unit")} required>
            <select className={INPUT_CLS} value={uomId} onChange={(e) => setUomId(e.target.value)}>
              {uoms.map((u) => (
                <option key={u.uomId} value={u.uomId}>
                  {uomLabel(catalogue.uoms, u.uomId)}
                </option>
              ))}
            </select>
          </Field>
          {!canManage && <StaffSelect staff={staff} value={staffId} onChange={setStaffId} seniorOnly />}
          <div>
            <SubmitButton isPending={add.isPending} label={t("Add barcode")} />
          </div>
          <div className="sm:col-span-4">
            <FormStatus state={add} />
          </div>
        </form>
      )}
    </div>
  );
}

function BarcodeRow({ barcode, uomCode, canManage }: { barcode: InvBarcode; uomCode: string; canManage: boolean }) {
  const t = useTranslation();
  const off = useInvSubmit("inv_deactivate_barcode", `inv-barcode-off-${barcode.id}`);
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <span className="font-mono text-fg">{barcode.barcode}</span>
      <span className="text-xs text-fg-subtle">{uomCode}</span>
      <span className="flex-1" />
      {canManage && !off.success && (
        <button type="button" className={SECONDARY_BTN_CLS} disabled={off.isPending} onClick={() => off.submit({ barcode_id: barcode.id })}>
          {t("Deactivate")}
        </button>
      )}
      <FormStatus state={off} />
    </li>
  );
}
