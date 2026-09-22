"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewBehaviourChartForm } from "./new-behaviour-chart-form";
import { BehaviourTimeline } from "./behaviour-timeline";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { ListChecks, Plus, ChevronLeft } from "lucide-react";
import type { BehaviourEntry, BehaviourEpisode } from "./behaviour-chart-actions";

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
  episodes: BehaviourEpisode[];
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  currentPrev?: string; // previous range days (for back nav after drill-down)
  error: string | null;
};

function todayMYT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function daysAgoMYT(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

// Returns the number of days in the current range, or 0 for custom
function calcDays(start: string, end: string): number {
  if (!start || !end) return 7;
  const s = new Date(`${start}T12:00:00+08:00`);
  const e = new Date(`${end}T12:00:00+08:00`);
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

export function BehaviourChartModule({
  entries,
  episodes,
  residents,
  allStaff,
  currentResident,
  currentStart,
  currentEnd,
  currentPrev,
  error,
}: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(currentStart || daysAgoMYT(7));
  const [customTo, setCustomTo] = useState(currentEnd || todayMYT());

  const days = calcDays(currentStart, currentEnd);
  const isDayView = days === 1;
  const isCustom = !isDayView && days !== 7 && days !== 14 && days !== 30;
  const endDate = currentEnd || todayMYT();

  function applyFilters(residentId: string, start: string, end: string, extra?: Record<string, string>) {
    const params = new URLSearchParams();
    params.set("tab", "behaviour-chart");
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, v);
    push(`/clinical?${params.toString()}`);
  }

  function applyRange(n: 1 | 7 | 14 | 30) {
    const end = todayMYT();
    const start = n === 1 ? end : daysAgoMYT(n);
    setShowCustom(false);
    applyFilters(currentResident, start, end);
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    if (customTo < customFrom) return;
    setShowCustom(false);
    applyFilters(currentResident, customFrom, customTo);
  }

  function drillIntoDay(dateStr: string) {
    // Save current range as prev
    const params = new URLSearchParams();
    params.set("tab", "behaviour-chart");
    if (currentResident) params.set("resident", currentResident);
    params.set("start", dateStr);
    params.set("end", dateStr);
    params.set("prev", String(isDayView ? (currentPrev || "7") : days));
    push(`/clinical?${params.toString()}`);
  }

  function backFromDayView() {
    const prev = parseInt(currentPrev || "7");
    const n = ([7, 14, 30] as const).includes(prev as 7 | 14 | 30) ? (prev as 7 | 14 | 30) : 7;
    applyRange(n);
  }

  const rangeButtons: Array<{ n: 1 | 7 | 14 | 30; label: string }> = [
    { n: 1, label: t("Today") },
    { n: 7, label: "7 " + t("Days") },
    { n: 14, label: "14 " + t("Days") },
    { n: 30, label: "30 " + t("Days") },
  ];

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
        <div className="space-y-4">
          {/* Filters */}
          <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm space-y-3">
            {/* Resident picker */}
            <div>
              <label htmlFor="beh-resident-filter" className="mb-1 block text-sm font-medium text-gray-700">
                {t("Resident")}
              </label>
              <select
                id="beh-resident-filter"
                value={currentResident}
                onChange={(e) => applyFilters(e.target.value, currentStart || daysAgoMYT(7), currentEnd || todayMYT())}
                className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">{t("Select a resident")}</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>{r.resident_name}</option>
                ))}
              </select>
            </div>

            {/* Range buttons */}
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">{t("Range")}</p>
              <div className="flex flex-wrap gap-1">
                {rangeButtons.map(({ n, label }) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => applyRange(n)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      days === n && !isCustom && !showCustom
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-gray-300 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setShowCustom((v) => !v); setCustomFrom(currentStart || daysAgoMYT(7)); setCustomTo(currentEnd || todayMYT()); }}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    isCustom || showCustom
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
                  }`}
                >
                  {t("Custom")}
                </button>
              </div>
            </div>

            {/* Custom date pickers */}
            {showCustom && (
              <div className="flex flex-wrap items-end gap-3 pt-1">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t("From")}</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t("To")}</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={applyCustom}
                  disabled={!customFrom || !customTo || customTo < customFrom}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {t("Apply")}
                </button>
              </div>
            )}
          </div>

          {/* Back to range (after day drill-down) */}
          {isDayView && currentPrev && (
            <button
              type="button"
              onClick={backFromDayView}
              className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("Back to")} {currentPrev} {t("Days")}
            </button>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {!currentResident ? (
            <div className="rounded-md border border-dashed border-gray-300 p-8 text-center">
              <p className="text-sm text-gray-400">{t("Select a resident above to view the behaviour timeline.")}</p>
            </div>
          ) : episodes.length === 0 && entries.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
              {t("No behaviour episodes recorded in this period.")}
            </div>
          ) : (
            <>
              <BehaviourTimeline
                episodes={episodes}
                charts={entries}
                days={days}
                endDate={endDate}
                onDrillDown={drillIntoDay}
              />

              {/* Legacy summaries (entries with no timed episodes) */}
              {episodes.length === 0 && entries.length > 0 && (
                <div className="space-y-2 mt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t("Chart summaries (no timed episodes)")}
                  </p>
                  {entries.map((entry) => {
                    const enteredBy = entry.tbl_staff?.staff_name ?? entry.created_by_other ?? "--";
                    const distLabel =
                      entry.disturbance_level != null
                        ? `${entry.disturbance_level} – ${DISTURBANCE_LABELS[entry.disturbance_level]}`
                        : null;
                    return (
                      <div key={entry.id} className="rounded-md border border-gray-200 bg-white p-3 shadow-sm text-sm">
                        <div className="flex justify-between text-gray-500 text-xs mb-1">
                          <span>{formatDateTime(entry.entry_timestamp)}</span>
                          <span>{enteredBy}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-gray-700">
                          {entry.verbal_behavior && entry.verbal_behavior.length > 0 && (
                            <span>🗣️ {entry.verbal_behavior.join(", ")}</span>
                          )}
                          {entry.physical_behavior && entry.physical_behavior.length > 0 && (
                            <span>✋ {entry.physical_behavior.join(", ")}</span>
                          )}
                          {entry.emotion_mood && entry.emotion_mood.length > 0 && (
                            <span>😌 {entry.emotion_mood.join(", ")}</span>
                          )}
                          {distLabel && <span>🤯 {distLabel}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
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
