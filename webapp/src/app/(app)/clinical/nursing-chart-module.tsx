"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewNursingChartForm } from "./new-nursing-chart-form";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import type { ClinicalLookups } from "@/lib/lookups";

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
      <div className="flex gap-1 border-b border-gray-200">
        <InnerTabButton active={innerTab === "review"} onClick={() => setInnerTab("review")}>
          Review Notes
        </InnerTabButton>
        <InnerTabButton active={innerTab === "new"} onClick={() => setInnerTab("new")}>
          New Entry
        </InnerTabButton>
      </div>

      {innerTab === "review" ? (
        <>
          <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="resident-filter" className="mb-1 block text-sm font-medium text-gray-700">
                  Resident
                </label>
                <select
                  id="resident-filter"
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">All residents</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.resident_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="start-date" className="mb-1 block text-sm font-medium text-gray-700">
                  Start date
                </label>
                <input
                  type="date"
                  id="start-date"
                  value={currentStart}
                  onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="end-date" className="mb-1 block text-sm font-medium text-gray-700">
                  End date
                </label>
                <input
                  type="date"
                  id="end-date"
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
                No nursing chart entries yet.
              </div>
            ) : (
              entries.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const tagGroups = TAG_GROUPS.filter(([key]) => (entry[key] as string[]).length > 0);
                return (
                  <div
                    key={entry.id}
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="cursor-pointer rounded-md border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-200"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-bold text-gray-900">{entry.resident_name}</span>
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

                    {!isExpanded && (
                      <p className="text-sm text-gray-700">
                        {tagGroups.length > 0 ? (
                          <span className="text-gray-400">{tagGroups.length} area{tagGroups.length > 1 ? "s" : ""} recorded -- click to view</span>
                        ) : (
                          <span className="text-gray-400">Click to view</span>
                        )}
                      </p>
                    )}

                    {isExpanded && (
                      <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                        {entry.tube_feeding && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium text-gray-500">Tube feeding: </span>
                            {entry.tube_feeding}
                          </p>
                        )}
                        {tagGroups.map(([key, label]) => (
                          <p key={key} className="text-sm text-gray-600">
                            <span className="font-medium text-gray-500">{label}: </span>
                            {(entry[key] as string[]).join(key === "elimination_labels" ? " | " : ", ")}
                          </p>
                        ))}
                        {(entry.fluid_input !== null || entry.fluid_output !== null) && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium text-gray-500">Fluid I/O: </span>
                            {entry.fluid_input ?? "--"} / {entry.fluid_output ?? "--"} ml
                          </p>
                        )}
                        {entry.cbd_drainage && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium text-gray-500">CBD drainage: </span>
                            {entry.cbd_drainage}
                          </p>
                        )}
                        {entry.intervention && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium text-gray-500">Intervention: </span>
                            {entry.intervention}
                          </p>
                        )}
                        {entry.doctors_plan && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium text-gray-500">Doctor&apos;s plan: </span>
                            {entry.doctors_plan}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-2 text-xs text-gray-400">Entered by: {entry.entered_by_name}</div>
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

function InnerTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800"
      }`}
    >
      {children}
    </button>
  );
}
