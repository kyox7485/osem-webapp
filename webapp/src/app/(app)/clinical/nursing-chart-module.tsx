"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewNursingChartForm } from "./new-nursing-chart-form";
import { useNavPush } from "@/components/nav-loading";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import type { LookupOption } from "@/lib/types";
import type { ClinicalLookups } from "@/lib/lookups";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { ListChecks, Plus } from "lucide-react";
import { PdfDownloadLink } from "@/components/pdf-download-link";
import { AdminRecordControls, useIsHqAdmin } from "@/components/admin-record-controls";
import { ResultNotice } from "./result-notice";
import { BranchFilterSelect } from "./branch-filter-select";
import {
  NursingFluidTrend,
  NursingMealMatrix,
  NursingEliminationMatrix,
  NursingHygieneMatrix,
  NursingConditionMatrix,
  NursingTimeline,
  OverviewSection,
} from "./nursing-overview";

export type RawMeal = {
  meal_type_id: number | null;
  meal_type_other: string | null;
  meal_portion_id: number | null;
  meal_portion_other: string | null;
  feeding_time_id: number | null;
  feeding_volume: string | null;
  aspirate_amount: number | null;
};

export type RawHygieneEpisode = {
  assistance_level: string;
  activity_ids: number[];
};

export type RawEliminationEpisode = {
  bowel_output_ids: number[] | null;
  pass_urine_id: number | null;
};

export type NursingChartEntry = {
  id: number;
  resident_id: number;
  entry_timestamp: string;
  tube_feeding: string | null;
  fluid_input: number | null;
  fluid_output: number | null;
  cbd_drainage: string | null;
  intervention: string | null;
  doctors_plan: string | null;
  elimination_labels: string[];
  activity_labels: string[];
  disturbance_level_labels: string[];
  psycho_social_labels: string[];
  active_complaint_labels: string[];
  meal_labels: string[];
  hygiene_labels: string[];
  resident_name: string;
  entered_by_name: string;
  raw_meals: RawMeal[];
  raw_hygiene: RawHygieneEpisode[];
  raw_elimination: RawEliminationEpisode[];
  activity_ids: number[] | null;
  disturbance_level_ids: number[] | null;
  psycho_social_behaviour_ids: number[] | null;
  active_complaint_ids: number[] | null;
};

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  entries: NursingChartEntry[];
  residents: Resident[];
  branches: LookupOption[];
  currentBranch: string;
  allStaff: (LookupOption & { branch_id: number; branch_function: string })[];
  lookups: ClinicalLookups;
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
  /** The server hit its row cap -- the list below is the most recent N, not all. */
  truncated?: boolean;
  /** False blocks entry creation for plain-STAFF logins in the other
   * department (see canCreateClinicalEntry in lib/current-user.ts). View
   * access to existing entries is never affected. */
  canCreateEntry?: boolean;
};

function todayMYT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function daysAgoMYT(n: number): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  d.setDate(d.getDate() - (n - 1));
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function calcDays(start: string, end: string): number {
  if (!start || !end) return 7;
  const s = new Date(`${start}T12:00:00+08:00`);
  const e = new Date(`${end}T12:00:00+08:00`);
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

const DURATION_PRESETS: { n: 1 | 3 | 7 | 14 | 30; labelKey: string }[] = [
  { n: 1, labelKey: "Today" },
  { n: 3, labelKey: "3 Days" },
  { n: 7, labelKey: "7 Days" },
  { n: 14, labelKey: "14 Days" },
  { n: 30, labelKey: "30 Days" },
];

const TAG_GROUPS: [keyof NursingChartEntry, string][] = [
  ["elimination_labels", "Diaper checks"],
  ["activity_labels", "Activity"],
  ["disturbance_level_labels", "Disturbance level"],
  ["psycho_social_labels", "Psycho-social behaviour"],
  ["active_complaint_labels", "Active complaint"],
  ["meal_labels", "Meals"],
  ["hygiene_labels", "Hygiene care"],
];

export function NursingChartModule({ entries, residents, branches, currentBranch, allStaff, lookups, currentResident, currentStart, currentEnd, error, truncated, canCreateEntry = true }: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const isHqAdmin = useIsHqAdmin();
  const { guardedAction } = useSafeNavigation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(currentStart || daysAgoMYT(7));
  const [customTo, setCustomTo] = useState(currentEnd || todayMYT());

  const days = calcDays(currentStart, currentEnd);
  const isCustom = ![1, 3, 7, 14, 30].includes(days);

  function applyFilters(residentId: string, start: string, end: string, branchId: string) {
    const params = new URLSearchParams();
    params.set("tab", "nursing-chart");
    if (branchId) params.set("branch", branchId);
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  function applyPreset(n: 1 | 3 | 7 | 14 | 30) {
    const end = todayMYT();
    const start = n === 1 ? end : daysAgoMYT(n);
    setShowCustom(false);
    applyFilters(currentResident, start, end, currentBranch);
  }

  function applyCustom() {
    if (!customFrom || !customTo || customTo < customFrom) return;
    setShowCustom(false);
    applyFilters(currentResident, customFrom, customTo, currentBranch);
  }

  const residentSelected = !!currentResident;

  return (
    <div className="space-y-4">
      <TabRow>
        <TabButton icon={ListChecks} size="sm" active={innerTab === "review"} onClick={() => guardedAction(() => setInnerTab("review"))}>
          {t("Review Notes")}
        </TabButton>
        {canCreateEntry && (
          <TabButton icon={Plus} size="sm" active={innerTab === "new"} onClick={() => guardedAction(() => setInnerTab("new"))}>
          {t("New Entry")}
        </TabButton>
        )}

      </TabRow>

      {innerTab === "review" ? (
        <>
          {/* ── Filter bar ───────────────────────────────────────────────── */}
          <div className="rounded-md border border-line bg-surface p-4 shadow-sm space-y-3">
            <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${isHqAdmin ? "lg:grid-cols-3" : ""}`}>
              <BranchFilterSelect
                branches={branches}
                currentBranch={currentBranch}
                onChange={(branchId) => applyFilters("", currentStart, currentEnd, branchId)}
                id="nc-branch-filter"
              />
              <div>
                <label htmlFor="nc-resident-filter" className="mb-1 block text-sm font-medium text-fg-secondary">
                  {t("Resident")}
                </label>
                <select
                  id="nc-resident-filter"
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd, currentBranch)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">{t("All residents")}</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>{r.resident_name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Duration presets — shown for all views */}
            <div>
              <p className="mb-1 text-sm font-medium text-fg-secondary">{t("Range")}</p>
              <div className="flex flex-wrap gap-1">
                {DURATION_PRESETS.map(({ n, labelKey }) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => applyPreset(n)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                      days === n && !isCustom && !showCustom
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-line-strong bg-surface text-fg-secondary hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-300"
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setShowCustom((v) => !v); setCustomFrom(currentStart || daysAgoMYT(7)); setCustomTo(currentEnd || todayMYT()); }}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                    isCustom || showCustom
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-line-strong bg-surface text-fg-secondary hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-300"
                  }`}
                >
                  {t("Custom")}
                </button>
              </div>
            </div>

            {showCustom && (
              <div className="flex flex-wrap items-end gap-3 pt-1">
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-muted">{t("From")}</label>
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className="rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-muted">{t("To")}</label>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className="rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
                <button type="button" onClick={applyCustom} disabled={!customFrom || !customTo || customTo < customFrom}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {t("Apply")}
                </button>
              </div>
            )}
          </div>

          <ResultNotice error={error} truncated={truncated} />

          {/* ── Resident selected → Nursing Overview ─────────────────────── */}
          {residentSelected ? (
            entries.length === 0 ? (
              <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-fg-faint">
                {t("No nursing chart entries yet.")}
              </div>
            ) : (
              <div className="space-y-4">
                <OverviewSection title={t("Fluid Balance Trend")}>
                  <NursingFluidTrend entries={entries} t={t} />
                </OverviewSection>

                <OverviewSection title={t("Meals")}>
                  <NursingMealMatrix entries={entries} lookups={lookups} t={t} />
                </OverviewSection>

                <OverviewSection title={t("Elimination")}>
                  <NursingEliminationMatrix entries={entries} lookups={lookups} t={t} />
                </OverviewSection>

                <OverviewSection title={t("Hygiene / ADL")}>
                  <NursingHygieneMatrix entries={entries} lookups={lookups} t={t} />
                </OverviewSection>

                <OverviewSection title={t("Activity & behaviour")}>
                  <NursingConditionMatrix entries={entries} lookups={lookups} t={t} />
                </OverviewSection>

                <OverviewSection title={t("Nursing Timeline")}>
                  <NursingTimeline entries={entries} t={t} />
                </OverviewSection>
              </div>
            )
          ) : (
            /* ── No resident selected → lightweight card list ──────────── */
            <div className="space-y-3">
              {entries.length === 0 ? (
                <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-fg-faint">
                  {t("No nursing chart entries yet.")}
                </div>
              ) : (
                entries.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  const tagGroups = TAG_GROUPS.filter(([key]) => (entry[key] as string[]).length > 0);
                  return (
                    <div
                      key={entry.id}
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="cursor-pointer rounded-md border border-line bg-surface p-4 shadow-sm transition-colors hover:border-indigo-200 dark:hover:border-indigo-700"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-bold text-fg">{entry.resident_name}</span>
                        <span className="flex items-center gap-2 text-xs text-fg-faint">
                          {formatDateTime(entry.entry_timestamp)}
                          <PdfDownloadLink href={`/api/reports/nursing-chart?id=${entry.id}`} />
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`text-fg-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </div>

                      {!isExpanded && (
                        <p className="text-sm text-fg-secondary">
                          {tagGroups.length > 0
                            ? <span className="text-fg-faint">{tagGroups.length} {t(tagGroups.length > 1 ? "areas" : "area")} {t("recorded -- click to view")}</span>
                            : <span className="text-fg-faint">{t("Click to view")}</span>}
                        </p>
                      )}

                      {isExpanded && (
                        <div className="mt-3 space-y-2 border-t border-line-subtle pt-3">
                          {entry.tube_feeding && (
                            <p className="text-sm text-fg-muted"><span className="font-medium text-fg-subtle">{t("Tube feeding")}: </span>{entry.tube_feeding}</p>
                          )}
                          {tagGroups.map(([key, label]) => (
                            <p key={key} className="text-sm text-fg-muted">
                              <span className="font-medium text-fg-subtle">{t(label)}: </span>
                              {(entry[key] as string[]).join(key === "elimination_labels" ? " | " : ", ")}
                            </p>
                          ))}
                          {(entry.fluid_input !== null || entry.fluid_output !== null) && (
                            <p className="text-sm text-fg-muted"><span className="font-medium text-fg-subtle">{t("Fluid I/O")}: </span>{entry.fluid_input ?? "--"} / {entry.fluid_output ?? "--"} {t("ml")}</p>
                          )}
                          {entry.cbd_drainage && (
                            <p className="text-sm text-fg-muted"><span className="font-medium text-fg-subtle">{t("CBD drainage")}: </span>{entry.cbd_drainage}</p>
                          )}
                          {entry.intervention && (
                            <p className="text-sm text-fg-muted"><span className="font-medium text-fg-subtle">{t("Intervention")}: </span>{entry.intervention}</p>
                          )}
                          {entry.doctors_plan && (
                            <p className="text-sm text-fg-muted"><span className="font-medium text-fg-subtle">{t("Doctor's plan")}: </span>{entry.doctors_plan}</p>
                          )}
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-fg-faint">{t("Entered by")}: {entry.entered_by_name}</span>
                        <AdminRecordControls kind="nursing_chart" id={entry.id} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      ) : (
        <NewNursingChartForm
          residents={residents}
          allStaff={allStaff}
          lookups={lookups}
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
