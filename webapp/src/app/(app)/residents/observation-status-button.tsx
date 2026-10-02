"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startObservation } from "../clinical/observation-status-actions";
import { EndObservationModal } from "../clinical/end-observation-modal";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import { useTranslation } from "@/components/language-provider";
import type { LookupOption } from "@/lib/types";

type Props = {
  residentId: number;
  activeEpisodeId: number | null;
  staffOptions: (LookupOption & { branch_id: number; branch_function: string })[];
  residentBranchId: number;
};

export function ObservationStatusButton({ residentId, activeEpisodeId, staffOptions, residentBranchId }: Props) {
  const t = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [staffValue, setStaffValue] = useState("");
  const [staffOther, setStaffOther] = useState("");

  const branchStaff = staffOptions.filter((s) => s.branch_id === residentBranchId || s.branch_function === 'HQ');
  const isUnderObservation = activeEpisodeId != null;

  function openModal(e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    setStaffValue("");
    setStaffOther("");
    setOpen(true);
  }

  function closeModal(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!isPending) setOpen(false);
  }

  function openEndModal(e: React.MouseEvent) {
    e.stopPropagation();
    setShowEnd(true);
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

  return (
    <>
      <div className="flex items-center gap-2">
        {isUnderObservation && (
          <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">{t("Under Observation")}</span>
        )}
        {isUnderObservation ? (
          <button
            type="button"
            onClick={openEndModal}
            className="rounded-full bg-surface-strong px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-red-100 dark:hover:bg-red-950/40 hover:text-red-800 dark:hover:text-red-300"
          >
            {t("End Observation")}
          </button>
        ) : (
          <button
            type="button"
            onClick={openModal}
            className="rounded-full bg-surface-strong px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-950/40 hover:text-indigo-800 dark:hover:text-indigo-300"
          >
            {t("Start Observation")}
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div className="bg-elevated rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 mb-4 sm:mb-0" onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>
      )}

      {showEnd && activeEpisodeId != null && (
        <EndObservationModal
          episodeId={activeEpisodeId}
          staffOptions={branchStaff}
          onClose={() => setShowEnd(false)}
          onEnded={() => {
            setShowEnd(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
