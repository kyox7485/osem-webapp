"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { Combobox } from "@/components/combobox";
import {
  formatMoney,
  uomLabel,
  parseMoney,
  parseQty,
  todayKL,
  type InvCatalogue,
  type InvCostHint,
  type InvProduct,
  type InvOpenRequest,
  type InvResident,
  type InvStaff,
  type InvSupplier,
} from "@/lib/inventory/core";
import type { LookupOption } from "@/lib/types";
import { runInventoryRpc } from "../actions";
import { useInvSubmit } from "../components/use-inv-submit";
import { LineEditor, newLine, type EditorLine } from "../components/line-editor";
import { CARD_CLS, EmptyState, ErrorNotice, Field, FormStatus, INPUT_CLS, SECONDARY_BTN_CLS, SMALL_INPUT_CLS, Spinner, StaffSelect, SubmitButton } from "../components/form-bits";

type Header = {
  requestId: string;
  supplierId: string;
  invoiceNo: string;
  invoiceDate: string;
  receivedDate: string;
  staffId: string;
  discount: string;
  tax: string;
  other: string;
  rounding: string;
  paperTotal: string;
  remarks: string;
};

const emptyHeader = (): Header => ({
  requestId: "",
  supplierId: "",
  invoiceNo: "",
  invoiceDate: todayKL(),
  receivedDate: todayKL(),
  staffId: "",
  discount: "",
  tax: "",
  other: "",
  rounding: "",
  paperTotal: "",
  remarks: "",
});

export function ReceiveForm({
  storeId,
  catalogue,
  suppliers,
  staff,
  residents,
  openRequests = [],
  costHints = [],
  canCreateSupplier = false,
  needsSupplierStaff = false,
}: {
  storeId: number | null;
  /** Approved / ordered stock requests with outstanding lines (optional link, schema/017). */
  openRequests?: InvOpenRequest[];
  /** WAC and last receipt cost per product, per base unit (read-only comparison). */
  costHints?: InvCostHint[];
  catalogue: InvCatalogue;
  suppliers: InvSupplier[];
  staff: InvStaff[];
  residents: InvResident[];
  /** May this login register a supplier that is not in the list yet? */
  canCreateSupplier?: boolean;
  /** A real-branch login must attribute the new supplier to a senior staff member. */
  needsSupplierStaff?: boolean;
}) {
  const t = useTranslation();
  const [h, setH] = useState<Header>(emptyHeader);
  const [lines, setLines] = useState<EditorLine[]>([]);
  // Suppliers added from this form. Kept in local state so the new one is
  // selectable immediately, without waiting for the page to re-query.
  const [extraSuppliers, setExtraSuppliers] = useState<LookupOption[]>([]);
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const state = useInvSubmit("inv_post_receipt", "inv-receive", () => {
    setH(emptyHeader());
    setLines([]);
  });
  const set = (k: keyof Header) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setH({ ...h, [k]: e.target.value });

  const residentOptions = useMemo(() => residents.map((r) => ({ id: r.id, label: r.name, hint: r.residentCode ?? undefined })), [residents]);
  const supplierOptions = useMemo<LookupOption[]>(
    () =>
      [...suppliers.map((s) => ({ id: s.id, label: s.name })), ...extraSuppliers].sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
    [suppliers, extraSuppliers]
  );

  // A name the user typed that matches nothing in the list, case- and
  // whitespace-insensitively -- the same key inv_save_supplier enforces.
  const canCreateName =
    canCreateSupplier &&
    newName.trim() !== "" &&
    !supplierOptions.some((o) => o.label.trim().toLowerCase() === newName.trim().toLowerCase());

  /**
   * Register a supplier the user typed but that does not exist yet, so a
   * delivery from an unregistered supplier can still be received in one go.
   * Posted on its own key and its own RPC -- the receipt below is untouched
   * until it succeeds, so a failure here never half-posts anything.
   */
  async function createSupplier() {
    const name = newName.trim();
    if (!name) return;
    setIsCreating(true);
    setCreateError(null);
    const result = await runInventoryRpc(
      "inv_save_supplier",
      { name, performed_by_staff: needsSupplierStaff ? h.staffId || null : null },
      crypto.randomUUID()
    );
    setIsCreating(false);
    if (!result.ok) {
      setCreateError(result.code);
      return;
    }
    const id = Number(result.data?.supplier_id);
    setExtraSuppliers((prev) => (prev.some((p) => p.id === id) ? prev : [...prev, { id, label: name }]));
    setNewName("");
    setH((prev) => ({ ...prev, supplierId: String(id) }));
  }

  // Picking a request prefills its outstanding lines (purchase UOM when it divides evenly)
  // and the supplier; everything stays editable. Products are still added only by barcode / SKU.
  function pickRequest(value: string) {
    state.touch();
    const req = openRequests.find((r) => String(r.id) === value);
    if (!req) {
      setH({ ...h, requestId: "" });
      return;
    }
    const next: EditorLine[] = [];
    for (const l of req.lines) {
      const p = catalogue.products.find((x) => x.id === l.productId);
      if (!p) continue;
      const factor = p.uoms.find((u) => u.uomId === p.purchaseUomId && u.isActive)?.factor ?? 0;
      const usePurchase = factor > 1 && l.outstandingBase % factor === 0;
      next.push(newLine(p.id, usePurchase ? p.purchaseUomId : p.baseUomId, String(usePurchase ? l.outstandingBase / factor : l.outstandingBase)));
    }
    setLines(next);
    setH({ ...h, requestId: value, supplierId: h.supplierId || (req.supplierId ? String(req.supplierId) : "") });
  }

  if (!storeId) return <EmptyState text={t("This branch has no Store location.")} />;

  // display only: the RPC computes the landed cost (§5.9 — no cost maths in TS)
  const linesTotal = lines.reduce((sum, l) => sum + Math.round((Number(l.qty) || 0) * (Number(l.extra.unit_cost) || 0) * 100) / 100, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const money = [h.discount, h.tax, h.other].map((v) => parseMoney(v));
    const rounding = h.rounding.trim() === "" ? 0 : Number(h.rounding);
    const paper = parseMoney(h.paperTotal);
    if (money.some((m) => m === undefined) || paper === undefined || !Number.isFinite(rounding)) {
      state.setError("INVALID_TOTALS");
      return;
    }
    const payloadLines = [];
    for (const l of lines) {
      const paid = l.qty.trim() === "" ? 0 : parseQty(l.qty);
      const foc = (l.extra.foc ?? "").trim() === "" ? 0 : parseQty(l.extra.foc);
      const cost = parseMoney(l.extra.unit_cost ?? "", false);
      if (paid === null || foc === null || paid + foc <= 0) return state.setError("INVALID_QTY");
      if (cost === undefined || cost === null) return state.setError("INVALID_COST");
      payloadLines.push({
        product_id: l.productId,
        uom_id: l.uomId,
        qty: paid,
        foc_qty: foc,
        unit_cost: cost,
        allocate_resident_id: l.extra.resident ? Number(l.extra.resident) : null,
      });
    }
    if (payloadLines.length === 0) return state.setError("INVALID_QTY");
    state.submit({
      location_id: storeId,
      supplier_id: h.supplierId ? Number(h.supplierId) : null,
      invoice_no: h.invoiceNo,
      invoice_date: h.invoiceDate,
      received_date: h.receivedDate,
      received_by_staff: h.staffId,
      discount_total: money[0] ?? 0,
      tax_total: money[1] ?? 0,
      other_charges_total: money[2] ?? 0,
      rounding_adj: rounding,
      invoice_total_paper: paper,
      remarks: h.remarks || null,
      stock_request_id: h.requestId ? Number(h.requestId) : null,
      lines: payloadLines,
    });
  }

  return (
    <form className="space-y-4" onChangeCapture={state.touch} onSubmit={handleSubmit}>
      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-3`}>
        {openRequests.length > 0 && (
          <Field label={t("For stock request")} hint={t("Optional. Fills in what is still outstanding on the request.")}>
            <select className={INPUT_CLS} value={h.requestId} onChange={(e) => pickRequest(e.target.value)}>
              <option value="">{t("Not linked to a request")}</option>
              {openRequests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.requestNo}
                  {r.externalRef ? ` · ${r.externalRef}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="sm:col-span-2">
          <Combobox
            id="receive-supplier"
            label={t("Supplier")}
            placeholder={t("Type to search or add a new supplier")}
            emptyMessage={t("Not found")}
            value={h.supplierId}
            // The Combobox clears the value to "" on every keystroke so the old
            // supplier stops being selected while the user re-types; that is a
            // search, not a deselection, so only a real pick updates the header.
            onChange={(id) => id && setH({ ...h, supplierId: id })}
            onQueryChange={setNewName}
            options={supplierOptions}
          />
          {canCreateName && (
            <div className="mt-1 space-y-1">
              <button type="button" className={SECONDARY_BTN_CLS} disabled={isCreating} onClick={createSupplier}>
                {isCreating && <Spinner />}
                {t('Register "{name}" as a new supplier', { name: newName.trim() })}
              </button>
              {needsSupplierStaff && !h.staffId && (
                <p className="text-xs text-fg-subtle">{t("Choose who received this first, so the new supplier is attributed to them.")}</p>
              )}
            </div>
          )}
          <ErrorNotice code={createError} />
        </div>
        <Field label={t("Invoice / bill no.")} required>
          <input className={INPUT_CLS} maxLength={60} value={h.invoiceNo} onChange={set("invoiceNo")} />
        </Field>
        <Field label={t("Invoice date")} required>
          <input type="date" className={INPUT_CLS} value={h.invoiceDate} onChange={set("invoiceDate")} />
        </Field>
        <Field label={t("Received date")} required>
          <input type="date" className={INPUT_CLS} value={h.receivedDate} onChange={set("receivedDate")} />
        </Field>
        <StaffSelect staff={staff} value={h.staffId} onChange={(v) => setH({ ...h, staffId: v })} seniorOnly label={t("Received by")} />
      </div>

      <div className={CARD_CLS}>
        <LineEditor
          catalogue={catalogue}
          lines={lines}
          onChange={(next) => {
            state.touch();
            setLines(next);
          }}
          defaultUom="purchase"
          columns={[
            {
              id: "foc",
              label: t("FOC qty"),
              width: "w-24",
              render: (l, setV) => <input className={SMALL_INPUT_CLS} inputMode="decimal" value={l.extra.foc ?? ""} onChange={(e) => setV(e.target.value)} />,
            },
            {
              id: "unit_cost",
              label: t("Unit cost (per unit)"),
              width: "w-40",
              render: (l, setV, product) => (
                <div className="space-y-1">
                  <input className={SMALL_INPUT_CLS} inputMode="decimal" value={l.extra.unit_cost ?? ""} onChange={(e) => setV(e.target.value)} />
                  <CostHints catalogue={catalogue} line={l} product={product} hint={costHints.find((h) => h.productId === l.productId)} />
                </div>
              ),
            },
            {
              id: "resident",
              label: t("Allocate to resident"),
              width: "w-44",
              render: (l, setV) => (
                <Combobox
                  hideLabel
                  label={t("Allocate to resident")}
                  inputClassName={SMALL_INPUT_CLS}
                  fixedPopup
                  value={l.extra.resident ?? ""}
                  onChange={(id) => {
                    state.touch();
                    setV(id);
                  }}
                  options={residentOptions}
                  placeholder={t("Store (no allocation)")}
                  clearable
                  emptyMessage={t("No matching resident")}
                />
              ),
            },
          ]}
        />
      </div>

      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-3`}>
        <Field label={t("Discount (RM)")}>
          <input className={INPUT_CLS} inputMode="decimal" value={h.discount} onChange={set("discount")} />
        </Field>
        <Field label={t("SST / tax (RM)")}>
          <input className={INPUT_CLS} inputMode="decimal" value={h.tax} onChange={set("tax")} />
        </Field>
        <Field label={t("Delivery / other charges (RM)")}>
          <input className={INPUT_CLS} inputMode="decimal" value={h.other} onChange={set("other")} />
        </Field>
        <Field label={t("Rounding (RM, ±1.00)")}>
          <input className={INPUT_CLS} inputMode="decimal" value={h.rounding} onChange={set("rounding")} />
        </Field>
        <Field label={t("Invoice total as printed (RM)")} hint={t("For information only")}>
          <input className={INPUT_CLS} inputMode="decimal" value={h.paperTotal} onChange={set("paperTotal")} />
        </Field>
        <Field label={t("Remarks")}>
          <input className={INPUT_CLS} maxLength={500} value={h.remarks} onChange={set("remarks")} />
        </Field>
        <p className="text-sm text-fg-secondary sm:col-span-3">
          {t("Lines total (paid qty)")}: <span className="font-semibold text-fg">RM {formatMoney(linesTotal)}</span>.{" "}
          {t("Tax, delivery and discount are spread over the lines by value when saved.")}
        </p>
      </div>

      <FormStatus state={state} />
      <SubmitButton isPending={state.isPending} label={t("Receive into Store")} />
    </form>
  );
}

/**
 * Cost per purchase unit and per base unit side by side, with the last receipt
 * cost and the current WAC to compare against (display only: the RPC owns cost).
 */
function CostHints({ catalogue, line, product, hint }: { catalogue: InvCatalogue; line: EditorLine; product: InvProduct | undefined; hint: InvCostHint | undefined }) {
  const t = useTranslation();
  const factor = product?.uoms.find((u) => u.uomId === line.uomId && u.isActive)?.factor ?? 1;
  const unit = uomLabel(catalogue.uoms, line.uomId);
  const baseUnit = uomLabel(catalogue.uoms, product?.baseUomId ?? 0);
  const entered = parseMoney(line.extra.unit_cost ?? "", false);
  const perBase = typeof entered === "number" && factor > 0 ? entered / factor : null;
  const inUnit = (baseCost: number | null | undefined) => (baseCost === null || baseCost === undefined ? null : baseCost * factor);
  const last = inUnit(hint?.lastCostBase);
  const wac = inUnit(hint?.wac);
  return (
    <div className="space-y-0.5 text-xs text-fg-subtle">
      {typeof entered === "number" && (
        <p>
          RM {formatMoney(entered)} / {unit}
          {factor !== 1 && perBase !== null && ` = RM ${formatMoney(perBase, 4)} / ${baseUnit}`}
        </p>
      )}
      <p>
        {t("Last receipt")}: {last === null ? t("none") : `RM ${formatMoney(last)} / ${unit}`}
      </p>
      <p>
        {t("Average cost (WAC)")}: {wac === null ? t("none") : `RM ${formatMoney(wac)} / ${unit}`}
      </p>
    </div>
  );
}
