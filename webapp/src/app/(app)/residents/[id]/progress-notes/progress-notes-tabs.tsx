"use client";

import { useState } from "react";
import { ResidentDashboard } from "./resident-dashboard";
import { NewNoteForm } from "./new-note-form";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ListChecks, Plus } from "lucide-react";
import { ProgressNotesTimeline, type ProgressNoteRow } from "@/app/(app)/clinical/progress-notes-timeline";

type Note = {
  id: number;
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
  reviewed_by_other: string | null;
  created_by: string | null;
  created_by_other: string | null;
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
  dxt: number | null;
  dxt_remark: string | null;
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

          <ProgressNotesTimeline
            notes={notes as ProgressNoteRow[]}
            t={t}
            showLatestStatus={false}
          />
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
