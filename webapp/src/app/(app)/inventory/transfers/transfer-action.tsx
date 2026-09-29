"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { CANCEL_TRANSFER_REASON_OPTIONS, todayKL, type InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { Field, FormStatus, INPUT_CLS, StaffSelect, SubmitButton } from "../components/form-bits";

/** Receive (destination, everything, D-113) or cancel (source, Head-Nurse tier) a dispatched transfer. */
export function TransferAction({ kind, transferId, staff }: { kind: "receive" | "cancel"; transferId: number; staff: InvStaff[] }) {
  const t = useTranslation();
  const [staffId, setStaffId] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayKL());
  const state = useInvSubmit(
    kind === "receive" ? "inv_receive_branch_transfer" : "inv_cancel_branch_transfer",
    `inv-transfer-${kind}-${transferId}`
  );
  if (state.success) return <FormStatus state={state} />;

  return (
    <form
      className="grid items-end gap-2 sm:grid-cols-4"
      onChangeCapture={state.touch}
      onSubmit={(e) => {
        e.preventDefault();
        state.submit({
          transfer_id: transferId,
          txn_date: date,
          performed_by_staff: staffId,
          ...(kind === "cancel" ? { reason_code: reason || "OTHER" } : {}),
        });
      }}
    >
      <Field label={t("Date")} required>
        <input type="date" className={INPUT_CLS} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <StaffSelect staff={staff} value={staffId} onChange={setStaffId} seniorOnly={kind === "cancel"} />
      {kind === "cancel" && (
        <Field label={t("Reason")}>
          <select className={INPUT_CLS} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t("Select reason")}</option>
            {CANCEL_TRANSFER_REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div>
        <SubmitButton isPending={state.isPending} label={kind === "receive" ? t("Receive all") : t("Cancel transfer")} />
      </div>
      <div className="sm:col-span-4">
        <FormStatus state={state} />
      </div>
    </form>
  );
}
