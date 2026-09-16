"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewProgressNoteForm } from "./new-progress-note-form";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";

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
  created_by: string | null;
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
          {/* Filters */}
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

          {/* Error */}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Notes List */}
          <div className="space-y-3">
            {notes.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
                No progress notes yet.
              </div>
            ) : (
              notes.map((note) => {
                const isExpanded = expandedId === note.id;
                const details = PLAN_LABELS.filter(([key]) => note[key]);
                return (
                  <div
                    key={note.id}
                    onClick={() => setExpandedId(isExpanded ? null : note.id)}
                    className="cursor-pointer rounded-md border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-200"
                  >
                    <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
                      <span>{formatDateTime(note.entry_timestamp)}</span>
                      <span className="flex items-center gap-2">
                        {note.tbl_residents?.resident_name}
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          className={`text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
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
                    <p className="whitespace-pre-wrap text-sm text-gray-800">{note.progress_note}</p>

                    {!isExpanded && details.length > 0 && (
                      <p className="mt-2 text-xs text-gray-400">
                        {details.length} more field{details.length > 1 ? "s" : ""} recorded -- click to view
                      </p>
                    )}

                    {isExpanded && (
                      <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                        {details.length === 0 ? (
                          <p className="text-sm text-gray-400">No additional plan fields recorded.</p>
                        ) : (
                          details.map(([key, label]) => (
                            <p key={key} className="text-sm text-gray-600">
                              <span className="font-medium text-gray-500">{label}: </span>
                              {note[key] as string}
                            </p>
                          ))
                        )}
                      </div>
                    )}

                    <div className="mt-2 text-xs text-gray-400">
                      Created by: {note.author?.staff_name || "--"}
                      {note.reviewer && <span> · Reviewed by: {note.reviewer.staff_name}</span>}
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
