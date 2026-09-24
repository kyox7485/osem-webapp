"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startObservation, endObservation } from "../clinical/observation-status-actions";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import { useTranslation } from "@/components/language-provider";
import type { LookupOption } from "@/lib/types";

const END_REASONS = ["Condition stable", "Observation completed", "Doctor reviewed", "Transferred to hospital"];
const OTHER_REASON = "Other";

type Props = {
  residentId: number;
  activeEpisodeId: number | null;
  staffOptions: (LookupOption & { branch_id: number })[];
  residentBranchId: number;
};

export function ObservationStatusButton({ residentId, activeEpisodeId, staffOptions, residentBranchId }: Props) {
  const t = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [staffValue, setStaffValue] = useState("");
  const [staffOther, setStaffOther] = useState("");
  const [endReason, setEndReason] = useState("");
  const [endReasonOther, setEndReasonOther] = useState("");

  const branchStaff = staffOptions.filter((s) => s.branch_id === residentBranchId);
  const isUnderObservation = activeEpisodeId != null;

  function openModal(e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    setStaffValue("");
    setStaffOther("");
    setEndReason("");
    setEndReasonOther("");
    setOpen(true);
  }

  function closeModal(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!isPending) setOpen(false);
  }

  function handleStart() {
    if (!staffValue || (staffValue === OTHERS_SENTINEL && !staffOther.trim())) {
      setError(t("Please select who is starting this observation"));
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await startObservation({
        residentId,
        startedBy: staffValue === OTHERS_SENTINEL ? "" : staffValue,
        startedByOther: staffValue === OTHERS_SENTINEL ? staffOther.trim() : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function handleEnd() {
    if (!staffValue || (staffValue === OTHERS_SENTINEL && !staffOther.trim())) {
      setError(t("Please select who is ending this observation"));
      return;
    }
    if (!endReason || (endReason === OTHER_REASON && !endReasonOther.trim())) {
      setError(t("Please select a reason"));
      return;
    }
    if (activeEpisodeId == null) return;
    startTransition(async () => {
      setError(null);
      const result = await endObservation({
        episodeId: activeEpisodeId,
        endedBy: staffValue === OTHERS_SENTINEL ? "" : staffValue,
        endedByOther: staffValue === OTHERS_SENTINEL ? staffOther.trim() : null,
        endReason: endReason === OTHER_REASON ? endReasonOther.trim() : endReason,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {isUnderObservation && (
          <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">{t("Under Observation")}</span>
        )}
        <button
          type="button"
          onClick={openModal}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            isUnderObservation ? "bg-surface-strong text-fg-muted hover:bg-red-100 dark:hover:bg-red-950/40 hover:text-red-800 dark:hover:text-red-300" : "bg-surface-strong text-fg-muted hover:bg-indigo-100 dark:hover:bg-indigo-950/40 hover:text-indigo-800 dark:hover:text-indigo-300"
          }`}
        >
          {isUnderObservation ? t("End Observation") : t("Start Observation")}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div className="bg-elevated rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 mb-4 sm:mb-0" onClick={(e) => e.stopPropagation()}>
            {isUnderObservation ? (
              <>
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
                      staffOptions={branchStaff}
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
                      onClick={closeModal}
                      disabled={isPending}
                      className="flex-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-fg-muted hover:bg-hover disabled:opacity-50 transition-colors"
                    >
                      {t("Cancel")}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-fg">{t("Start observation")}</h2>
                <p className="mt-1 text-sm text-fg-subtle">{t("This resident will appear in the Observation Chart until observation ends.")}</p>

                <div className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-fg-muted mb-1">{t("Started by")}</label>
                    <StaffPickerWithOther
                      value={staffValue}
                      otherName={staffOther}
                      onValueChange={setStaffValue}
                      onOtherNameChange={setStaffOther}
                      staffOptions={branchStaff}
                    />
                  </div>

                  {error && <p className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-600 dark:text-red-300">{error}</p>}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleStart}
                      disabled={isPending}
                      className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {isPending ? t("Saving...") : t("Confirm start")}
                    </button>
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={isPending}
                      className="flex-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-fg-muted hover:bg-hover disabled:opacity-50 transition-colors"
                    >
                      {t("Cancel")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
