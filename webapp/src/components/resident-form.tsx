"use client";

import { useTransition, useState, useEffect } from "react";
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

type StaffOption = LookupOption & { branch_id: number };

type Props = {
  resident?: Resident;
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
  activeComplaints: "", treatmentGiven: "",
  lastMeal: "", foodAfterAdmission: "", lastBowelOutput: "",
  urineCatheter: "", urineCatheterDate: "",
  feedingTube: "", feedingTubeDate: "",
};

const ARRIVAL_MODES = ["Wheelchair", "Walking", "Stretcher"] as const;

const AVPU_OPTIONS = [
  { value: "A", labelKey: "A – Alert" },
  { value: "V", labelKey: "V – Voice" },
  { value: "P", labelKey: "P – Pain" },
  { value: "U", labelKey: "U – Unresponsive" },
] as const;

// ── Compile questionnaire → single stored string ──────────────────────────────
// Compiled format is always English regardless of the UI language, so it's
// parseable and consistent for display/Telegram notifications.

function compileAllergy(a: AllergyAnswers): string {
  const lines: string[] = [];
  if (a.foodYN) {
    const base = `Food allergy: ${a.foodYN === "yes" ? "Yes" : "No"}`;
    lines.push(
      a.foodYN === "yes" && a.foodReaction.trim()
        ? `${base}; Reaction: ${a.foodReaction.trim()}`
        : base,
    );
  }
  if (a.medYN) {
    const base = `Medicine allergy: ${a.medYN === "yes" ? "Yes" : "No"}`;
    lines.push(
      a.medYN === "yes" && a.medReaction.trim()
        ? `${base}; Reaction: ${a.medReaction.trim()}`
        : base,
    );
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
    parts.push(
      a.activeComplaints === "yes" && a.treatmentGiven.trim()
        ? `${base}; Treatment given: ${a.treatmentGiven.trim()}`
        : base,
    );
  }
  add("Last meal", a.lastMeal);
  add("Food after admission", a.foodAfterAdmission);
  add("Last bowel output", a.lastBowelOutput);
  if (a.urineCatheter) {
    const base = `Urine catheter: ${a.urineCatheter === "yes" ? "Yes" : "No"}`;
    parts.push(
      a.urineCatheter === "yes" && a.urineCatheterDate
        ? `${base}; Last inserted: ${a.urineCatheterDate}`
        : base,
    );
  }
  if (a.feedingTube) {
    const base = `Feeding tube: ${a.feedingTube === "yes" ? "Yes" : "No"}`;
    parts.push(
      a.feedingTube === "yes" && a.feedingTubeDate
        ? `${base}; Last inserted: ${a.feedingTubeDate}`
        : base,
    );
  }
  return parts.join("\n");
}

// ── Parse compiled text back into questionnaire fields (for edit mode) ────────
// Returns null if the text doesn't match the questionnaire format, triggering
// a plain textarea fallback so old free-text data isn't silently overwritten.

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
  // At least one structured key must be present; otherwise treat as legacy free-text
  if (!arrivalTime && !modeOfArrival && !avpu && !cough && !fever) return null;
  const complaintsM = text.match(/^Active complaints: (Yes|No)(?:; Treatment given: (.+))?$/m);
  const cathM = text.match(/^Urine catheter: (Yes|No)(?:; Last inserted: (.+))?$/m);
  const tubeM = text.match(/^Feeding tube: (Yes|No)(?:; Last inserted: (.+))?$/m);
  return {
    arrivalTime,
    modeOfArrival,
    avpu,
    cough: toYN(cough),
    fever: toYN(fever),
    pain: toYN(getLine("Pain")),
    activeComplaints: complaintsM ? (complaintsM[1] === "Yes" ? "yes" : "no") : "",
    treatmentGiven: complaintsM?.[2]?.trim() ?? "",
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
}: Props) {
  const t = useTranslation();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string>(
    resident ? String(resident.branch_id) : defaultBranchId ? String(defaultBranchId) : "",
  );
  const [status, setStatus] = useState<string>(resident?.status ?? "ACTIVE");
  const [icNumber, setIcNumber] = useState(resident?.ic_number ?? "");
  const malaysiaId = nationalities.find((n) => n.label === "Malaysia")?.id;
  const [nationalityId, setNationalityId] = useState<string>(
    resident?.nationality_id != null
      ? String(resident.nationality_id)
      : malaysiaId != null
        ? String(malaysiaId)
        : "",
  );
  const [age, setAge] = useState(resident?.age != null ? String(resident.age) : "");

  const othersOption = diagnosisOptions.find((o) => o.name_en === "Others");
  const nilOption = diagnosisOptions.find((o) => o.name_en === "NIL");
  const [selectedDiagnosisIds, setSelectedDiagnosisIds] = useState<number[]>(
    existingDiagnoses.map((d) => d.diagnosis_option_id),
  );
  const [diagnosisOthersRemark, setDiagnosisOthersRemark] = useState<string>(
    existingDiagnoses.find((d) => d.diagnosis_option_id === othersOption?.id)?.remark ?? "",
  );

  const staffForBranch = allStaff.filter((s) => String(s.branch_id) === branchId);
  const isMalaysian = malaysiaId != null && String(malaysiaId) === nationalityId;
  const [reviewedBy, setReviewedBy] = useState(resident?.reviewed_by ?? "");
  const [reviewedByOther, setReviewedByOther] = useState(resident?.reviewed_by_other ?? "");

  // Allergy questionnaire — falls back to plain textarea when existing text
  // doesn't match the structured format (legacy free-text entries).
  const parsedAllergy = resident?.allergy ? parseAllergyText(resident.allergy) : null;
  const allergyIsFallback = !!resident?.allergy && !parsedAllergy;
  const [allergyQ, setAllergyQ] = useState<AllergyAnswers>(parsedAllergy ?? EMPTY_ALLERGY);

  // Assessment questionnaire — same fallback pattern.
  const parsedAssessment = resident?.assessment_and_summary
    ? parseAssessmentText(resident.assessment_and_summary)
    : null;
  const assessmentIsFallback = !!resident?.assessment_and_summary && !parsedAssessment;
  const [assessmentQ, setAssessmentQ] = useState<AssessmentAnswers>(
    parsedAssessment ?? EMPTY_ASSESSMENT,
  );

  // Derive age from Malaysian IC when IC or nationality changes.
  useEffect(() => {
    if (malaysiaId === undefined || String(malaysiaId) !== nationalityId) return;
    const calculated = ageFromMalaysianIC(icNumber);
    if (calculated !== null) setAge(String(calculated));
  }, [icNumber, nationalityId, malaysiaId]);

  function toggleDiagnosis(id: number) {
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

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await action(formData);
      if (result?.error) setError(result.error);
    });
  }

  function allergySet<K extends keyof AllergyAnswers>(key: K, val: AllergyAnswers[K]) {
    setAllergyQ((prev) => ({ ...prev, [key]: val }));
  }
  function assessSet<K extends keyof AssessmentAnswers>(key: K, val: AssessmentAnswers[K]) {
    setAssessmentQ((prev) => ({ ...prev, [key]: val }));
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <Section title={t("Basic details")}>
        <Field label={t("Name")} required>
          <input name="resident_name" defaultValue={resident?.resident_name} required className={inputCls} />
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
          <select name="gender" defaultValue={resident?.gender ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {GENDER_OPTIONS.map((g) => (
              <option key={g} value={g}>{t(g)}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Marital status")}>
          <select name="marital_status" defaultValue={resident?.marital_status ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {MARITAL_STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>{t(o)}</option>
            ))}
          </select>
        </Field>
      </Section>

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
          <select name="care_type" defaultValue={resident?.care_type ?? ""} className={inputCls}>
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
        {(status === "DISCHARGED" || status === "DECEASED") && (
          <Field label={t("Discharge date")}>
            <input
              name="discharge_date"
              type="date"
              defaultValue={resident?.discharge_date ?? ""}
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
            defaultValue={resident?.emergency_contact ?? ""}
            rows={2}
            placeholder={t("e.g. Jasmin (Daughter) - 012-4948717")}
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title={t("Care")}>
        <Field label={t("Mobility")}>
          <select name="mobility" defaultValue={resident?.mobility ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {MOBILITY_OPTIONS.map((o) => (
              <option key={o} value={o}>{t(o)}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Hygiene")}>
          <select name="hygiene" defaultValue={resident?.hygiene ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {HYGIENE_OPTIONS.map((o) => (
              <option key={o} value={o}>{t(o)}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Diet type")}>
          <select name="diet_type_id" defaultValue={resident?.diet_type_id ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {dietTypes.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Feeding type")}>
          <select name="feeding_type_id" defaultValue={resident?.feeding_type_id ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {feedingTypes.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title={t("Clinical notes")}>

        {/* ── Allergy questionnaire ───────────────────────────────────────── */}
        <Field label={t("Allergy")} full>
          {allergyIsFallback ? (
            // Existing resident with old free-text data — preserve as-is
            <textarea name="allergy" defaultValue={resident!.allergy ?? ""} rows={2} className={inputCls} />
          ) : (
            <>
              <input type="hidden" name="allergy" value={compileAllergy(allergyQ)} />
              <div className="mt-2 space-y-4">
                <AllergyQuestion
                  label={t("Is patient having any food allergy?")}
                  yn={allergyQ.foodYN}
                  reaction={allergyQ.foodReaction}
                  reactionPlaceholder={t("What is the reaction?")}
                  onYN={(v) => allergySet("foodYN", v)}
                  onReaction={(v) => allergySet("foodReaction", v)}
                  t={t}
                />
                <AllergyQuestion
                  label={t("Is patient having any medicine allergy?")}
                  yn={allergyQ.medYN}
                  reaction={allergyQ.medReaction}
                  reactionPlaceholder={t("What is the reaction?")}
                  onYN={(v) => allergySet("medYN", v)}
                  onReaction={(v) => allergySet("medReaction", v)}
                  t={t}
                />
              </div>
            </>
          )}
        </Field>

        {/* ── Known history of Medical/Surgical Condition ─────────────────── */}
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
          <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {diagnosisOptions.map((opt) => {
              const checked = selectedDiagnosisIds.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                    checked
                      ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
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
              onChange={(e) => setDiagnosisOthersRemark(e.target.value)}
              placeholder={t("Please specify...")}
              className={`mt-2 ${inputCls}`}
            />
          )}
        </Field>

        {/* ── Assessment and Summary questionnaire ────────────────────────── */}
        <Field label={t("Assessment and Summary")} full>
          {assessmentIsFallback ? (
            // Existing resident with old free-text data — preserve as-is
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
              <div className="mt-3 space-y-5">

                {/* Group: Arrival */}
                <div className="space-y-3">
                  <QGroupHeader title={t("Arrival")} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-sm text-gray-700">{t("Arrive at what time?")}</p>
                      <input
                        type="time"
                        value={assessmentQ.arrivalTime}
                        onChange={(e) => assessSet("arrivalTime", e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <p className="text-sm text-gray-700">{t("Mode of arrival")}</p>
                      <div className="mt-1 flex gap-2 flex-wrap">
                        {ARRIVAL_MODES.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() =>
                              assessSet(
                                "modeOfArrival",
                                assessmentQ.modeOfArrival === mode ? "" : mode,
                              )
                            }
                            className={`px-3 py-1 text-sm rounded-full border font-medium transition-colors ${
                              assessmentQ.modeOfArrival === mode
                                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                                : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                            }`}
                          >
                            {t(mode)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Group: Clinical status on arrival */}
                <div className="space-y-3">
                  <QGroupHeader title={t("Clinical status on arrival")} />
                  <div>
                    <p className="text-sm text-gray-700">{t("AVPU status")}</p>
                    <select
                      value={assessmentQ.avpu}
                      onChange={(e) => assessSet("avpu", e.target.value)}
                      className={inputCls}
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
                        <p className="text-sm text-gray-700">{label}</p>
                        <YesNoButtons
                          value={assessmentQ[key]}
                          onChange={(v) => assessSet(key, v)}
                          t={t}
                        />
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-sm text-gray-700">{t("Any other active complaints?")}</p>
                    <YesNoButtons
                      value={assessmentQ.activeComplaints}
                      onChange={(v) => assessSet("activeComplaints", v)}
                      t={t}
                    />
                    {assessmentQ.activeComplaints === "yes" && (
                      <input
                        type="text"
                        value={assessmentQ.treatmentGiven}
                        onChange={(e) => assessSet("treatmentGiven", e.target.value)}
                        placeholder={t("Any treatment given?")}
                        className={`mt-2 ${inputCls}`}
                      />
                    )}
                  </div>
                </div>

                {/* Group: Nutrition & elimination */}
                <div className="space-y-3">
                  <QGroupHeader title={t("Nutrition & elimination")} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-sm text-gray-700">{t("When is the last meal taken?")}</p>
                      <input
                        type="text"
                        value={assessmentQ.lastMeal}
                        onChange={(e) => assessSet("lastMeal", e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <p className="text-sm text-gray-700">{t("Any food served after the admission?")}</p>
                      <input
                        type="text"
                        value={assessmentQ.foodAfterAdmission}
                        onChange={(e) => assessSet("foodAfterAdmission", e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <p className="text-sm text-gray-700">{t("When is last bowel output?")}</p>
                      <input
                        type="text"
                        value={assessmentQ.lastBowelOutput}
                        onChange={(e) => assessSet("lastBowelOutput", e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-gray-700">{t("Is patient on urine catheter?")}</p>
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
                        <p className="text-xs text-gray-500">{t("When was it last inserted?")}</p>
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
                    <p className="text-sm text-gray-700">{t("Is patient on feeding tube?")}</p>
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
                        <p className="text-xs text-gray-500">{t("When was it last inserted?")}</p>
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

              </div>
            </>
          )}
        </Field>

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

      <Section title={t("Attribution")}>
        <Field label={t("Reviewed by")} required full>
          <input type="hidden" name="reviewed_by" value={reviewedBy} />
          <input type="hidden" name="reviewed_by_other" value={reviewedByOther} />
          <StaffPickerWithOther
            value={reviewedBy}
            otherName={reviewedByOther}
            onValueChange={(v) => {
              setReviewedBy(v);
              if (v !== OTHERS_SENTINEL) setReviewedByOther("");
            }}
            onOtherNameChange={setReviewedByOther}
            staffOptions={staffForBranch}
            disabled={!branchId}
            required
          />
        </Field>
      </Section>

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
      >
        {isPending && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {isPending ? t("Saving...") : resident ? t("Save changes") : t("Create resident")}
      </button>
    </form>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

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
    <div className="mt-1 flex gap-2">
      {(["yes", "no"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`min-w-[64px] px-4 py-1 text-sm rounded-full border font-medium transition-colors ${
            value === opt
              ? opt === "yes"
                ? "border-green-500 bg-green-50 text-green-700"
                : "border-gray-400 bg-gray-100 text-gray-700"
              : "border-gray-300 bg-white text-gray-500 hover:border-gray-400"
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
      <p className="text-sm text-gray-700">{label}</p>
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

function QGroupHeader({ title }: { title: string }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 pb-1">
      {title}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <legend className="px-1 text-sm font-medium text-gray-900">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">{children}</div>
    </fieldset>
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
      <p className="font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </p>
      {children}
    </div>
  );
}
