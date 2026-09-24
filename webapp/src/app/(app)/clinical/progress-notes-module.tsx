"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewProgressNoteForm } from "./new-progress-note-form";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ListChecks, Plus } from "lucide-react";
import { PdfDownloadLink } from "@/components/pdf-download-link";

type ProgressNote = {
  id: number;
  resident_id: number;
  entry_timestamp: string;
  progress_note: string | null;
  physical_examination: string | null;
  medical_plan: string | null;
  nursing_plan: string | null;
  feeding_plan: string | null;
  monitoring_plan: string | null;
  dressing_plan: string | null;
  physio_plan: string | null;
  reviewed_by: string | null;
  reviewed_by_other: string | null;
  created_by: string | null;
  created_by_other: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  reviewer: { StaffID: string; staff_name: string } | null;
  author: { StaffID: string; staff_name: string } | null;
};

type Resident = {
  id: number;
  resident_name: string;
  branch_id: number;
};

type Props = {
  notes: ProgressNote[];
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

const PLAN_LABELS: [keyof ProgressNote, string][] = [
  ["physical_examination", "Physical examination"],
  ["medical_plan", "Medical / treatment plan"],
  ["nursing_plan", "Nursing plan"],
  ["feeding_plan", "Feeding / diet plan"],
  ["dressing_plan", "Dressing plan"],
  ["monitoring_plan", "Monitoring plan"],
  ["physio_plan", "Physio plan"],
];

export function ProgressNotesModule({
  notes,
  residents,
  allStaff,
  currentResident,
  currentStart,
  currentEnd,
  error,
}: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function applyFilters(residentId: string, start: string, end: string) {
    const params = new URLSearchParams();
    params.set("tab", "progress-notes");
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <TabRow>
        <TabButton icon={ListChecks} size="sm" active={innerTab === "review"} onClick={() => guardedAction(() => setInnerTab("review"))}>
          {t("Review Notes")}
        </TabButton>
        <TabButton icon={Plus} size="sm" active={innerTab === "new"} onClick={() => setInnerTab("new")}>
          {t("New Entry")}
        </TabButton>
      </TabRow>

      {innerTab === "review" ? (
        <>
          {/* Filters */}
          <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="resident-filter" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("Resident")}
                </label>
                <select
                  id="resident-filter"
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">{t("All residents")}</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.resident_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="start-date" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("Start date")}
                </label>
                <input
                  type="date"
                  id="start-date"
                  value={currentStart}
                  onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="end-date" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("End date")}
                </label>
                <input
                  type="date"
                  id="end-date"
                  value={currentEnd}
                  onChange={(e) => applyFilters(currentResident, currentStart, e.target.value)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Notes List */}
          <div className="space-y-3">
            {notes.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-400 dark:text-gray-500">
                {t("No progress notes yet.")}
              </div>
            ) : (
              notes.map((note) => {
                const isExpanded = expandedId === note.id;
                const details = PLAN_LABELS.filter(([key]) => note[key]);
                const recordedCount = (note.progress_note ? 1 : 0) + details.length;
                return (
                  <div
                    key={note.id}
                    onClick={() => setExpandedId(isExpanded ? null : note.id)}
                    className="cursor-pointer rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm transition-colors hover:border-indigo-200"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-bold text-gray-900 dark:text-gray-100">{note.tbl_residents?.resident_name}</span>
                      <span className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                        {formatDateTime(note.entry_timestamp)}
                        <PdfDownloadLink href={`/api/reports/progress-note?id=${note.id}`} />
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          className={`text-gray-400 dark:text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        >
                          <path
                            d="M6 3.5L10.5 8L6 12.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </div>
                    {!isExpanded && (
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        {recordedCount > 0 ? (
                          <span className="text-gray-400 dark:text-gray-500">
                            {recordedCount} {t(recordedCount > 1 ? "fields" : "field")} {t("recorded -- click to view")}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">{t("Click to view")}</span>
                        )}
                      </p>
                    )}

                    {isExpanded && (
                      <div className="mt-3 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
                        {note.progress_note && (
                          <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-500 dark:text-gray-400">{t("Progress note")}: </span>
                            {note.progress_note}
                          </p>
                        )}
                        {details.map(([key, label]) => (
                          <p key={key} className="text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-500 dark:text-gray-400">{t(label)}: </span>
                            {note[key] as string}
                          </p>
                        ))}
                        {recordedCount === 0 && <p className="text-sm text-gray-400 dark:text-gray-500">{t("No fields recorded.")}</p>}
                      </div>
                    )}

                    <div className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                      {t("Reviewed by")}: {note.reviewer?.staff_name || note.reviewed_by_other || note.author?.staff_name || note.created_by_other || "--"}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        <NewProgressNoteForm
          residents={residents}
          allStaff={allStaff}
          presetResidentId={currentResident || undefined}
          onSaved={() => {
            setInnerTab("review");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
