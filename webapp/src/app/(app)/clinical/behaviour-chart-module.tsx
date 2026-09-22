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
import { ListChecks, Plus } from "lucide-react";
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
  error: string | null;
};

const RANGE_DAYS = [7, 14, 30] as const;

function todayMYT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function daysAgoMYT(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

export function BehaviourChartModule({
  entries,
  episodes,
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
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");

  // Derive the current range (7/14/30) from the URL start/end, defaulting to 7
  function activeDays(): 7 | 14 | 30 {
    if (!currentStart || !currentEnd) return 7;
    const start = new Date(`${currentStart}T12:00:00+08:00`);
    const end = new Date(`${currentEnd}T12:00:00+08:00`);
    const diff = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (diff >= 28) return 30;
    if (diff >= 13) return 14;
    return 7;
  }

  const days = activeDays();
  const endDate = currentEnd || todayMYT();

  function applyFilters(residentId: string, start: string, end: string) {
    const params = new URLSearchParams();
    params.set("tab", "behaviour-chart");
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  function applyRange(n: 7 | 14 | 30) {
    const end = todayMYT();
    const start = daysAgoMYT(n);
    applyFilters(currentResident, start, end);
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
        <div className="space-y-4">
          {/* Filters */}
          <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[180px]">
                <label htmlFor="beh-resident-filter" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("Resident")}
                </label>
                <select
                  id="beh-resident-filter"
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart || daysAgoMYT(days), currentEnd || todayMYT())}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">{t("Select a resident")}</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>{r.resident_name}</option>
                  ))}
                </select>
              </div>

              {/* Range preset buttons */}
              <div>
                <p className="mb-1 text-sm font-medium text-gray-700">{t("Range")}</p>
                <div className="flex gap-1">
                  {RANGE_DAYS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => applyRange(n)}
                      className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        days === n && currentResident
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-gray-300 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
                      }`}
                    >
                      {n} {t("Days")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {!currentResident ? (
            <div className="rounded-md border border-dashed border-gray-300 p-8 text-center">
              <p className="text-sm text-gray-400">{t("Select a resident above to view the behaviour timeline.")}</p>
            </div>
          ) : (
            <>
              {/* Disturbance level sidebar for current date range */}
              {days > 7 && entries.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {entries.slice(0, 7).map((e) => {
                    const lvl = e.disturbance_level;
                    return lvl != null ? (
                      <span key={e.id} className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-600">
                        {formatDateTime(e.entry_timestamp).split(",")[0]}: L{lvl} – {DISTURBANCE_LABELS[lvl]}
                      </span>
                    ) : null;
                  })}
                </div>
              )}

              {episodes.length === 0 && entries.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
                  {t("No behaviour episodes recorded in this period.")}
                </div>
              ) : (
                <BehaviourTimeline
                  episodes={episodes}
                  charts={entries}
                  days={days}
                  endDate={endDate}
                />
              )}

              {/* Legacy chart entries that have no timed episodes (summary only) */}
              {episodes.length === 0 && entries.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mt-2">
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
