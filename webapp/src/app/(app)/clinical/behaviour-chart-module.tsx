"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewBehaviourChartForm } from "./new-behaviour-chart-form";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { ListChecks, Plus } from "lucide-react";
import type { BehaviourEntry } from "./behaviour-chart-actions";

const DISTURBANCE_LABELS: Record<number, string> = {
  0: "No disturb",
  1: "Occasionally sound",
  2: "Frequent sound (others can sleep)",
  3: "Frequent sound (others can't sleep)",
  4: "Persistent sound (disturbing activity)",
};

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  entries: BehaviourEntry[];
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

const val = (v: string | number | null | undefined) => (v != null && v !== "" ? String(v) : "--");
const arr = (v: string[] | null) => (v && v.length > 0 ? v.join(", ") : "--");

export function BehaviourChartModule({ entries, residents, allStaff, currentResident, currentStart, currentEnd, error }: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function applyFilters(residentId: string, start: string, end: string) {
    const params = new URLSearchParams();
    params.set("tab", "behaviour-chart");
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <TabRow>
        <TabButton icon={ListChecks} size="sm" active={innerTab === "review"} onClick={() => setInnerTab("review")}>
          {t("Review Notes")}
        </TabButton>
        <TabButton icon={Plus} size="sm" active={innerTab === "new"} onClick={() => setInnerTab("new")}>
          {t("New Entry")}
        </TabButton>
      </TabRow>

      {innerTab === "review" ? (
        <>
          {/* Filters */}
          <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="beh-resident-filter" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("Resident")}
                </label>
                <select
                  id="beh-resident-filter"
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">{t("All residents")}</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>{r.resident_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="beh-start-date" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("Start date")}
                </label>
                <input
                  type="date"
                  id="beh-start-date"
                  value={currentStart}
                  onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label htmlFor="beh-end-date" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("End date")}
                </label>
                <input
                  type="date"
                  id="beh-end-date"
                  value={currentEnd}
                  onChange={(e) => applyFilters(currentResident, currentStart, e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="space-y-3">
            {entries.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
                {t("No behaviour chart entries yet.")}
              </div>
            ) : (
              entries.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const enteredBy = entry.tbl_staff?.staff_name ?? entry.created_by_other ?? "--";
                const residentName = entry.tbl_residents?.resident_name ?? "--";
                const distLabel =
                  entry.disturbance_level != null
                    ? `${entry.disturbance_level} – ${DISTURBANCE_LABELS[entry.disturbance_level]}`
                    : "--";

                const sleepLine =
                  entry.sleep_from && entry.sleep_to
                    ? `${entry.sleep_from} – ${entry.sleep_to}`
                    : entry.sleep_from ?? entry.sleep_to ?? "--";

                return (
                  <div
                    key={entry.id}
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="cursor-pointer rounded-md border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-200"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-bold text-gray-900">{residentName}</span>
                      <span className="flex items-center gap-2 text-xs text-gray-400">
                        {formatDateTime(entry.entry_timestamp)}
                        <svg
                          width="14" height="14" viewBox="0 0 16 16" fill="none"
                          className={`text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        >
                          <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>

                    {/* Summary line */}
                    {!isExpanded && (
                      <p className="text-sm text-gray-500">
                        {arr(entry.verbal_behavior)} · {arr(entry.physical_behavior)}
                        {entry.disturbance_level != null && ` · Disturbance: ${entry.disturbance_level}`}
                      </p>
                    )}

                    {isExpanded && (
                      <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">🗣️ {t("Verbal Behavior")}</p>
                          <p className="text-sm text-gray-700">{arr(entry.verbal_behavior)}</p>
                          {entry.complaints && (
                            <p className="mt-1 text-sm text-gray-700">
                              <span className="text-gray-400">💬 {t("Complaints")}: </span>{entry.complaints}
                            </p>
                          )}
                        </div>

                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">✋ {t("Physical Behavior")}</p>
                          <p className="text-sm text-gray-700">{arr(entry.physical_behavior)}</p>
                        </div>

                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">🛌 {t("Rest & Restraint")}</p>
                          <div className="text-sm text-gray-700 space-y-0.5">
                            <p><span className="text-gray-400">{t("Sleep")}: </span>{val(sleepLine)}</p>
                            <p><span className="text-gray-400">{t("Restraint")}: </span>{arr(entry.restraint)}</p>
                          </div>
                        </div>

                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">😌 {t("Emotion / Mood")}</p>
                          <p className="text-sm text-gray-700">{arr(entry.emotion_mood)}</p>
                        </div>

                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">🤯 {t("Level of Disturbance")}</p>
                          <p className="text-sm text-gray-700">{distLabel}</p>
                        </div>
                      </div>
                    )}

                    <div className="mt-2 text-xs text-gray-400">{t("Entered by")}: {enteredBy}</div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        <NewBehaviourChartForm
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
