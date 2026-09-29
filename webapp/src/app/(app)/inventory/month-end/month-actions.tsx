"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { INV_TIER, type InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../components/use-inv-submit";
import { CARD_CLS, ErrorNotice, Field, INPUT_CLS, PRIMARY_BTN_CLS, SECONDARY_BTN_CLS, Spinner, StaffSelect, SubmitButton } from "../components/form-bits";

function CodeLine({ code }: { code: string | null }) {
  const t = useTranslation();
  if (!code) return null;
  return (
    <p className="text-xs text-fg-subtle">
      {t("Code")}: <span className="font-mono">{code}</span>
    </p>
  );
}

/**
 * Month-end steps for one month: mark the exceptions reviewed (moderator),
 * lock (moderator), reopen (administrator, with a reason). The rejection code
 * is shown next to its message so a blocked lock is easy to report.
 */
export function MonthActions({
  branchId,
  periodMonth,
  status,
  isReviewed,
  monthEnded,
  blockingCount,
  rank,
  staff,
}: {
  branchId: number;
  periodMonth: string; // YYYY-MM-01
  status: "OPEN" | "LOCKED";
  isReviewed: boolean;
  monthEnded: boolean;
  blockingCount: number;
  rank: number;
  staff: InvStaff[];
}) {
  const t = useTranslation();
  const [staffId, setStaffId] = useState("");
  const [reason, setReason] = useState("");
  const base = { branch_id: branchId, period_month: periodMonth, performed_by_staff: staffId };
  const review = useInvSubmit("inv_mark_exceptions_reviewed", "inv-month-review");
  const lock = useInvSubmit("inv_lock_period", "inv-month-lock");
  const reopen = useInvSubmit("inv_reopen_period", "inv-month-reopen", () => setReason(""));

  const canReview = rank >= INV_TIER.EXCEPTIONS_REVIEW && status === "OPEN";
  const canLock = rank >= INV_TIER.PERIOD_LOCK && status === "OPEN";
  const canReopen = rank >= INV_TIER.PERIOD_REOPEN && status === "LOCKED";
  if (!canReview && !canLock && !canReopen) return null;

  return (
    <section className={`${CARD_CLS} space-y-4`}>
      <h2 className="text-sm font-semibold text-fg">{t("Close the month")}</h2>
      <div className="max-w-sm">
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} />
      </div>
      {status === "OPEN" && !monthEnded && <p className="text-sm text-amber-700 dark:text-amber-300">{t("The month has not ended yet.")}</p>}
      {status === "OPEN" && blockingCount > 0 && (
        <p className="text-sm text-red-700 dark:text-red-300">
          {blockingCount} {t("blocking items must be cleared before the month can be locked.")}
        </p>
      )}
      {canReview && (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">
            {isReviewed ? t("Exceptions reviewed. Review again if more was posted since.") : t("Step 1. Read the exceptions above, then mark them reviewed.")}
          </p>
          <button
            type="button"
            className={SECONDARY_BTN_CLS}
            disabled={review.isPending || !staffId || !monthEnded}
            onClick={() => review.submit(base)}
          >
            {review.isPending && <Spinner />}
            {t("Mark exceptions reviewed")}
          </button>
          <ErrorNotice code={review.error} />
          <CodeLine code={review.error} />
          {review.success && <p className="text-sm text-emerald-700 dark:text-emerald-300">{t("Saved.")}</p>}
        </div>
      )}
      {canLock && (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">{t("Step 2. Lock the month. Nothing can be dated in a locked month afterwards.")}</p>
          <button
            type="button"
            className={PRIMARY_BTN_CLS}
            disabled={lock.isPending || !staffId || !monthEnded}
            onClick={() => lock.submit(base)}
          >
            {lock.isPending && <Spinner />}
            {t("Lock month")}
          </button>
          <ErrorNotice code={lock.error} />
          <CodeLine code={lock.error} />
          {lock.success && <p className="text-sm text-emerald-700 dark:text-emerald-300">{t("The month is locked.")}</p>}
        </div>
      )}
      {canReopen && (
        <form
          className="space-y-2"
          onChangeCapture={reopen.touch}
          onSubmit={(e) => {
            e.preventDefault();
            reopen.submit({ ...base, reason: reason.trim() });
          }}
        >
          <p className="text-sm text-fg-secondary">{t("Reopen the latest locked month to post a late correction. A reason is required.")}</p>
          <div className="max-w-xl">
            <Field label={t("Reason")} required>
              <input className={INPUT_CLS} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <ErrorNotice code={reopen.error} />
          <CodeLine code={reopen.error} />
          <SubmitButton isPending={reopen.isPending} label={t("Reopen month")} disabled={!staffId || reason.trim().length < 5} />
        </form>
      )}
    </section>
  );
}
