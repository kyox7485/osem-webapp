"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { REVERSE_REASON_OPTIONS, type InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { Field, FormStatus, INPUT_CLS, SECONDARY_BTN_CLS, StaffSelect, SubmitButton } from "../components/form-bits";

/** Reverse one transaction (MODERATOR/ADMIN). Opens an inline form. */
export function ReverseButton({ txnId, txnNo, staff }: { txnId: number; txnNo: string; staff: InvStaff[] }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const state = useInvSubmit("inv_reverse_txn", `inv-reverse-${txnId}`);
  const { guardedAction } = useSafeNavigation();

  if (!open) {
    return (
      <button type="button" className={SECONDARY_BTN_CLS} onClick={() => setOpen(true)}>
        {t("Reverse")}
      </button>
    );
  }
  if (state.success) return <FormStatus state={state} />;

  return (
    <form
      className="mt-2 w-full space-y-2 rounded-md border border-line bg-surface-muted p-3"
      onChangeCapture={state.touch}
      onSubmit={(e) => {
        e.preventDefault();
        state.submit({ txn_id: txnId, performed_by_staff: staffId, reason_code: reason, remarks: remarks || null });
      }}
    >
      <p className="text-sm font-medium text-fg">
        {t("Reverse")} {txnNo}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} />
        <Field label={t("Reason")} required>
          <select className={INPUT_CLS} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t("Select reason")}</option>
            {REVERSE_REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Remarks")}>
          <input className={INPUT_CLS} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
      <FormStatus state={state} />
      <div className="flex gap-2">
        <SubmitButton isPending={state.isPending} label={t("Reverse")} />
        <button type="button" className={SECONDARY_BTN_CLS} onClick={() => guardedAction(() => { state.discard(); setOpen(false); })} disabled={state.isPending}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
