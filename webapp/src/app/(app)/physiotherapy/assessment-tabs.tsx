"use client";

import { useState } from "react";
import { NewPhysioAssessmentForm, type PreviousAssessment } from "./new-physio-assessment-form";
import { PhysioAssessmentReview, type ReviewAssessment } from "./assessment-review";
import type { LookupOption } from "@/lib/types";
import type { PhysioCareSetting } from "@/lib/physio-scoring";
import { useTranslation } from "@/components/language-provider";

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
  previous,
  reviewAssessments,
}: Props) {
  const t = useTranslation();
  // Starts on New Entry once a patient is picked -- that should go
  // straight to a clean entry form, not the review list. With no patient
  // picked yet, there's no entry form to show, so start on Review Notes.
  const [tab, setTab] = useState<"review" | "new">(residentId ? "new" : "review");

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        <TabButton active={tab === "review"} onClick={() => setTab("review")}>
          {t("Review Notes")}
        </TabButton>
        <TabButton active={tab === "new"} onClick={() => setTab("new")}>
          {t("New Entry")}
        </TabButton>
      </div>

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
          previous={previous}
          onSaved={() => setTab("review")}
        />
      ) : (
        <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
          {t("Select a")} {careSetting === "OP" ? t("patient") : t("resident")} {t("above to add a new entry.")}
        </div>
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
