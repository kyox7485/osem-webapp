"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import type { InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { Field, FormStatus, INPUT_CLS, SECONDARY_BTN_CLS, StaffSelect, SubmitButton } from "../components/form-bits";

const PRICE_RE = /^\d{1,6}(\.\d{1,4})?$/;

/** Moderator prices a PRICE_PENDING line (D-121): one PRICING child, once. */
export function PriceForm({ chargeId, staff, onClose }: { chargeId: number; staff: InvStaff[]; onClose: () => void }) {
  const t = useTranslation();
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [staffId, setStaffId] = useState("");
  const state = useInvSubmit("inv_price_charge", `inv-price-${chargeId}`, onClose);
  const valid = PRICE_RE.test(price.trim()) && reason.trim().length >= 5 && staffId !== "";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    state.submit({
      charge_id: chargeId,
      unit_charge_price: Number(price),
      reason: reason.trim(),
      performed_by_staff: staffId,
    });
  }

  return (
    <form onSubmit={onSubmit} onChangeCapture={state.touch} className="space-y-3 rounded-md border border-line bg-surface-muted p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("Unit price (RM per base unit)")} required>
          <input className={INPUT_CLS} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label={t("Reason")} required>
          <input className={INPUT_CLS} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} />
      </div>
      <FormStatus state={state} />
      <div className="flex gap-2">
        <SubmitButton isPending={state.isPending} label={t("Set price")} disabled={!valid} />
        <button type="button" className={SECONDARY_BTN_CLS} onClick={onClose} disabled={state.isPending}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

/** Reverses a service charge (stock charges are reversed with their transaction). */
export function ReverseChargeForm({ chargeId, staff, onClose }: { chargeId: number; staff: InvStaff[]; onClose: () => void }) {
  const t = useTranslation();
  const [reason, setReason] = useState("");
  const [staffId, setStaffId] = useState("");
  const state = useInvSubmit("inv_reverse_charge", `inv-reverse-charge-${chargeId}`, onClose);
  const valid = reason.trim().length >= 5 && staffId !== "";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    state.submit({ charge_id: chargeId, reason: reason.trim(), performed_by_staff: staffId });
  }

  return (
    <form onSubmit={onSubmit} onChangeCapture={state.touch} className="space-y-3 rounded-md border border-line bg-surface-muted p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Reason")} required>
          <input className={INPUT_CLS} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} />
      </div>
      <p className="text-xs text-fg-subtle">{t("The reversal is dated today, in the open month.")}</p>
      <FormStatus state={state} />
      <div className="flex gap-2">
        <SubmitButton isPending={state.isPending} label={t("Reverse charge")} disabled={!valid} />
        <button type="button" className={SECONDARY_BTN_CLS} onClick={onClose} disabled={state.isPending}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
