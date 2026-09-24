"use client";

import { useState } from "react";
import { ResidentDashboard } from "./resident-dashboard";
import { NewNoteForm } from "./new-note-form";
import { formatDateTime } from "@/lib/format-date";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ListChecks, Plus } from "lucide-react";

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
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [tab, setTab] = useState<"review" | "new">("review");

  return (
    <div>
      <TabRow className="mb-4">
        <TabButton icon={ListChecks} active={tab === "review"} onClick={() => guardedAction(() => setTab("review"))}>
          {t("Review notes")}
        </TabButton>
        <TabButton icon={Plus} active={tab === "new"} onClick={() => setTab("new")}>
          {t("New entry")}
        </TabButton>
      </TabRow>

      {tab === "review" ? (
        <>
          <ResidentDashboard {...dashboard} />

          {notesError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{notesError}</p>}

          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="rounded-md border border-line bg-surface p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between text-xs text-fg-faint">
                  <span>{formatDateTime(note.entry_timestamp)}</span>
                  <span>{note.authorName}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-fg">{note.progress_note}</p>
                {note.medical_plan && (
                  <p className="mt-2 text-sm text-fg-muted">
                    <span className="font-medium text-fg-subtle">{t("Medical plan")}: </span>
                    {note.medical_plan}
                  </p>
                )}
                {note.nursing_plan && (
                  <p className="mt-1 text-sm text-fg-muted">
                    <span className="font-medium text-fg-subtle">{t("Nursing plan")}: </span>
                    {note.nursing_plan}
                  </p>
                )}
              </div>
            ))}
            {notes.length === 0 && (
              <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-fg-faint">
                {t("No progress notes yet.")}
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
