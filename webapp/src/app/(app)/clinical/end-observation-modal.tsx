"use client";

import { useState, useTransition } from "react";
import { endObservation } from "./observation-status-actions";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import { useTranslation } from "@/components/language-provider";
import type { LookupOption } from "@/lib/types";

// Ending an observation: the reason plus who ended it. Shared by the Resident
// List's ObservationStatusButton and the Observation Chart review dashboard,
// so both record an end exactly the same way.

export const END_REASONS = ["Condition stable", "Observation completed", "Doctor reviewed", "Transferred to hospital"];
export const OTHER_REASON = "Other";

export function EndObservationModal({
  episodeId,
  staffOptions,
  onClose,
  onEnded,
}: {
  episodeId: number;
  staffOptions: (LookupOption & { branch_id: number; branch_function: string })[];
  onClose: () => void;
  /** Called after the episode is closed; typically a router.refresh(). */
  onEnded: () => void;
}) {
  const t = useTranslation();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [staffValue, setStaffValue] = useState("");
  const [staffOther, setStaffOther] = useState("");
  const [endReason, setEndReason] = useState("");
  const [endReasonOther, setEndReasonOther] = useState("");

  function handleEnd() {
    if (!staffValue || (staffValue === OTHERS_SENTINEL && !staffOther.trim())) {
      setError(t("Please select who is ending this observation"));
      return;
    }
    if (!endReason || (endReason === OTHER_REASON && !endReasonOther.trim())) {
      setError(t("Please select a reason"));
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await endObservation({
        episodeId,
        endedBy: staffValue === OTHERS_SENTINEL ? "" : staffValue,
        endedByOther: staffValue === OTHERS_SENTINEL ? staffOther.trim() : null,
        endReason: endReason === OTHER_REASON ? endReasonOther.trim() : endReason,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onEnded();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => { if (!isPending) onClose(); }}
    >
      <div className="bg-elevated rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 mb-4 sm:mb-0" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-fg">{t("End observation")}</h2>
        <p className="mt-1 text-sm text-fg-subtle">{t("Record why observation is ending.")}</p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">{t("Reason")}</label>
            <select
              value={endReason}
              onChange={(e) => setEndReason(e.target.value)}
              className="w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="" disabled>{t("Select reason")}</option>
              {END_REASONS.map((r) => (
                <option key={r} value={r}>{t(r)}</option>
              ))}
              <option value={OTHER_REASON}>{t("Other")}</option>
            </select>
            {endReason === OTHER_REASON && (
              <input
                type="text"
                value={endReasonOther}
                onChange={(e) => setEndReasonOther(e.target.value)}
                placeholder={t("Specify reason...")}
                className="mt-2 w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">{t("Ended by")}</label>
            <StaffPickerWithOther
              value={staffValue}
              otherName={staffOther}
              onValueChange={setStaffValue}
              onOtherNameChange={setStaffOther}
              staffOptions={staffOptions}
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-600 dark:text-red-300">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleEnd}
              disabled={isPending}
              className="flex-1 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {isPending ? t("Saving...") : t("Confirm end")}
            </button>
            <button
              type="button"
              onClick={() => { if (!isPending) onClose(); }}
              disabled={isPending}
              className="flex-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-fg-muted hover:bg-hover disabled:opacity-50 transition-colors"
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
