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
import { AdminRecordControls } from "@/components/admin-record-controls";

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
};

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  entries: NursingChartEntry[];
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  lookups: ClinicalLookups;
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

const TAG_GROUPS: [keyof NursingChartEntry, string][] = [
  ["elimination_labels", "Diaper checks"],
  ["activity_labels", "Activity"],
  ["disturbance_level_labels", "Disturbance level"],
  ["psycho_social_labels", "Psycho-social behaviour"],
  ["active_complaint_labels", "Active complaint"],
  ["meal_labels", "Meals"],
  ["hygiene_labels", "Hygiene care"],
];

export function NursingChartModule({ entries, residents, allStaff, lookups, currentResident, currentStart, currentEnd, error }: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function applyFilters(residentId: string, start: string, end: string) {
    const params = new URLSearchParams();
    params.set("tab", "nursing-chart");
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
          <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="resident-filter" className="mb-1 block text-sm font-medium text-fg-secondary">
                  {t("Resident")}
                </label>
                <select
                  id="resident-filter"
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                <label htmlFor="start-date" className="mb-1 block text-sm font-medium text-fg-secondary">
                  {t("Start date")}
                </label>
                <input
                  type="date"
                  id="start-date"
                  value={currentStart}
                  onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="end-date" className="mb-1 block text-sm font-medium text-fg-secondary">
                  {t("End date")}
                </label>
                <input
                  type="date"
                  id="end-date"
                  value={currentEnd}
                  onChange={(e) => applyFilters(currentResident, currentStart, e.target.value)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

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
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          className={`text-fg-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        >
                          <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>

                    {!isExpanded && (
                      <p className="text-sm text-fg-secondary">
                        {tagGroups.length > 0 ? (
                          <span className="text-fg-faint">
                            {tagGroups.length} {t(tagGroups.length > 1 ? "areas" : "area")} {t("recorded -- click to view")}
                          </span>
                        ) : (
                          <span className="text-fg-faint">{t("Click to view")}</span>
                        )}
                      </p>
                    )}

                    {isExpanded && (
                      <div className="mt-3 space-y-2 border-t border-line-subtle pt-3">
                        {entry.tube_feeding && (
                          <p className="text-sm text-fg-muted">
                            <span className="font-medium text-fg-subtle">{t("Tube feeding")}: </span>
                            {entry.tube_feeding}
                          </p>
                        )}
                        {tagGroups.map(([key, label]) => (
                          <p key={key} className="text-sm text-fg-muted">
                            <span className="font-medium text-fg-subtle">{t(label)}: </span>
                            {(entry[key] as string[]).join(key === "elimination_labels" ? " | " : ", ")}
                          </p>
                        ))}
                        {(entry.fluid_input !== null || entry.fluid_output !== null) && (
                          <p className="text-sm text-fg-muted">
                            <span className="font-medium text-fg-subtle">{t("Fluid I/O")}: </span>
                            {entry.fluid_input ?? "--"} / {entry.fluid_output ?? "--"} {t("ml")}
                          </p>
                        )}
                        {entry.cbd_drainage && (
                          <p className="text-sm text-fg-muted">
                            <span className="font-medium text-fg-subtle">{t("CBD drainage")}: </span>
                            {entry.cbd_drainage}
                          </p>
                        )}
                        {entry.intervention && (
                          <p className="text-sm text-fg-muted">
                            <span className="font-medium text-fg-subtle">{t("Intervention")}: </span>
                            {entry.intervention}
                          </p>
                        )}
                        {entry.doctors_plan && (
                          <p className="text-sm text-fg-muted">
                            <span className="font-medium text-fg-subtle">{t("Doctor's plan")}: </span>
                            {entry.doctors_plan}
                          </p>
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
