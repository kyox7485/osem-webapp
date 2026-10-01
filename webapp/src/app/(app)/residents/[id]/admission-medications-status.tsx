"use client";

// Resident page card for the admission-medication background queue. Starts
// (or resumes) the app-wide runner when anything is still open, then shows
// its live progress. Hidden once every row is done, unless it finished
// during this visit (so the nurse sees the confirmation).

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { useAdmissionMedicationRunner } from "@/components/admission-medication-runner";
import { hasOpenItems, type AdmissionMedQueueItem } from "@/lib/admission-medication-queue-types";

// A row another tab claimed (or one whose request died) isn't ours to drive;
// re-ask periodically so stale claims get reclaimed and progress shows.
const RESUME_POLL_MS = 30_000;

export function AdmissionMedicationsStatus({
  residentId,
  residentName,
  initialItems,
}: {
  residentId: number;
  residentName: string;
  initialItems: AdmissionMedQueueItem[];
}) {
  const t = useTranslation();
  const runner = useAdmissionMedicationRunner();
  const items = runner?.itemsFor(residentId) ?? initialItems;
  const open = hasOpenItems(items);
  const driving = runner?.isDriving(residentId) ?? false;
  const [wasOpen] = useState(() => hasOpenItems(initialItems) || initialItems.some((i) => i.status === "failed"));
  const [retrying, setRetrying] = useState<number | null>(null);

  const startedRef = useRef(false);
  useEffect(() => {
    if (!runner || startedRef.current || !hasOpenItems(initialItems)) return;
    startedRef.current = true;
    runner.watch(residentId, residentName, initialItems);
  }, [runner, residentId, residentName, initialItems]);

  useEffect(() => {
    if (!runner || !open || driving) return;
    const timer = setInterval(() => runner.watch(residentId, residentName), RESUME_POLL_MS);
    return () => clearInterval(timer);
  }, [runner, open, driving, residentId, residentName]);

  if (items.length === 0) return null;
  const failed = items.filter((i) => i.status === "failed").length;
  if (!open && failed === 0 && !wasOpen) return null;

  const tone = open
    ? "border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40"
    : failed > 0
      ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
      : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40";

  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 ${tone}`}>
      <p className="text-sm font-medium text-fg">{t("Admission medications")}</p>
      <p className="mt-0.5 text-xs text-fg-subtle">
        {open
          ? t("Saving to Medication Orders in the background. You can keep working; this updates by itself.")
          : failed > 0
            ? t("Some medications could not be saved. Press Retry, or add them in Medication Orders.")
            : t("All admission medications saved.")}
      </p>
      <ul className="mt-2 divide-y divide-line-subtle">
        {items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 py-1.5 text-sm">
            <div className="min-w-0">
              <p className="truncate text-fg">{item.label}</p>
              {item.stockStatus !== "not_needed" && (
                <p className="text-xs text-fg-subtle">
                  {t("Initial stock")}: {t(stockLabel(item))}
                </p>
              )}
              {item.status === "failed" && item.lastError && (
                <p className="text-xs text-red-600 dark:text-red-400">{item.lastError}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusChip item={item} t={t} />
              {item.status === "failed" && runner && (
                <button
                  type="button"
                  disabled={retrying === item.id}
                  onClick={async () => {
                    setRetrying(item.id);
                    await runner.retry(item.id, residentId, residentName);
                    setRetrying(null);
                  }}
                  className="rounded-md border border-line-strong bg-surface px-2 py-0.5 text-xs font-medium text-fg hover:bg-app disabled:opacity-50"
                >
                  {t("Retry")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function stockLabel(item: AdmissionMedQueueItem): string {
  switch (item.stockStatus) {
    case "done":
      return "Saved";
    case "failed":
      return "Failed";
    default:
      return "Waiting";
  }
}

function StatusChip({ item, t }: { item: AdmissionMedQueueItem; t: (s: string) => string }) {
  const map = {
    pending: ["Waiting", "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"],
    processing: ["Saving...", "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300"],
    done: ["Saved", "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"],
    failed: ["Failed", "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"],
  } as const;
  const [label, cls] = map[item.status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{t(label)}</span>;
}
