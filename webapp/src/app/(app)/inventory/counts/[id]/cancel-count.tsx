"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { useNavPush } from "@/components/nav-loading";
import type { InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../../components/use-inv-submit";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, SECONDARY_BTN_CLS, StaffSelect, SubmitButton } from "../../components/form-bits";

/**
 * Cancel a count. Nothing was posted, so it only frees the location and keeps
 * the reason. A SUBMITTED count needs a senior performer (COUNT_INVESTIGATE tier).
 */
export function CancelCount({
  countId,
  branchId,
  submitted,
  staff,
}: {
  countId: number;
  branchId: number;
  submitted: boolean;
  staff: InvStaff[];
}) {
  const t = useTranslation();
  const push = useNavPush();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [staffId, setStaffId] = useState("");
  const state = useInvSubmit("inv_cancel_count", `inv-count-cancel-${countId}`, () =>
    push(`/inventory/counts?branch=${branchId}`)
  );

  if (!open) {
    return (
      <button type="button" className={SECONDARY_BTN_CLS} onClick={() => setOpen(true)}>
        {t("Cancel this count")}
      </button>
    );
  }
  return (
    <form
      className={`${CARD_CLS} space-y-3`}
      onChangeCapture={state.touch}
      onSubmit={(e) => {
        e.preventDefault();
        state.submit({ count_id: countId, reason, performed_by_staff: submitted ? staffId : staffId || null });
      }}
    >
      <h3 className="text-sm font-semibold text-fg">{t("Cancel this count")}</h3>
      <Field label={t("Reason")} required>
        <input className={INPUT_CLS} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {submitted && <StaffSelect staff={staff} value={staffId} onChange={setStaffId} seniorOnly />}
      <FormStatus state={state} />
      <div className="flex gap-2">
        <SubmitButton
          isPending={state.isPending}
          label={t("Cancel this count")}
          disabled={reason.trim().length < 5 || (submitted && !staffId)}
        />
        <button type="button" className={SECONDARY_BTN_CLS} disabled={state.isPending} onClick={() => setOpen(false)}>
          {t("Keep counting")}
        </button>
      </div>
    </form>
  );
}
