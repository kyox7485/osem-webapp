"use client";

import { useState } from "react";
import { NewPhysioAssessmentForm, type PreviousAssessment } from "./new-physio-assessment-form";
import { PhysioAssessmentReview, type ReviewAssessment } from "./assessment-review";
import type { LookupOption } from "@/lib/types";
import type { PhysioCareSetting, TreatmentTypeOption } from "@/lib/physio-scoring";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ListChecks, Plus } from "lucide-react";

// residentId/residentName/... are null when no patient is selected in the
// picker above -- Review Notes still has something to show (every entry
// for the branch/care setting, same "unfiltered by default" convention as
// Clinical's Vital Signs and Medical Progress Notes tabs), it's only New
// Entry that genuinely needs one specific patient chosen first.
type Props = {
  residentId: number | null;
  residentName: string | null;
  icNumber: string | null;
  gender: string | null;
  age: number | null;
  careSetting: PhysioCareSetting;
  defaultEntryTimestamp: string;
  pastMedicalCondition: string | null;
  staffOptions: LookupOption[];
  treatmentTypeOptions: TreatmentTypeOption[];
  previous: PreviousAssessment | null;
  reviewAssessments: ReviewAssessment[];
};

export function PhysioAssessmentTabs({
  residentId,
  residentName,
  icNumber,
  gender,
  age,
  careSetting,
  defaultEntryTimestamp,
  pastMedicalCondition,
  staffOptions,
  treatmentTypeOptions,
  previous,
  reviewAssessments,
}: Props) {
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  // Starts on New Entry once a patient is picked -- that should go
  // straight to a clean entry form, not the review list. With no patient
  // picked yet, there's no entry form to show, so start on Review Notes.
  const [tab, setTab] = useState<"review" | "new">(residentId ? "new" : "review");

  return (
    <div>
      <TabRow className="mb-4">
        <TabButton icon={ListChecks} active={tab === "review"} onClick={() => guardedAction(() => setTab("review"))}>
          {t("Review Notes")}
        </TabButton>
        <TabButton icon={Plus} active={tab === "new"} onClick={() => setTab("new")}>
          {t("New Entry")}
        </TabButton>
      </TabRow>

      {tab === "review" ? (
        <PhysioAssessmentReview assessments={reviewAssessments} />
      ) : residentId && residentName ? (
        <NewPhysioAssessmentForm
          residentId={residentId}
          residentName={residentName}
          icNumber={icNumber}
          gender={gender}
          age={age}
          careSetting={careSetting}
          defaultEntryTimestamp={defaultEntryTimestamp}
          pastMedicalCondition={pastMedicalCondition}
          staffOptions={staffOptions}
          treatmentTypeOptions={treatmentTypeOptions}
          previous={previous}
          onSaved={() => setTab("review")}
        />
      ) : (
        <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-400 dark:text-gray-500">
          {t("Select a")} {careSetting === "OP" ? t("patient") : t("resident")} {t("above to add a new entry.")}
        </div>
      )}
    </div>
  );
}
