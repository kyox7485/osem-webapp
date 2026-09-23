"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewObservationChartForm } from "./new-observation-chart-form";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ListChecks, Plus } from "lucide-react";
import type { ObservationEntry } from "./observation-chart-actions";

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  entries: ObservationEntry[];
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

const yesNo = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "--");
const val = (v: string | number | null | undefined) => (v != null && v !== "" ? String(v) : "--");

export function ObservationChartModule({ entries, residents, allStaff, currentResident, currentStart, currentEnd, error }: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function applyFilters(residentId: string, start: string, end: string) {
    const params = new URLSearchParams();
    params.set("tab", "observation-chart");
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
        <TabButton icon={Plus} size="sm" active={innerTab === "new"} onClick={() => guardedAction(() => setInnerTab("new"))}>
          {t("New Entry")}
        </TabButton>
      </TabRow>

      {innerTab === "review" ? (
        <>
          <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="obs-resident-filter" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("Resident")}
                </label>
                <select
                  id="obs-resident-filter"
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                <label htmlFor="obs-start-date" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("Start date")}
                </label>
                <input
                  type="date"
                  id="obs-start-date"
                  value={currentStart}
                  onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="obs-end-date" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("End date")}
                </label>
                <input
                  type="date"
                  id="obs-end-date"
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
                {t("No observation chart entries yet.")}
              </div>
            ) : (
              entries.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const enteredBy = entry.tbl_staff?.staff_name ?? entry.created_by_other ?? "--";
                const residentName = entry.tbl_residents?.resident_name ?? "--";

                const behaviorLine = [
                  ...(entry.behavior ?? []),
                  ...(entry.behavior_other ? [`Others: ${entry.behavior_other}`] : []),
                ].join(", ") || "--";

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
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          className={`text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        >
                          <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>

                    {entry.active_issue && (
                      <p className="mb-1 text-sm font-medium text-amber-700">⚠️ {entry.active_issue}</p>
                    )}

                    {!isExpanded && (
                      <p className="text-sm text-gray-400">{t("Click to view details")}</p>
                    )}

                    {isExpanded && (
                      <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{t("Nursing Assessment")}</p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-700 sm:grid-cols-3">
                            <span><span className="text-gray-400">🫁 SOB/Cough: </span>{yesNo(entry.sob_cough)}</span>
                            <span><span className="text-gray-400">⚡ Pain: </span>{yesNo(entry.pain)}{entry.pain && entry.pain_location ? ` — ${entry.pain_location}` : ""}</span>
                            <span><span className="text-gray-400">🤕 Wound: </span>{val(entry.wound)}</span>
                            <span><span className="text-gray-400">🥣 Appetite: </span>{val(entry.appetite)}</span>
                            <span><span className="text-gray-400">🤮 Vomiting: </span>{yesNo(entry.vomiting)}</span>
                            <span><span className="text-gray-400">💩 Diarrhea: </span>{yesNo(entry.diarrhea)}</span>
                            <span><span className="text-gray-400">💧 Urine: </span>{val(entry.urine)}</span>
                            <span className="col-span-2 sm:col-span-3"><span className="text-gray-400">🧠 Behavior: </span>{behaviorLine}</span>
                          </div>
                        </div>

                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{t("Vital Signs")}</p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-700 sm:grid-cols-3">
                            <span><span className="text-gray-400">BP: </span>{val(entry.systolic_bp)}/{val(entry.diastolic_bp)} mmHg</span>
                            <span><span className="text-gray-400">HR: </span>{val(entry.heart_rate)} bpm</span>
                            <span><span className="text-gray-400">Temp: </span>{val(entry.temperature)}°C</span>
                            <span><span className="text-gray-400">SpO₂: </span>{val(entry.spo2)}%{entry.spo2_condition ? ` (${entry.spo2_condition})` : ""}</span>
                            {entry.dxt != null && <span><span className="text-gray-400">DXT: </span>{entry.dxt} mmol/L</span>}
                            <span><span className="text-gray-400">AVPU: </span>{val(entry.avpu)}</span>
                          </div>
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
        <NewObservationChartForm
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
