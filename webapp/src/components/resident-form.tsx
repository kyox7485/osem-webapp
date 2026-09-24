"use client";

import { useTransition, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type {
  Resident,
  LookupOption,
  DiagnosisOption,
  ExistingDiagnosis,
} from "@/lib/types";
import {
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  RESIDENT_STATUS_OPTIONS,
  CARE_TYPE_OPTIONS,
  TRANSFER_FROM_OPTIONS,
  ACCOMPANIED_BY_OPTIONS,
  MOBILITY_OPTIONS,
  HYGIENE_OPTIONS,
} from "@/lib/types";
import { ageFromMalaysianIC } from "@/lib/malaysian-ic";
import { useTranslation } from "@/components/language-provider";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import { useDirtyForm } from "@/lib/dirty-form-context";

type StaffOption = LookupOption & { branch_id: number };

type Props = {
  resident?: Resident;
  prefill?: Partial<Resident>;
  nationalities: LookupOption[];
  dietTypes: LookupOption[];
  feedingTypes: LookupOption[];
  branches: LookupOption[];
  allStaff: StaffOption[];
  diagnosisOptions: DiagnosisOption[];
  existingDiagnoses?: ExistingDiagnosis[];
  defaultBranchId: number | null;
  isAdmin: boolean;
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  backHref?: string;
};

// ── Questionnaire state types ─────────────────────────────────────────────────

type AllergyAnswers = {
  foodYN: "yes" | "no" | "";
  foodReaction: string;
  medYN: "yes" | "no" | "";
  medReaction: string;
};

type AssessmentAnswers = {
  arrivalTime: string;
  modeOfArrival: string;
  avpu: string;
  cough: "yes" | "no" | "";
  fever: "yes" | "no" | "";
  pain: "yes" | "no" | "";
  activeComplaints: "yes" | "no" | "";
  activeComplaintsDetail: string;
  treatmentGiven: string;
  lastMeal: string;
  foodAfterAdmission: string;
  lastBowelOutput: string;
  urineCatheter: "yes" | "no" | "";
  urineCatheterDate: string;
  feedingTube: "yes" | "no" | "";
  feedingTubeDate: string;
};

const EMPTY_ALLERGY: AllergyAnswers = {
  foodYN: "", foodReaction: "", medYN: "", medReaction: "",
};

const EMPTY_ASSESSMENT: AssessmentAnswers = {
  arrivalTime: "", modeOfArrival: "", avpu: "",
  cough: "", fever: "", pain: "",
  activeComplaints: "", activeComplaintsDetail: "", treatmentGiven: "",
  lastMeal: "", foodAfterAdmission: "", lastBowelOutput: "",
  urineCatheter: "", urineCatheterDate: "",
  feedingTube: "", feedingTubeDate: "",
};

const ARRIVAL_MODES = ["Walking", "Wheelchair", "Stretcher"] as const;

const INFECTIOUS_IDS = new Set([18, 19, 20, 21, 22, 23, 24]);
const BONE_FRACTURE_ID = 17;
const OTHERS_DIAGNOSIS_ID = 25;

function sortDietTypes(types: Array<{ id: number | string; label: string }>) {
  const PRIORITY: Record<string, number> = { "Normal Diet": 0, "Soft Diet": 1 };
  return [...types].sort((a, b) => {
    const pa = PRIORITY[a.label] ?? 2;
    const pb = PRIORITY[b.label] ?? 2;
    return pa !== pb ? pa - pb : Number(a.id) - Number(b.id);
  });
}

function sortFeedingTypes(types: Array<{ id: number | string; label: string }>) {
  const PRIORITY: Record<string, number> = { "Self Feeding": 0 };
  return [...types].sort((a, b) => {
    const pa = PRIORITY[a.label] ?? 1;
    const pb = PRIORITY[b.label] ?? 1;
    return pa !== pb ? pa - pb : Number(a.id) - Number(b.id);
  });
}

const AVPU_OPTIONS = [
  { value: "A", labelKey: "A – Alert" },
  { value: "V", labelKey: "V – Voice" },
  { value: "P", labelKey: "P – Pain" },
  { value: "U", labelKey: "U – Unresponsive" },
] as const;

// ── Compile questionnaire → stored string (always English) ───────────────────

function compileAllergy(a: AllergyAnswers): string {
  const lines: string[] = [];
  if (a.foodYN) {
    const base = `Food allergy: ${a.foodYN === "yes" ? "Yes" : "No"}`;
    lines.push(a.foodYN === "yes" && a.foodReaction.trim()
      ? `${base}; Reaction: ${a.foodReaction.trim()}` : base);
  }
  if (a.medYN) {
    const base = `Medicine allergy: ${a.medYN === "yes" ? "Yes" : "No"}`;
    lines.push(a.medYN === "yes" && a.medReaction.trim()
      ? `${base}; Reaction: ${a.medReaction.trim()}` : base);
  }
  return lines.join("\n");
}

function compileAssessment(a: AssessmentAnswers): string {
  const parts: string[] = [];
  const add = (k: string, v: string) => { if (v.trim()) parts.push(`${k}: ${v.trim()}`); };
  const addYN = (k: string, yn: "yes" | "no" | "") => {
    if (yn) add(k, yn === "yes" ? "Yes" : "No");
  };
  add("Arrival time", a.arrivalTime);
  add("Mode of arrival", a.modeOfArrival);
  add("AVPU", a.avpu);
  addYN("Cough", a.cough);
  addYN("Fever", a.fever);
  addYN("Pain", a.pain);
  if (a.activeComplaints) {
    const base = `Active complaints: ${a.activeComplaints === "yes" ? "Yes" : "No"}`;
    parts.push(a.activeComplaints === "yes" && a.activeComplaintsDetail.trim()
      ? `${base}; Detail: ${a.activeComplaintsDetail.trim()}` : base);
  }
  // Treatment given is shared — any symptom = Yes triggers it
  add("Treatment given", a.treatmentGiven);
  add("Last meal", a.lastMeal);
  add("Food after admission", a.foodAfterAdmission);
  add("Last bowel output", a.lastBowelOutput);
  if (a.urineCatheter) {
    const base = `Urine catheter: ${a.urineCatheter === "yes" ? "Yes" : "No"}`;
    parts.push(a.urineCatheter === "yes" && a.urineCatheterDate
      ? `${base}; Last inserted: ${a.urineCatheterDate}` : base);
  }
  if (a.feedingTube) {
    const base = `Feeding tube: ${a.feedingTube === "yes" ? "Yes" : "No"}`;
    parts.push(a.feedingTube === "yes" && a.feedingTubeDate
      ? `${base}; Last inserted: ${a.feedingTubeDate}` : base);
  }
  return parts.join("\n");
}

// ── Parse compiled text back into questionnaire fields (for edit mode) ────────

function parseAllergyText(text: string): AllergyAnswers | null {
  const foodM = text.match(/^Food allergy: (Yes|No)(?:; Reaction: (.+))?$/m);
  const medM = text.match(/^Medicine allergy: (Yes|No)(?:; Reaction: (.+))?$/m);
  if (!foodM && !medM) return null;
  return {
    foodYN: foodM ? (foodM[1] === "Yes" ? "yes" : "no") : "",
    foodReaction: foodM?.[2]?.trim() ?? "",
    medYN: medM ? (medM[1] === "Yes" ? "yes" : "no") : "",
    medReaction: medM?.[2]?.trim() ?? "",
  };
}

function parseAssessmentText(text: string): AssessmentAnswers | null {
  if (!text) return null;
  const getLine = (key: string) =>
    text.match(new RegExp(`^${key}: (.+)$`, "m"))?.[1]?.trim() ?? "";
  const toYN = (v: string): "yes" | "no" | "" =>
    v === "Yes" ? "yes" : v === "No" ? "no" : "";
  const arrivalTime = getLine("Arrival time");
  const modeOfArrival = getLine("Mode of arrival");
  const avpu = getLine("AVPU");
  const cough = getLine("Cough");
  const fever = getLine("Fever");
  if (!arrivalTime && !modeOfArrival && !avpu && !cough && !fever) return null;
  // Active complaints: supports both new "Detail:" format and legacy "Treatment given:" inline
  const complaintsM = text.match(
    /^Active complaints: (Yes|No)(?:; (?:Detail|Treatment given): (.+))?$/m,
  );
  const cathM = text.match(/^Urine catheter: (Yes|No)(?:; Last inserted: (.+))?$/m);
  const tubeM = text.match(/^Feeding tube: (Yes|No)(?:; Last inserted: (.+))?$/m);
  // Treatment given: standalone line (new) OR extracted from old inline format
  const standaloneTreatment = getLine("Treatment given");
  return {
    arrivalTime,
    modeOfArrival,
    avpu,
    cough: toYN(cough),
    fever: toYN(fever),
    pain: toYN(getLine("Pain")),
    activeComplaints: complaintsM ? (complaintsM[1] === "Yes" ? "yes" : "no") : "",
    activeComplaintsDetail: (complaintsM?.[2]?.trim() ?? ""),
    treatmentGiven: standaloneTreatment,
    lastMeal: getLine("Last meal"),
    foodAfterAdmission: getLine("Food after admission"),
    lastBowelOutput: getLine("Last bowel output"),
    urineCatheter: cathM ? (cathM[1] === "Yes" ? "yes" : "no") : "",
    urineCatheterDate: cathM?.[2]?.trim() ?? "",
    feedingTube: tubeM ? (tubeM[1] === "Yes" ? "yes" : "no") : "",
    feedingTubeDate: tubeM?.[2]?.trim() ?? "",
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export function ResidentForm({
  resident,
  prefill,
  nationalities,
  dietTypes,
  feedingTypes,
  branches,
  allStaff,
  diagnosisOptions,
  existingDiagnoses = [],
  defaultBranchId,
  isAdmin,
  action,
  backHref,
}: Props) {
  const t = useTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const markDirty = () => setIsDirty(true);

  // Warn on browser-level navigation (tab close, external link, browser back) when dirty
  useEffect(() => {
    if (!isDirty || isPending) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, isPending]);

  // Mirrors the above into the app-wide dirty-form guard (sidebar links,
  // module switches) -- this form's own Back-button flow above stays as
  // the in-module UX for its own Back button.
  const residentFormId = resident ? `resident-edit-${resident.id}` : "resident-new";
  const { markDirty: markGlobalDirty, markClean: markGlobalClean, unregister: unregisterGlobal } = useDirtyForm(residentFormId);
  const submitFormRef = useRef<(fd: FormData) => Promise<{ success: boolean; error?: string }>>(null!);

  // Clear global dirty state on unmount — covers the case where the Server
  // Action calls redirect() (which throws on the client, bypassing the
  // explicit markGlobalClean() in submitForm) and the component unmounts
  // before the cleanup runs normally.
  useEffect(() => {
    return () => {
      unregisterGlobal();
    };
  }, [unregisterGlobal]);

  useEffect(() => {
    if (isDirty) {
      markGlobalDirty(() => submitFormRef.current(new FormData(formRef.current!)));
    } else {
      markGlobalClean();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  const p = resident ?? prefill;
  const [branchId, setBranchId] = useState<string>(
    resident ? String(resident.branch_id)
      : prefill?.branch_id ? String(prefill.branch_id)
      : defaultBranchId ? String(defaultBranchId) : "",
  );
  const [status, setStatus] = useState<string>(resident?.status ?? "ACTIVE");
  const [icNumber, setIcNumber] = useState(p?.ic_number ?? "");
  const malaysiaId = nationalities.find((n) => n.label === "Malaysia")?.id;
  const [nationalityId, setNationalityId] = useState<string>(
    p?.nationality_id != null
      ? String(p.nationality_id)
      : malaysiaId != null ? String(malaysiaId) : "",
  );
  const [age, setAge] = useState(p?.age != null ? String(p.age) : "");
  const [residentName, setResidentName] = useState(p?.resident_name ?? "");

  const othersOption = diagnosisOptions.find((o) => o.name_en === "Others");
  const nilOption = diagnosisOptions.find((o) => o.name_en === "NIL");
  const [selectedDiagnosisIds, setSelectedDiagnosisIds] = useState<number[]>(
    existingDiagnoses.map((d) => d.diagnosis_option_id),
  );
  const [diagnosisOthersRemark, setDiagnosisOthersRemark] = useState<string>(
    existingDiagnoses.find((d) => d.diagnosis_option_id === othersOption?.id)?.remark ?? "",
  );

  // Diagnosis grouping
  const mainDiagnosisOptions = (() => {
    const base = diagnosisOptions.filter((o) => !INFECTIOUS_IDS.has(o.id) && o.id !== OTHERS_DIAGNOSIS_ID);
    const othersOpt = diagnosisOptions.find((o) => o.id === OTHERS_DIAGNOSIS_ID);
    const bfIdx = base.findIndex((o) => o.id === BONE_FRACTURE_ID);
    if (othersOpt !== undefined && bfIdx >= 0) {
      const result = [...base];
      result.splice(bfIdx + 1, 0, othersOpt);
      return result;
    }
    return othersOpt ? [...base, othersOpt] : base;
  })();
  const infectiousDiagnosisOptions = diagnosisOptions.filter((o) => INFECTIOUS_IDS.has(o.id));
  const anyInfectiousSelected = existingDiagnoses.some((d) => INFECTIOUS_IDS.has(d.diagnosis_option_id));
  const [infectiousExpanded, setInfectiousExpanded] = useState(anyInfectiousSelected);

  // Assessment collapse (expanded for new, collapsed for edit/readmit)
  const [assessmentExpanded, setAssessmentExpanded] = useState(!resident && !prefill);

  const staffForBranch = allStaff.filter((s) => String(s.branch_id) === branchId);
  const isMalaysian = malaysiaId != null && String(malaysiaId) === nationalityId;
  const [reviewedBy, setReviewedBy] = useState(resident?.reviewed_by ?? "");
  const [reviewedByOther, setReviewedByOther] = useState(resident?.reviewed_by_other ?? "");

  // Allergy questionnaire
  const parsedAllergy = p?.allergy ? parseAllergyText(p.allergy) : null;
  const allergyIsFallback = !!resident?.allergy && !parsedAllergy;
  const [allergyQ, setAllergyQ] = useState<AllergyAnswers>(parsedAllergy ?? EMPTY_ALLERGY);

  // Assessment questionnaire
  const parsedAssessment = resident?.assessment_and_summary
    ? parseAssessmentText(resident.assessment_and_summary)
    : null;
  const assessmentIsFallback = !!resident?.assessment_and_summary && !parsedAssessment;
  const [assessmentQ, setAssessmentQ] = useState<AssessmentAnswers>(
    parsedAssessment ?? EMPTY_ASSESSMENT,
  );

  // Arrival vital signs (new-resident mode only — not shown on edit)
  const [arrivalSystolic, setArrivalSystolic] = useState("");
  const [arrivalDiastolic, setArrivalDiastolic] = useState("");
  const [arrivalHr, setArrivalHr] = useState("");
  const [arrivalTemp, setArrivalTemp] = useState("");
  const [arrivalSpo2, setArrivalSpo2] = useState("");
  const [arrivalDxt, setArrivalDxt] = useState("");

  // Auto-derive age from Malaysian IC
  useEffect(() => {
    if (malaysiaId === undefined || String(malaysiaId) !== nationalityId) return;
    const calculated = ageFromMalaysianIC(icNumber);
    if (calculated !== null) setAge(String(calculated));
  }, [icNumber, nationalityId, malaysiaId]);

  function toggleDiagnosis(id: number) {
    markDirty();
    setSelectedDiagnosisIds((prev) => {
      if (id === nilOption?.id) return prev.includes(id) ? [] : [id];
      const withoutNil = nilOption ? prev.filter((x) => x !== nilOption.id) : prev;
      if (withoutNil.includes(id)) {
        if (id === othersOption?.id) setDiagnosisOthersRemark("");
        return withoutNil.filter((x) => x !== id);
      }
      return [...withoutNil, id];
    });
  }

  function allergySet<K extends keyof AllergyAnswers>(key: K, val: AllergyAnswers[K]) {
    markDirty();
    setAllergyQ((prev) => ({ ...prev, [key]: val }));
  }

  function assessSet<K extends keyof AssessmentAnswers>(key: K, val: AssessmentAnswers[K]) {
    markDirty();
    setAssessmentQ((prev) => ({ ...prev, [key]: val }));
  }

  function submitForm(formData: FormData): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      startTransition(async () => {
        setError(null);
        const result = await action(formData);
        if (result?.error) {
          setError(result.error);
          resolve({ success: false, error: result.error });
          return;
        }
        // On success the server action calls redirect() so isDirty resets implicitly
        setIsDirty(false);
        markGlobalClean();
        resolve({ success: true });
      });
    });
  }
  useEffect(() => {
    submitFormRef.current = submitForm;
  });

  function handleSubmit(formData: FormData) {
    void submitForm(formData);
  }

  function handleBackClick() {
    if (isDirty) {
      setShowExitModal(true);
    } else {
      router.push(backHref ?? "/residents");
    }
  }

  function handleExitWithoutSaving() {
    setIsDirty(false);
    markGlobalClean();
    setShowExitModal(false);
    router.push(backHref ?? "/residents");
  }

  function handleSaveAndExit() {
    setShowExitModal(false);
    formRef.current?.requestSubmit();
  }

  // Whether treatment-given row should appear (any active symptom = yes)
  const anySymptomYes =
    assessmentQ.cough === "yes" ||
    assessmentQ.fever === "yes" ||
    assessmentQ.pain === "yes" ||
    assessmentQ.activeComplaints === "yes";

  return (
    <>
      {/* ── Unsaved-changes confirmation modal ─────────────────────────── */}
      {showExitModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowExitModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 mb-4 sm:mb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900">{t("Unsaved changes")}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {t("You have unsaved changes. What would you like to do?")}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSaveAndExit}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800 transition-colors"
              >
                {t("Save and exit")}
              </button>
              <button
                type="button"
                onClick={handleExitWithoutSaving}
                className="w-full rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
              >
                {t("Exit without saving")}
              </button>
              <button
                type="button"
                onClick={() => setShowExitModal(false)}
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {t("Continue editing")}
              </button>
            </div>
          </div>
        </div>
      )}

      <form
        ref={formRef}
        action={handleSubmit}
        onChange={markDirty}
        className="space-y-5"
      >
        {/* Back button */}
        {backHref !== undefined && (
          <button
            type="button"
            onClick={handleBackClick}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M10 12.5L5.5 8l4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t("Back")}
            {isDirty && (
              <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" title={t("Unsaved changes")} />
            )}
          </button>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-600">
            {error}
          </p>
        )}

        {/* ── Basic details ─────────────────────────────────────────────── */}
        <Section title={t("Basic details")}>
          <Field label={t("Name")} required>
            <input
              name="resident_name"
              value={residentName}
              onChange={(e) => setResidentName(e.target.value.toUpperCase())}
              required
              className={inputCls}
            />
          </Field>
          <Field label={t("Branch")} required>
            {isAdmin ? (
              <select
                name="branch_id"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
                className={inputCls}
              >
                <option value="" disabled>{t("Select a branch")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
            ) : (
              <>
                <div className={`${inputCls} bg-gray-50 text-gray-500`}>
                  {branches.find((b) => String(b.id) === branchId)?.label ?? t("--")}
                </div>
                <input type="hidden" name="branch_id" value={branchId} />
              </>
            )}
          </Field>
          <Field label={t("Nationality")}>
            <select
              name="nationality_id"
              value={nationalityId}
              onChange={(e) => setNationalityId(e.target.value)}
              className={inputCls}
            >
              <option value="">{t("--")}</option>
              {nationalities.map((n) => (
                <option key={n.id} value={n.id}>{n.label}</option>
              ))}
            </select>
          </Field>
          <Field label={isMalaysian ? t("IC number") : t("Passport No.")}>
            <input
              name="ic_number"
              value={icNumber}
              onChange={(e) => setIcNumber(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label={t("Age")}>
            <input
              name="age"
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label={t("Gender")}>
            <select name="gender" defaultValue={p?.gender ?? ""} className={inputCls}>
              <option value="">{t("--")}</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g} value={g}>{t(g)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Marital status")}>
            <select name="marital_status" defaultValue={p?.marital_status ?? ""} className={inputCls}>
              <option value="">{t("--")}</option>
              {MARITAL_STATUS_OPTIONS.map((o) => (
                <option key={o} value={o}>{t(o)}</option>
              ))}
            </select>
          </Field>
        </Section>

        {/* ── Admission ─────────────────────────────────────────────────── */}
        <Section title={t("Admission")}>
          {resident ? (
            <Field label={t("Status")}>
              <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                {RESIDENT_STATUS_OPTIONS.map((o) => (
                  <option key={o} value={o}>{t(o)}</option>
                ))}
              </select>
            </Field>
          ) : (
            <input type="hidden" name="status" value="ACTIVE" />
          )}
          <Field label={t("Care type")}>
            <select name="care_type" defaultValue={p?.care_type ?? ""} className={inputCls}>
              <option value="">{t("--")}</option>
              {CARE_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>{t(o)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Admission date")}>
            <input
              name="admission_date"
              type="date"
              defaultValue={resident?.admission_date ?? new Date().toISOString().split("T")[0]}
              className={inputCls}
            />
          </Field>
          {status !== "ACTIVE" && (
            <Field label={t("Discharge date")} required>
              <input
                name="discharge_date"
                type="date"
                defaultValue={resident?.discharge_date ?? ""}
                required
                className={inputCls}
              />
            </Field>
          )}
          <Field label={t("Transfer from")}>
            <select name="transfer_from" defaultValue={resident?.transfer_from ?? ""} className={inputCls}>
              <option value="">{t("--")}</option>
              {TRANSFER_FROM_OPTIONS.map((o) => (
                <option key={o} value={o}>{t(o)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Accompanied by")}>
            <select name="accompanied_by" defaultValue={resident?.accompanied_by ?? ""} className={inputCls}>
              <option value="">{t("--")}</option>
              {ACCOMPANIED_BY_OPTIONS.map((o) => (
                <option key={o} value={o}>{t(o)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Emergency contact")} full>
            <textarea
              name="emergency_contact"
              defaultValue={p?.emergency_contact ?? ""}
              rows={2}
              placeholder={t("e.g. Jasmin (Daughter) - 012-34567890")}
              className={inputCls}
            />
          </Field>
        </Section>

        {/* ── Care ──────────────────────────────────────────────────────── */}
        <Section title={t("Care")}>
          <Field label={t("Mobility")}>
            <select name="mobility" defaultValue={p?.mobility ?? ""} className={inputCls}>
              <option value="">{t("--")}</option>
              {MOBILITY_OPTIONS.map((o) => (
                <option key={o} value={o}>{t(o)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Hygiene")}>
            <select name="hygiene" defaultValue={p?.hygiene ?? ""} className={inputCls}>
              <option value="">{t("--")}</option>
              {HYGIENE_OPTIONS.map((o) => (
                <option key={o} value={o}>{t(o)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Diet type")}>
            <select name="diet_type_id" defaultValue={p?.diet_type_id ?? ""} className={inputCls}>
              <option value="">{t("--")}</option>
              {sortDietTypes(dietTypes).map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Feeding type")}>
            <select name="feeding_type_id" defaultValue={p?.feeding_type_id ?? ""} className={inputCls}>
              <option value="">{t("--")}</option>
              {sortFeedingTypes(feedingTypes).map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </Field>
        </Section>

        {/* ── Clinical notes ────────────────────────────────────────────── */}
        <Section title={t("Clinical notes")}>

          {/* Allergy */}
          <Field label={t("Allergy")} full>
            {allergyIsFallback ? (
              <textarea name="allergy" defaultValue={resident!.allergy ?? ""} rows={2} className={inputCls} />
            ) : (
              <>
                <input type="hidden" name="allergy" value={compileAllergy(allergyQ)} />
                <div className="mt-3 space-y-4">
                  <AllergyQuestion
                    label={t("Is patient having any food allergy?")}
                    yn={allergyQ.foodYN}
                    reaction={allergyQ.foodReaction}
                    reactionPlaceholder={t("Describe it.")}
                    onYN={(v) => allergySet("foodYN", v)}
                    onReaction={(v) => allergySet("foodReaction", v)}
                    t={t}
                  />
                  <AllergyQuestion
                    label={t("Is patient having any medicine allergy?")}
                    yn={allergyQ.medYN}
                    reaction={allergyQ.medReaction}
                    reactionPlaceholder={t("Describe it.")}
                    onYN={(v) => allergySet("medYN", v)}
                    onReaction={(v) => allergySet("medReaction", v)}
                    t={t}
                  />
                </div>
              </>
            )}
          </Field>

          {/* Known history of Medical/Surgical Condition */}
          <Field label={t("Known history of Medical/Surgical Condition")} full>
            {selectedDiagnosisIds.map((id) => {
              const opt = diagnosisOptions.find((o) => o.id === id);
              return (
                <span key={id}>
                  <input type="hidden" name="diagnosis_option_ids" value={id} />
                  <input type="hidden" name="diagnosis_option_labels" value={opt?.name_en ?? String(id)} />
                </span>
              );
            })}
            <input type="hidden" name="diagnosis_others_remark" value={diagnosisOthersRemark} />
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {mainDiagnosisOptions.map((opt) => {
                const checked = selectedDiagnosisIds.includes(opt.id);
                return (
                  <label
                    key={opt.id}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                      checked
                        ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDiagnosis(opt.id)}
                      className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                    />
                    <span className="text-sm leading-tight">
                      {opt.name_en}
                      {opt.name_ms && opt.name_ms !== opt.name_en && (
                        <span className="block text-xs text-gray-400">{opt.name_ms}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            {othersOption && selectedDiagnosisIds.includes(othersOption.id) && (
              <input
                type="text"
                value={diagnosisOthersRemark}
                onChange={(e) => { markDirty(); setDiagnosisOthersRemark(e.target.value); }}
                placeholder={t("Please specify...")}
                className={`mt-2 ${inputCls}`}
              />
            )}
            {/* Infectious Disease collapsible sub-block */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setInfectiousExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors"
              >
                <svg
                  width="14" height="14" viewBox="0 0 16 16" fill="none"
                  className={`transition-transform ${infectiousExpanded ? "rotate-90" : ""}`}
                >
                  <path d="M6 12L10 8 6 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t("Infectious Disease")}
              </button>
              {infectiousExpanded && (
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {infectiousDiagnosisOptions.map((opt) => {
                    const checked = selectedDiagnosisIds.includes(opt.id);
                    return (
                      <label
                        key={opt.id}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                          checked
                            ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                            : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDiagnosis(opt.id)}
                          className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                        />
                        <span className="text-sm leading-tight">
                          {opt.name_en}
                          {opt.name_ms && opt.name_ms !== opt.name_en && (
                            <span className="block text-xs text-gray-400">{opt.name_ms}</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </Field>

          {/* Assessment and Summary */}
          <Field label={t("Assessment and Summary")} full>
            {assessmentIsFallback ? (
              <textarea
                name="assessment_and_summary"
                defaultValue={resident!.assessment_and_summary ?? ""}
                rows={3}
                className={inputCls}
              />
            ) : (
              <>
                <input
                  type="hidden"
                  name="assessment_and_summary"
                  value={compileAssessment(assessmentQ)}
                />
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setAssessmentExpanded((v) => !v)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    {assessmentExpanded ? t("Collapse") : t("Expand")}
                  </button>
                </div>
                {assessmentExpanded && <div className="mt-3 space-y-6">

                  {/* Arrival */}
                  <div className="space-y-3">
                    <QGroupHeader title={t("Arrival")} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <QLabel>{t("Arrive at what time?")}</QLabel>
                        <input
                          type="time"
                          value={assessmentQ.arrivalTime}
                          onChange={(e) => assessSet("arrivalTime", e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <QLabel>{t("Mode of arrival")}</QLabel>
                        <div className="mt-1.5 flex gap-2 flex-wrap">
                          {ARRIVAL_MODES.map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() =>
                                assessSet("modeOfArrival", assessmentQ.modeOfArrival === mode ? "" : mode)
                              }
                              className={`px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors cursor-pointer ${
                                assessmentQ.modeOfArrival === mode
                                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                                  : "border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:bg-gray-50"
                              }`}
                            >
                              {t(mode)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Clinical status on arrival */}
                  <div className="space-y-4">
                    <QGroupHeader title={t("Clinical status on arrival")} />
                    <div>
                      <QLabel>{t("AVPU status")}</QLabel>
                      <select
                        value={assessmentQ.avpu}
                        onChange={(e) => assessSet("avpu", e.target.value)}
                        className={`sm:max-w-xs ${inputCls}`}
                      >
                        <option value="">{t("--")}</option>
                        {AVPU_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {(
                        [
                          { key: "cough", label: t("Got cough?") },
                          { key: "fever", label: t("Got fever?") },
                          { key: "pain", label: t("Got pain?") },
                        ] as { key: "cough" | "fever" | "pain"; label: string }[]
                      ).map(({ key, label }) => (
                        <div key={key}>
                          <QLabel>{label}</QLabel>
                          <YesNoButtons
                            value={assessmentQ[key]}
                            onChange={(v) => assessSet(key, v)}
                            t={t}
                          />
                        </div>
                      ))}
                    </div>
                    <div>
                      <QLabel>{t("Any other active complaints?")}</QLabel>
                      <YesNoButtons
                        value={assessmentQ.activeComplaints}
                        onChange={(v) => {
                          assessSet("activeComplaints", v);
                          if (v === "no") assessSet("activeComplaintsDetail", "");
                        }}
                        t={t}
                      />
                      {assessmentQ.activeComplaints === "yes" && (
                        <input
                          type="text"
                          value={assessmentQ.activeComplaintsDetail}
                          onChange={(e) => assessSet("activeComplaintsDetail", e.target.value)}
                          placeholder={t("Please specify the complaint")}
                          className={`mt-2 ${inputCls}`}
                        />
                      )}
                    </div>
                    {/* Treatment given — shared, shown when any symptom is Yes */}
                    {anySymptomYes && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3">
                        <QLabel>{t("Any treatment given?")}</QLabel>
                        <input
                          type="text"
                          value={assessmentQ.treatmentGiven}
                          onChange={(e) => assessSet("treatmentGiven", e.target.value)}
                          placeholder={t("e.g. Paracetamol 500mg PO stat")}
                          className={`mt-1.5 ${inputCls}`}
                        />
                      </div>
                    )}
                  </div>

                  {/* Nutrition & elimination */}
                  <div className="space-y-4">
                    <QGroupHeader title={t("Nutrition & elimination")} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <QLabel>{t("When is the last meal taken?")}</QLabel>
                        <input
                          type="text"
                          value={assessmentQ.lastMeal}
                          onChange={(e) => assessSet("lastMeal", e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <QLabel>{t("Any food served after the admission?")}</QLabel>
                        <input
                          type="text"
                          value={assessmentQ.foodAfterAdmission}
                          onChange={(e) => assessSet("foodAfterAdmission", e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <QLabel>{t("When is the last bowel output?")}</QLabel>
                        <input
                          type="text"
                          value={assessmentQ.lastBowelOutput}
                          onChange={(e) => assessSet("lastBowelOutput", e.target.value)}
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <div>
                      <QLabel>{t("Is patient on urine catheter?")}</QLabel>
                      <YesNoButtons
                        value={assessmentQ.urineCatheter}
                        onChange={(v) => {
                          assessSet("urineCatheter", v);
                          if (v === "no") assessSet("urineCatheterDate", "");
                        }}
                        t={t}
                      />
                      {assessmentQ.urineCatheter === "yes" && (
                        <div className="mt-2 sm:max-w-xs">
                          <QLabel small>{t("When was it last inserted?")}</QLabel>
                          <input
                            type="date"
                            value={assessmentQ.urineCatheterDate}
                            onChange={(e) => assessSet("urineCatheterDate", e.target.value)}
                            className={inputCls}
                          />
                        </div>
                      )}
                    </div>
                    <div>
                      <QLabel>{t("Is patient on feeding tube?")}</QLabel>
                      <YesNoButtons
                        value={assessmentQ.feedingTube}
                        onChange={(v) => {
                          assessSet("feedingTube", v);
                          if (v === "no") assessSet("feedingTubeDate", "");
                        }}
                        t={t}
                      />
                      {assessmentQ.feedingTube === "yes" && (
                        <div className="mt-2 sm:max-w-xs">
                          <QLabel small>{t("When was it last inserted?")}</QLabel>
                          <input
                            type="date"
                            value={assessmentQ.feedingTubeDate}
                            onChange={(e) => assessSet("feedingTubeDate", e.target.value)}
                            className={inputCls}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                </div>}
              </>
            )}
          </Field>

          {/* Arrival Vital Signs — new-resident only */}
          {!resident && (
            <Field label={t("Arrival Vital Signs")} full>
              <input type="hidden" name="arrival_systolic_bp" value={arrivalSystolic} />
              <input type="hidden" name="arrival_diastolic_bp" value={arrivalDiastolic} />
              <input type="hidden" name="arrival_heart_rate" value={arrivalHr} />
              <input type="hidden" name="arrival_temperature" value={arrivalTemp} />
              <input type="hidden" name="arrival_spo2" value={arrivalSpo2} />
              <input type="hidden" name="arrival_dxt" value={arrivalDxt} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    {t("Systolic BP")} <span className="text-gray-400">(mmHg)</span>
                  </label>
                  <input
                    type="number"
                    value={arrivalSystolic}
                    onChange={(e) => { markDirty(); setArrivalSystolic(e.target.value); }}
                    step="1"
                    min="0"
                    placeholder="e.g. 120"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    {t("Diastolic BP")} <span className="text-gray-400">(mmHg)</span>
                  </label>
                  <input
                    type="number"
                    value={arrivalDiastolic}
                    onChange={(e) => { markDirty(); setArrivalDiastolic(e.target.value); }}
                    step="1"
                    min="0"
                    placeholder="e.g. 80"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    {t("HR")} <span className="text-gray-400">(bpm)</span>
                  </label>
                  <input
                    type="number"
                    value={arrivalHr}
                    onChange={(e) => { markDirty(); setArrivalHr(e.target.value); }}
                    step="1"
                    min="0"
                    placeholder="e.g. 72"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    {t("Temperature")} <span className="text-gray-400">(°C)</span>
                  </label>
                  <input
                    type="number"
                    value={arrivalTemp}
                    onChange={(e) => { markDirty(); setArrivalTemp(e.target.value); }}
                    step="0.1"
                    min="0"
                    placeholder="e.g. 36.8"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    {t("SpO2")} <span className="text-gray-400">(%)</span>
                  </label>
                  <input
                    type="number"
                    value={arrivalSpo2}
                    onChange={(e) => { markDirty(); setArrivalSpo2(e.target.value); }}
                    step="1"
                    min="0"
                    max="100"
                    placeholder="e.g. 98"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    {t("DXT")} <span className="text-gray-400">(mmol/L)</span>
                    <span className="ml-1 text-gray-400 font-normal text-xs">{t("optional")}</span>
                  </label>
                  <input
                    type="number"
                    value={arrivalDxt}
                    onChange={(e) => { markDirty(); setArrivalDxt(e.target.value); }}
                    step="0.1"
                    min="0"
                    placeholder="e.g. 5.5"
                    className={inputCls}
                  />
                </div>
              </div>
            </Field>
          )}

          {/* TCA notes */}
          <Field label={t("TCA notes")} full>
            <textarea
              name="tca_notes"
              defaultValue={resident?.tca_notes ?? ""}
              rows={2}
              placeholder={t("e.g. MOPD 1/12/2026, SOPD 21/11/2026")}
              className={inputCls}
            />
          </Field>
        </Section>

        {/* ── Attribution ───────────────────────────────────────────────── */}
        <Section title={t("Attribution")}>
          <Field label={t("Reviewed by")} required full>
            <input type="hidden" name="reviewed_by" value={reviewedBy} />
            <input type="hidden" name="reviewed_by_other" value={reviewedByOther} />
            <StaffPickerWithOther
              value={reviewedBy}
              otherName={reviewedByOther}
              onValueChange={(v) => {
                markDirty();
                setReviewedBy(v);
                if (v !== OTHERS_SENTINEL) setReviewedByOther("");
              }}
              onOtherNameChange={(v) => { markDirty(); setReviewedByOther(v); }}
              staffOptions={staffForBranch}
              disabled={!branchId}
              required
            />
          </Field>
        </Section>

        {/* ── Submit ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60 cursor-pointer"
          >
            {isPending && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isPending ? t("Saving...") : resident ? t("Save changes") : t("Create resident")}
          </button>
          {backHref !== undefined && !isPending && (
            <button
              type="button"
              onClick={handleBackClick}
              className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
            >
              {t("Cancel")}
            </button>
          )}
        </div>
      </form>
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors";

function YesNoButtons({
  value,
  onChange,
  t,
}: {
  value: "yes" | "no" | "";
  onChange: (v: "yes" | "no") => void;
  t: (s: string) => string;
}) {
  return (
    <div className="mt-1.5 flex gap-2">
      {(["yes", "no"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`min-w-[72px] px-4 py-2 text-sm rounded-lg border font-medium transition-colors cursor-pointer ${
            value === opt
              ? opt === "yes"
                ? "border-green-500 bg-green-50 text-green-700 shadow-sm"
                : "border-gray-400 bg-gray-100 text-gray-700 shadow-sm"
              : "border-gray-300 bg-white text-gray-500 hover:border-gray-400 hover:bg-gray-50"
          }`}
        >
          {opt === "yes" ? t("Yes") : t("No")}
        </button>
      ))}
    </div>
  );
}

function AllergyQuestion({
  label,
  yn,
  reaction,
  reactionPlaceholder,
  onYN,
  onReaction,
  t,
}: {
  label: string;
  yn: "yes" | "no" | "";
  reaction: string;
  reactionPlaceholder: string;
  onYN: (v: "yes" | "no") => void;
  onReaction: (v: string) => void;
  t: (s: string) => string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <YesNoButtons value={yn} onChange={onYN} t={t} />
      {yn === "yes" && (
        <input
          type="text"
          value={reaction}
          onChange={(e) => onReaction(e.target.value)}
          placeholder={reactionPlaceholder}
          className={`mt-1 ${inputCls}`}
        />
      )}
    </div>
  );
}

function QLabel({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <p className={`font-medium text-gray-700 ${small ? "text-xs text-gray-500" : "text-sm"}`}>
      {children}
    </p>
  );
}

function QGroupHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">{title}</p>
      <div className="flex-1 h-px bg-indigo-100" />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={title}
      className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
    >
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <p className="text-sm font-bold text-gray-900">{title}</p>
      </div>
      <div className="p-4 grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 md:grid-cols-3">
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`text-sm text-gray-700 ${full ? "sm:col-span-2 md:col-span-3" : ""}`}>
      <p className="font-semibold text-gray-800">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </p>
      {children}
    </div>
  );
}
