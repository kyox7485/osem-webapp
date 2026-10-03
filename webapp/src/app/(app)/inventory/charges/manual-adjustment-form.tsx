"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { formatMoney, parseSignedMoney, todayKL, type InvChargeLine, type InvResident, type InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, ResidentSelect, StaffSelect, SubmitButton } from "../components/form-bits";

/**
 * Management correction (D-75): a signed RM amount against a resident, dated in
 * an open month, optionally linked to one of the resident's charges.
 */
export function ManualAdjustmentForm({
  staff,
  residents,
  charges,
  month,
}: {
  staff: InvStaff[];
  residents: InvResident[];
  charges: InvChargeLine[];
  month: string;
}) {
  const t = useTranslation();
  const [residentId, setResidentId] = useState("");
  const [relatedId, setRelatedId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayKL());
  const [staffId, setStaffId] = useState("");
  const state = useInvSubmit("inv_manual_charge_adjustment", "inv-manual-adjustment", () => {
    setAmount("");
    setReason("");
    setRelatedId("");
  });
  const own = charges.filter((c) => String(c.residentId) === residentId && (c.kind === "ISSUE" || c.kind === "SERVICE"));
  const parsed = parseSignedMoney(amount);
  const valid = residentId !== "" && parsed !== null && reason.trim().length >= 5 && staffId !== "" && date !== "";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsed === null) return state.setError("INVALID_AMOUNT");
    state.submit({
      resident_id: Number(residentId),
      related_charge_id: relatedId ? Number(relatedId) : null,
      amount: parsed,
      reason: reason.trim(),
      charge_date: date,
      performed_by_staff: staffId,
    });
  }

  return (
    <form onSubmit={onSubmit} onChangeCapture={state.touch} className={`${CARD_CLS} space-y-3`}>
      <h2 className="text-sm font-semibold text-fg">{t("Manual adjustment")}</h2>
      <p className="text-xs text-fg-subtle">
        {t("A correction to a resident's charges, posted into an open month. Use a negative amount for a credit.")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <ResidentSelect
          residents={residents}
          value={residentId}
          onChange={(v) => {
            setResidentId(v);
            setRelatedId("");
          }}
          onTouch={state.touch}
        />
        <Field label={t("Related charge")} hint={`${t("Shown for the month")}: ${month}`}>
          <select className={INPUT_CLS} value={relatedId} onChange={(e) => setRelatedId(e.target.value)} disabled={residentId === ""}>
            <option value="">{t("None")}</option>
            {own.map((c) => (
              <option key={c.id} value={c.id}>
                {c.chargeDate} · {c.productName} · RM {formatMoney(c.effective ?? c.amount)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Amount (RM, negative for a credit)")} required>
          <input className={INPUT_CLS} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t("Date")} required>
          <input type="date" className={INPUT_CLS} max={todayKL()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("Reason")} required>
          <input className={INPUT_CLS} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} />
      </div>
      <FormStatus state={state} />
      <SubmitButton isPending={state.isPending} label={t("Post adjustment")} disabled={!valid} />
    </form>
  );
}
