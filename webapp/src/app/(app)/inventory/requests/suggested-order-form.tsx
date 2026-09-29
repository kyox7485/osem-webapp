"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { useNavPush } from "@/components/nav-loading";
import { formatQty, parseQty, type InvCatalogue, type InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { LineEditor, type EditorLine } from "../components/line-editor";
import { CARD_CLS, EmptyState, Field, FormStatus, INPUT_CLS, SMALL_INPUT_CLS, StaffSelect, SubmitButton } from "../components/form-bits";

export type SuggestionRow = {
  productId: number;
  sku: string;
  name: string;
  maxStore: number | null;
  maxFloor: number | null;
  onHandStore: number;
  onHandFloor: number;
  openQty: number;
  suggestedBase: number;
  purchaseUomId: number;
  purchaseUomCode: string;
  purchaseFactor: number;
  suggestedPurchase: number;
  baseUomCode: string;
};

const initialQty = (rows: SuggestionRow[]) =>
  Object.fromEntries(rows.map((r) => [r.productId, r.suggestedPurchase > 0 ? String(r.suggestedPurchase) : ""]));

/**
 * Suggested Order (Q-18) → new stock request. Quantities are prefilled from
 * the suggestion in the purchase UOM and stay editable (empty = not
 * requested). Items without a suggestion can be added by barcode / exact SKU
 * only (no name search in operational forms). No forecasting.
 */
export function SuggestedOrderForm({
  branchId,
  rows,
  catalogue,
  staff,
}: {
  branchId: number;
  rows: SuggestionRow[];
  catalogue: InvCatalogue;
  staff: InvStaff[];
}) {
  const t = useTranslation();
  const push = useNavPush();
  const [qty, setQty] = useState<Record<string, string>>(() => initialQty(rows));
  const [showAll, setShowAll] = useState(false);
  const [extra, setExtra] = useState<EditorLine[]>([]);
  const [staffId, setStaffId] = useState("");
  const [note, setNote] = useState("");
  const state = useInvSubmit("inv_create_stock_request", "inv-request-create", (data) => {
    const id = data?.request_id;
    if (id) push(`/inventory/requests/${String(id)}?branch=${branchId}`);
  });

  const visible = showAll ? rows : rows.filter((r) => r.suggestedBase > 0 || (qty[r.productId] ?? "") !== "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lines: Record<string, unknown>[] = [];
    for (const r of rows) {
      const raw = (qty[r.productId] ?? "").trim();
      if (raw === "") continue;
      const q = parseQty(raw);
      if (q === null) return state.setError("INVALID_QTY");
      lines.push({ product_id: r.productId, uom_id: r.purchaseUomId, qty: q });
    }
    for (const l of extra) {
      const q = parseQty(l.qty);
      if (q === null) return state.setError("INVALID_QTY");
      lines.push({ product_id: l.productId, uom_id: l.uomId, qty: q });
    }
    if (lines.length === 0) return state.setError("INVALID_QTY");
    state.submit({ branch_id: branchId, requested_by_staff: staffId, note: note || null, submit: true, lines });
  }

  return (
    <form className="space-y-4" onChangeCapture={state.touch} onSubmit={handleSubmit}>
      <div className={`${CARD_CLS} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-fg-secondary">
            {t("Suggested = max (Store + Floor) − on hand − approved but not yet delivered.")}
          </p>
          <label className="flex items-center gap-2 text-sm text-fg-secondary">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            {t("Show items that need no order")}
          </label>
        </div>
        {visible.length === 0 ? (
          <EmptyState text={t("Nothing needs ordering right now. Items without a max level are not suggested.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
                <tr>
                  <th className="px-2 py-2 font-medium">{t("Product")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("Max Store / Floor")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("On hand Store / Floor")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("Outstanding")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("Suggested")}</th>
                  <th className="w-36 px-2 py-2 font-medium">{t("Request qty")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {visible.map((r) => {
                  const entered = parseQty(qty[r.productId] ?? "");
                  return (
                    <tr key={r.productId}>
                      <td className="px-2 py-2 text-fg">
                        {r.name} <span className="text-xs text-fg-subtle">{r.sku}</span>
                      </td>
                      <td className="px-2 py-2 text-right text-fg-secondary">
                        {formatQty(r.maxStore) || "–"} / {formatQty(r.maxFloor) || "–"}
                      </td>
                      <td className="px-2 py-2 text-right text-fg-secondary">
                        {formatQty(r.onHandStore)} / {formatQty(r.onHandFloor)}
                      </td>
                      <td className="px-2 py-2 text-right text-fg-secondary">{formatQty(r.openQty)}</td>
                      <td className="px-2 py-2 text-right">
                        <span className="font-medium text-fg">
                          {formatQty(r.suggestedPurchase)} {r.purchaseUomCode}
                        </span>
                        <span className="block text-xs text-fg-subtle">
                          {formatQty(r.suggestedBase)} {r.baseUomCode}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <input
                            className={SMALL_INPUT_CLS}
                            inputMode="decimal"
                            aria-label={`${t("Request qty")} ${r.name}`}
                            value={qty[r.productId] ?? ""}
                            onChange={(e) => setQty({ ...qty, [r.productId]: e.target.value })}
                          />
                          <span className="text-xs text-fg-subtle">{r.purchaseUomCode}</span>
                        </div>
                        {entered !== null && r.purchaseFactor > 1 && (
                          <span className="text-xs text-fg-subtle">
                            = {formatQty(entered * r.purchaseFactor)} {r.baseUomCode}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={`${CARD_CLS} space-y-2`}>
        <h3 className="text-sm font-semibold text-fg">{t("Other items (scan barcode or type exact SKU)")}</h3>
        <LineEditor
          catalogue={catalogue}
          lines={extra}
          onChange={(next) => {
            state.touch();
            setExtra(next);
          }}
          defaultUom="purchase"
        />
      </div>

      <div className={`${CARD_CLS} grid gap-3 sm:grid-cols-2`}>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} seniorOnly label={t("Requested by")} />
        <Field label={t("Note for HQ")}>
          <input className={INPUT_CLS} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <FormStatus state={state} />
      <SubmitButton isPending={state.isPending} label={t("Create request")} />
    </form>
  );
}
