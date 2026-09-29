"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { formatQty, parseQty, toPurchaseQty, type InvStaff, type InvSupplier } from "@/lib/inventory/core";
import { useInvSubmit } from "../../components/use-inv-submit";
import {
  CARD_CLS,
  Field,
  FormStatus,
  INPUT_CLS,
  PRIMARY_BTN_CLS,
  SECONDARY_BTN_CLS,
  SMALL_INPUT_CLS,
  Spinner,
  StaffSelect,
} from "../../components/form-bits";

export type RequestLineView = {
  id: number;
  name: string;
  sku: string;
  baseCode: string;
  purchaseCode: string;
  factor: number;
  requested: number;
  approved: number | null;
  received: number;
  outstanding: number;
  closedShort: boolean;
  closedReason: string | null;
  supplier: string | null;
  remarks: string | null;
};

const OPEN = ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"];

/** Which panels a login sees; the RPCs re-check every rule (tier, branch, other login, status). */
export function RequestActions({
  requestId,
  status,
  lines,
  staff,
  suppliers,
  canReview,
  canAct,
}: {
  requestId: number;
  status: string;
  lines: RequestLineView[];
  staff: InvStaff[];
  suppliers: InvSupplier[];
  canReview: boolean;
  canAct: boolean;
}) {
  return (
    <div className="space-y-4">
      {canReview && status === "SUBMITTED" && <ReviewPanel requestId={requestId} lines={lines} staff={staff} />}
      {canReview && status === "APPROVED" && (
        <OrderPanel requestId={requestId} staff={staff} suppliers={suppliers.filter((s) => s.isActive)} />
      )}
      {canAct && ["DRAFT", "SUBMITTED", ...OPEN].includes(status) && (
        <BranchPanel requestId={requestId} status={status} lines={lines} staff={staff} />
      )}
    </div>
  );
}

/** HQ review: approve (per-line quantity, base units; 0 refuses a line) or reject. */
function ReviewPanel({ requestId, lines, staff }: { requestId: number; lines: RequestLineView[]; staff: InvStaff[] }) {
  const t = useTranslation();
  const [qty, setQty] = useState<Record<number, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.requested)]))
  );
  const [staffId, setStaffId] = useState("");
  const [note, setNote] = useState("");
  const state = useInvSubmit("inv_decide_stock_request", `inv-request-review-${requestId}`);
  if (state.success) return <FormStatus state={state} />;

  function decide(decision: "APPROVE" | "REJECT") {
    const approvals = [];
    if (decision === "APPROVE") {
      for (const l of lines) {
        const raw = (qty[l.id] ?? "").trim();
        const q = raw === "0" ? 0 : parseQty(raw);
        if (q === null) return state.setError("INVALID_QTY");
        approvals.push({ line_id: l.id, approved_qty: q });
      }
    }
    state.submit({ request_id: requestId, decision, performed_by_staff: staffId, note: note || null, approvals });
  }

  return (
    <section className={`${CARD_CLS} space-y-3`} onChangeCapture={state.touch}>
      <h3 className="text-sm font-semibold text-fg">{t("HQ review")}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-subtle">
            <tr>
              <th className="px-2 py-1 font-medium">{t("Product")}</th>
              <th className="px-2 py-1 text-right font-medium">{t("Requested")}</th>
              <th className="w-44 px-2 py-1 font-medium">{t("Approve qty (base unit)")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {lines.map((l) => {
              const q = parseQty(qty[l.id] ?? "");
              return (
                <tr key={l.id}>
                  <td className="px-2 py-1 text-fg">{l.name}</td>
                  <td className="px-2 py-1 text-right text-fg-secondary">
                    {formatQty(l.requested)} {l.baseCode}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <input
                        className={SMALL_INPUT_CLS}
                        inputMode="decimal"
                        aria-label={`${t("Approve qty (base unit)")} ${l.name}`}
                        value={qty[l.id] ?? ""}
                        onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                      />
                      <span className="text-xs text-fg-subtle">{l.baseCode}</span>
                    </div>
                    {q !== null && l.factor > 1 && (
                      <span className="text-xs text-fg-subtle">
                        = {formatQty(toPurchaseQty(q, l.factor))} {l.purchaseCode}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-subtle">{t("Enter 0 to refuse a line.")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} label={t("Reviewed by")} />
        <Field label={t("Note")}>
          <input className={INPUT_CLS} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <FormStatus state={state} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY_BTN_CLS} disabled={state.isPending} onClick={() => decide("APPROVE")}>
          {state.isPending && <Spinner />}
          {t("Approve")}
        </button>
        <button type="button" className={SECONDARY_BTN_CLS} disabled={state.isPending} onClick={() => decide("REJECT")}>
          {t("Reject")}
        </button>
      </div>
    </section>
  );
}

/** HQ records that the order was placed outside the app (Bukku). Free-text reference. */
function OrderPanel({ requestId, staff, suppliers }: { requestId: number; staff: InvStaff[]; suppliers: InvSupplier[] }) {
  const t = useTranslation();
  const [staffId, setStaffId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [ref, setRef] = useState("");
  const [eta, setEta] = useState("");
  const [note, setNote] = useState("");
  const state = useInvSubmit("inv_stock_request_action", `inv-request-order-${requestId}`);
  if (state.success) return <FormStatus state={state} />;

  return (
    <section className={`${CARD_CLS} space-y-3`} onChangeCapture={state.touch}>
      <h3 className="text-sm font-semibold text-fg">{t("Mark as ordered")}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t("Supplier")}>
          <select className={INPUT_CLS} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t("Keep line suppliers")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Order reference (e.g. Bukku PO no.)")}>
          <input className={INPUT_CLS} maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field label={t("Expected delivery")}>
          <input type="date" className={INPUT_CLS} value={eta} onChange={(e) => setEta(e.target.value)} />
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} label={t("Ordered by")} />
        <Field label={t("Note")}>
          <input className={INPUT_CLS} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <FormStatus state={state} />
      <button
        type="button"
        className={PRIMARY_BTN_CLS}
        disabled={state.isPending}
        onClick={() =>
          state.submit({
            request_id: requestId,
            action: "MARK_ORDERED",
            performed_by_staff: staffId,
            supplier_id: supplierId ? Number(supplierId) : null,
            external_ref: ref || null,
            expected_delivery_date: eta || null,
            note: note || null,
          })
        }
      >
        {state.isPending && <Spinner />}
        {t("Mark as ordered")}
      </button>
    </section>
  );
}

/** Branch Head-Nurse tier: submit / cancel, delivery follow-up, close a line short, close the request. */
function BranchPanel({
  requestId,
  status,
  lines,
  staff,
}: {
  requestId: number;
  status: string;
  lines: RequestLineView[];
  staff: InvStaff[];
}) {
  const t = useTranslation();
  const [staffId, setStaffId] = useState("");
  const [note, setNote] = useState("");
  const [eta, setEta] = useState("");
  const [lineId, setLineId] = useState("");
  const state = useInvSubmit("inv_stock_request_action", `inv-request-branch-${requestId}`);
  if (state.success) return <FormStatus state={state} />;

  const open = OPEN.includes(status);
  const openLines = lines.filter((l) => !l.closedShort && l.outstanding > 0);
  const run = (action: string, extra: Record<string, unknown> = {}) =>
    state.submit({ request_id: requestId, action, performed_by_staff: staffId, note: note || null, ...extra });

  return (
    <section className={`${CARD_CLS} space-y-3`} onChangeCapture={state.touch}>
      <h3 className="text-sm font-semibold text-fg">{open ? t("Delivery follow-up") : t("Request")}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} seniorOnly />
        <Field label={t("Note")} hint={open ? t("Required for follow-up and closing") : undefined}>
          <input className={INPUT_CLS} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {open && (
          <Field label={t("Expected delivery")}>
            <input type="date" className={INPUT_CLS} value={eta} onChange={(e) => setEta(e.target.value)} />
          </Field>
        )}
        {open && openLines.length > 0 && (
          <Field label={t("Line to close short")}>
            <select className={INPUT_CLS} value={lineId} onChange={(e) => setLineId(e.target.value)}>
              <option value="">{t("Select line")}</option>
              {openLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({formatQty(l.outstanding)} {l.baseCode})
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <FormStatus state={state} />
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && (
          <button type="button" className={PRIMARY_BTN_CLS} disabled={state.isPending} onClick={() => run("SUBMIT")}>
            {state.isPending && <Spinner />}
            {t("Submit to HQ")}
          </button>
        )}
        {open && (
          <button
            type="button"
            className={PRIMARY_BTN_CLS}
            disabled={state.isPending}
            onClick={() => run("FOLLOW_UP", { expected_delivery_date: eta || null })}
          >
            {state.isPending && <Spinner />}
            {t("Save follow-up")}
          </button>
        )}
        {open && openLines.length > 0 && (
          <button
            type="button"
            className={SECONDARY_BTN_CLS}
            disabled={state.isPending || !lineId}
            onClick={() => run("CLOSE_LINE", { line_id: Number(lineId) })}
          >
            {t("Close line short")}
          </button>
        )}
        {open && (
          <button type="button" className={SECONDARY_BTN_CLS} disabled={state.isPending} onClick={() => run("CLOSE")}>
            {t("Close request")}
          </button>
        )}
        {["DRAFT", "SUBMITTED", "APPROVED"].includes(status) && (
          <button type="button" className={SECONDARY_BTN_CLS} disabled={state.isPending} onClick={() => run("CANCEL")}>
            {t("Cancel request")}
          </button>
        )}
      </div>
    </section>
  );
}
