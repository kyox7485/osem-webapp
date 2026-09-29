"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import type { InvCountLineView, InvStaff } from "@/lib/inventory/core";
import { useInvSubmit } from "../../components/use-inv-submit";
import { CARD_CLS, Field, FormStatus, INPUT_CLS, StaffSelect, SubmitButton } from "../../components/form-bits";
import { CancelCount } from "./cancel-count";
import { CountLinesTable } from "./count-lines-table";

/**
 * Review of a SUBMITTED count (COUNT_INVESTIGATE tier): expected, posted
 * since start, counted and variance per line, a note per variance line, a
 * summary, and a senior performer. Nothing posts here; with "request
 * adjustment" on, ONE PENDING adjustment with the variance deltas is created
 * for a moderator to approve (D-61, D-159).
 */
export function CountReview({
  countId,
  branchId,
  countedByStaff,
  lines,
  staff,
}: {
  countId: number;
  branchId: number;
  countedByStaff: string;
  lines: InvCountLineView[];
  staff: InvStaff[];
}) {
  const t = useTranslation();
  const varianceLines = lines.filter((l) => (l.variance ?? 0) !== 0);
  const [notes, setNotes] = useState<Record<number, string>>(() =>
    Object.fromEntries(varianceLines.map((l) => [l.id, l.note ?? ""]))
  );
  const [summary, setSummary] = useState("");
  const [staffId, setStaffId] = useState("");
  const [requestAdjustment, setRequestAdjustment] = useState(true);
  const state = useInvSubmit("inv_review_count", `inv-count-review-${countId}`);
  const summaryOk = varianceLines.length === 0 || summary.trim().length >= 5;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    state.submit({
      count_id: countId,
      performed_by_staff: staffId,
      summary: summary.trim() || null,
      notes: varianceLines.map((l) => ({ count_line_id: l.id, note: (notes[l.id] ?? "").trim() })),
      request_adjustment: requestAdjustment,
    });
  }

  return (
    <div className="space-y-4">
      <CountLinesTable
        lines={lines}
        showVariance
        notes={notes}
        onNote={(id, value) => {
          state.touch();
          setNotes((prev) => ({ ...prev, [id]: value }));
        }}
      />
      <form onSubmit={onSubmit} onChangeCapture={state.touch} className={`${CARD_CLS} space-y-3`}>
        <h2 className="text-sm font-semibold text-fg">{t("Review")}</h2>
        {varianceLines.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("No variance. Closing the count creates no adjustment.")}</p>
        ) : (
          <p className="text-sm text-fg-secondary">
            {varianceLines.length} {t("lines differ from the book quantity.")}
          </p>
        )}
        <Field label={t("Investigation summary")} required={varianceLines.length > 0}>
          <textarea
            className={INPUT_CLS}
            rows={3}
            maxLength={2000}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <StaffSelect staff={staff} value={staffId} onChange={setStaffId} seniorOnly label={t("Reviewed by")} />
        {staffId !== "" && staffId === countedByStaff && (
          <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            {t("The same person counted and is reviewing this count.")}
          </p>
        )}
        {varianceLines.length > 0 && (
          <label className="flex items-start gap-2 text-sm text-fg-secondary">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={requestAdjustment}
              onChange={(e) => setRequestAdjustment(e.target.checked)}
            />
            <span>
              {t("Request adjustment for variances")}
              <span className="block text-xs text-fg-subtle">
                {t("Creates one pending adjustment with the variance of each line. A moderator approves it before stock changes.")}
              </span>
            </span>
          </label>
        )}
        <FormStatus state={state} />
        <SubmitButton isPending={state.isPending} label={t("Close count")} disabled={!staffId || !summaryOk} />
      </form>
      <CancelCount countId={countId} branchId={branchId} submitted staff={staff} />
    </div>
  );
}
