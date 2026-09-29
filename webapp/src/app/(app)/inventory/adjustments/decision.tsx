"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import type { InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { Field, FormStatus, INPUT_CLS, PRIMARY_BTN_CLS, SECONDARY_BTN_CLS, Spinner, StaffSelect } from "../components/form-bits";

/** Approve / reject (another login, MODERATOR+) or cancel (the requesting login). */
export function AdjustmentDecision({
  adjustmentId,
  staff,
  canApprove,
  canCancel,
}: {
  adjustmentId: number;
  staff: InvStaff[];
  canApprove: boolean;
  canCancel: boolean;
}) {
  const t = useTranslation();
  const [staffId, setStaffId] = useState("");
  const [note, setNote] = useState("");
  const state = useInvSubmit("inv_decide_adjustment", `inv-adjustment-decide-${adjustmentId}`);
  if (state.success) return <FormStatus state={state} />;

  const decide = (decision: "APPROVE" | "REJECT" | "CANCEL") =>
    state.submit({ adjustment_id: adjustmentId, decision, performed_by_staff: staffId, note: note || null });

  return (
    <div className="space-y-2 pt-1" onChangeCapture={state.touch}>
      <div className="grid gap-2 sm:grid-cols-2">
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} label={t("Decided by")} />
        <Field label={t("Note")}>
          <input className={INPUT_CLS} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <FormStatus state={state} />
      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <>
            <button type="button" className={PRIMARY_BTN_CLS} disabled={state.isPending} onClick={() => decide("APPROVE")}>
              {state.isPending && <Spinner />}
              {t("Approve and post")}
            </button>
            <button type="button" className={SECONDARY_BTN_CLS} disabled={state.isPending} onClick={() => decide("REJECT")}>
              {t("Reject")}
            </button>
          </>
        )}
        {canCancel && (
          <button type="button" className={SECONDARY_BTN_CLS} disabled={state.isPending} onClick={() => decide("CANCEL")}>
            {t("Cancel request")}
          </button>
        )}
      </div>
    </div>
  );
}
