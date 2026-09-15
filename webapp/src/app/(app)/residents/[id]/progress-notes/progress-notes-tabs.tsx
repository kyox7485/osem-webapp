"use client";

import { useState } from "react";
import { ResidentDashboard } from "./resident-dashboard";
import { NewNoteForm } from "./new-note-form";
import type { LookupOption } from "@/lib/types";

type Note = {
  id: number;
  entry_timestamp: string;
  progress_note: string | null;
  medical_plan: string | null;
  nursing_plan: string | null;
  authorName: string;
};

type Vital = {
  entry_timestamp: string;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  spo2_condition: string | null;
};

type PlanEntry = { entry_timestamp: string; value: string } | null;

type Props = {
  residentId: number;
  staffOptions: LookupOption[];
  notes: Note[];
  notesError: string | null;
  dashboard: {
    allergy: string | null;
    pastMedicalCondition: string | null;
    currentMedicationList: string | null;
    tcaNotes: string | null;
    vitals: Vital[];
    plans: {
      medical: PlanEntry;
      nursing: PlanEntry;
      diet: PlanEntry;
      dressing: PlanEntry;
      monitoring: PlanEntry;
      physio: PlanEntry;
    };
  };
};

// Two modes for the same page: reviewing past notes (dashboard fully
// expanded + note history) vs adding one (same dashboard, collapsed to
// keep reference info out of the way while writing).
export function ProgressNotesTabs({ residentId, staffOptions, notes, notesError, dashboard }: Props) {
  const [tab, setTab] = useState<"review" | "new">("review");

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        <TabButton active={tab === "review"} onClick={() => setTab("review")}>
          Review notes
        </TabButton>
        <TabButton active={tab === "new"} onClick={() => setTab("new")}>
          New entry
        </TabButton>
      </div>

      {tab === "review" ? (
        <>
          <ResidentDashboard {...dashboard} />

          {notesError && <p className="mb-4 text-sm text-red-600">{notesError}</p>}

          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
                  <span>{new Date(note.entry_timestamp).toLocaleString()}</span>
                  <span>{note.authorName}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-gray-800">{note.progress_note}</p>
                {note.medical_plan && (
                  <p className="mt-2 text-sm text-gray-600">
                    <span className="font-medium text-gray-500">Medical plan: </span>
                    {note.medical_plan}
                  </p>
                )}
                {note.nursing_plan && (
                  <p className="mt-1 text-sm text-gray-600">
                    <span className="font-medium text-gray-500">Nursing plan: </span>
                    {note.nursing_plan}
                  </p>
                )}
              </div>
            ))}
            {notes.length === 0 && (
              <p className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
                No progress notes yet.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <ResidentDashboard {...dashboard} collapsible />
          <NewNoteForm residentId={residentId} staffOptions={staffOptions} onSaved={() => setTab("review")} />
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
