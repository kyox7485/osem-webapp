"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildEmptyExamRows,
  computePhysioScore,
  EMPTY_BALANCE,
  EMPTY_COORDINATION,
  EMPTY_FUNCTIONAL,
  type BalanceScores,
  type CoordinationScores,
  type ExamRow,
  type FunctionalScores,
  type PhysioCareSetting,
  type TreatmentTypeOption,
} from "@/lib/physio-scoring";
import { fromDatetimeLocalValue } from "@/lib/format-date";
import { createPhysioAssessment } from "./actions";
import { usePhysioDirty } from "./physio-dirty-context";
import { ResidentInfoSection } from "./sections/resident-info-section";
import { SubjectiveSection } from "./sections/subjective-section";
import { BodyChartSection, type BodyChartEntry } from "./sections/body-chart-section";
import { ExaminationSection } from "./sections/examination-section";
import { BalanceSection } from "./sections/balance-section";
import { CoordinationSection } from "./sections/coordination-section";
import { FunctionalSection } from "./sections/functional-section";
import { ScoreSummary } from "./sections/score-summary";
import { NarrativeSection } from "./sections/narrative-section";
import { ComplianceSignoff } from "./sections/compliance-signoff";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { OTHERS_SENTINEL } from "@/components/staff-picker-with-other";

// previous.examRows only contains movements that actually had a score
// (see actions.ts's filter before insert) -- merge those values into the
// full grid so every movement/side still has a row to edit, not just the
// ones previously assessed.
function mergeExamRows(previousRows: ExamRow[] | undefined): ExamRow[] {
  const empty = buildEmptyExamRows();
  if (!previousRows || previousRows.length === 0) return empty;
  const byKey = new Map(previousRows.map((r) => [`${r.limb}|${r.region}|${r.movement}|${r.side}`, r]));
  return empty.map((row) => byKey.get(`${row.limb}|${row.region}|${row.movement}|${row.side}`) ?? row);
}

export type PreviousAssessment = {
  chief_complaint: string | null;
  current_history: string | null;
  social_history: string | null;
  treatment_type: string | null;
  credit_hours: number | null;
  total_score: number | null;
  examRows: ExamRow[];
  functional: FunctionalScores;
  balance: BalanceScores;
  coordination: CoordinationScores;
};

type Props = {
  residentId: number;
  residentName: string;
  icNumber: string | null;
  gender: string | null;
  age: number | null;
  careSetting: PhysioCareSetting;
  defaultEntryTimestamp: string;
  pastMedicalCondition: string | null;
  staffOptions: LookupOption[];
  treatmentTypeOptions: TreatmentTypeOption[];
  previous: PreviousAssessment | null;
  onSaved: () => void;
};

export function NewPhysioAssessmentForm({
  residentId,
  residentName,
  icNumber,
  gender,
  age,
  careSetting,
  defaultEntryTimestamp,
  pastMedicalCondition,
  staffOptions,
  treatmentTypeOptions: allTreatmentTypeOptions,
  previous,
  onSaved,
}: Props) {
  const router = useRouter();
  const t = useTranslation();
  const { setDirty, setRequestSave } = usePhysioDirty();

  const treatmentTypeOptions = useMemo(
    () => allTreatmentTypeOptions.filter((o) => o.dept === careSetting),
    [allTreatmentTypeOptions, careSetting]
  );
  const patientLabel = careSetting === "OP" ? t("Patient") : t("Resident");

  const [entryTimestamp, setEntryTimestamp] = useState(defaultEntryTimestamp);
  const [treatmentType, setTreatmentType] = useState(previous?.treatment_type ?? "");
  const [creditHours, setCreditHours] = useState(() => {
    // Fresh lookup against tbl_physio_treatment_types, not the value saved on
    // the resident's previous entry -- the standard credit hours for a
    // treatment type may have changed since that entry was recorded.
    const match = treatmentTypeOptions.find((o) => o.label === previous?.treatment_type);
    if (match) return String(match.creditHours);
    return previous?.credit_hours != null ? String(previous.credit_hours) : "";
  });
  const [chiefComplaint, setChiefComplaint] = useState(previous?.chief_complaint ?? "");
  const [currentHistory, setCurrentHistory] = useState(previous?.current_history ?? "");
  const [socialHistory, setSocialHistory] = useState(previous?.social_history ?? "");
  const [bodyChart, setBodyChart] = useState<BodyChartEntry[]>([]);
  const [examRows, setExamRows] = useState<ExamRow[]>(() => mergeExamRows(previous?.examRows));
  const [functional, setFunctional] = useState<FunctionalScores>(previous?.functional ?? EMPTY_FUNCTIONAL);
  const [balance, setBalance] = useState<BalanceScores>(previous?.balance ?? EMPTY_BALANCE);
  const [coordination, setCoordination] = useState<CoordinationScores>(previous?.coordination ?? EMPTY_COORDINATION);
  const [impression, setImpression] = useState("");
  const [planIntervention, setPlanIntervention] = useState("");
  const [evaluation, setEvaluation] = useState("");
  const [treatmentCompliance, setTreatmentCompliance] = useState("");
  const [documentedBy, setDocumentedBy] = useState("");
  const [documentedByOtherName, setDocumentedByOtherName] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const currentScore = useMemo(
    () => computePhysioScore(examRows, functional, balance, coordination),
    [examRows, functional, balance, coordination]
  );

  // Marks the form dirty on any real edit -- skips the very first render so
  // carried-forward prefill (or a fresh mount) never counts as "dirty" on
  // its own, only an actual change made after that.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setDirty(true);
  }, [
    entryTimestamp,
    treatmentType,
    creditHours,
    chiefComplaint,
    currentHistory,
    socialHistory,
    bodyChart,
    examRows,
    functional,
    balance,
    coordination,
    impression,
    planIntervention,
    evaluation,
    treatmentCompliance,
    documentedBy,
  ]);

  async function doSave(): Promise<boolean> {
    setError("");

    if (!documentedBy || (documentedBy === OTHERS_SENTINEL && !documentedByOtherName.trim())) {
      setError(t("Please select who documented this assessment"));
      return false;
    }

    setIsSaving(true);

    const result = await createPhysioAssessment({
      residentId,
      careSetting,
      entryTimestamp: fromDatetimeLocalValue(entryTimestamp),
      treatmentType: treatmentType || null,
      creditHours: creditHours ? parseFloat(creditHours) : null,
      chiefComplaint: chiefComplaint || null,
      currentHistory: currentHistory || null,
      pastMedicalHistory: pastMedicalCondition,
      socialHistory: socialHistory || null,
      impression: impression || null,
      planIntervention: planIntervention || null,
      evaluation: evaluation || null,
      treatmentCompliance: treatmentCompliance || null,
      documentedBy: documentedBy === OTHERS_SENTINEL ? "" : documentedBy,
      documentedByOther: documentedBy === OTHERS_SENTINEL ? documentedByOtherName.trim() : "",
      examRows,
      bodyChart,
      functional,
      balance,
      coordination,
    });

    setIsSaving(false);

    if (!result.success) {
      setError(result.error || t("Failed to save assessment"));
      return false;
    }

    setDirty(false);
    router.refresh();
    return true;
  }

  // Registers this form's save logic with the shared dirty-tracking context
  // so the resident picker (a sibling, not a descendant) can trigger a save
  // before switching residents when this form has unsaved changes.
  useEffect(() => {
    setRequestSave(doSave);
    return () => setRequestSave(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entryTimestamp,
    treatmentType,
    creditHours,
    chiefComplaint,
    currentHistory,
    socialHistory,
    bodyChart,
    examRows,
    functional,
    balance,
    coordination,
    impression,
    planIntervention,
    evaluation,
    treatmentCompliance,
    documentedBy,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await doSave();
    if (ok) onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <ResidentInfoSection
        residentName={residentName}
        icNumber={icNumber}
        gender={gender}
        age={age}
        label={patientLabel}
        entryTimestamp={entryTimestamp}
        setEntryTimestamp={setEntryTimestamp}
        treatmentTypeOptions={treatmentTypeOptions}
        treatmentType={treatmentType}
        setTreatmentType={setTreatmentType}
        creditHours={creditHours}
        setCreditHours={setCreditHours}
      />

      <SubjectiveSection
        chiefComplaint={chiefComplaint}
        setChiefComplaint={setChiefComplaint}
        currentHistory={currentHistory}
        setCurrentHistory={setCurrentHistory}
        pastMedicalHistory={pastMedicalCondition ?? ""}
        socialHistory={socialHistory}
        setSocialHistory={setSocialHistory}
      />

      <BodyChartSection findings={bodyChart} setFindings={setBodyChart} />

      <ExaminationSection examRows={examRows} setExamRows={setExamRows} />

      <BalanceSection value={balance} onChange={setBalance} />

      <CoordinationSection value={coordination} onChange={setCoordination} />

      <FunctionalSection value={functional} onChange={setFunctional} />

      <ScoreSummary currentScore={currentScore} previousScore={previous?.total_score ?? null} />

      <NarrativeSection
        impression={impression}
        setImpression={setImpression}
        planIntervention={planIntervention}
        setPlanIntervention={setPlanIntervention}
        evaluation={evaluation}
        setEvaluation={setEvaluation}
      />

      <ComplianceSignoff
        treatmentCompliance={treatmentCompliance}
        setTreatmentCompliance={setTreatmentCompliance}
        documentedBy={documentedBy}
        setDocumentedBy={setDocumentedBy}
        documentedByOther={documentedByOtherName}
        setDocumentedByOther={setDocumentedByOtherName}
        staffOptions={staffOptions}
      />

      <div className="flex justify-end pb-4">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isSaving ? t("Saving...") : t("Save Assessment")}
        </button>
      </div>
    </form>
  );
}
