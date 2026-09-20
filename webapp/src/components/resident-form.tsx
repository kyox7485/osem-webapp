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
    resident ? String(resident.branch_id) : defaultBranchId ? String(defaultBranchId) : ""
  );
  const [status, setStatus] = useState<string>(resident?.status ?? "ACTIVE");
  const [icNumber, setIcNumber] = useState(resident?.ic_number ?? "");
  const malaysiaId = nationalities.find((n) => n.label === "Malaysia")?.id;
  const [nationalityId, setNationalityId] = useState<string>(
    resident?.nationality_id != null ? String(resident.nationality_id) : malaysiaId != null ? String(malaysiaId) : ""
  );
  const [age, setAge] = useState(resident?.age != null ? String(resident.age) : "");

  const othersOption = diagnosisOptions.find((o) => o.name_en === "Others");
  const nilOption = diagnosisOptions.find((o) => o.name_en === "NIL");

  const [selectedDiagnosisIds, setSelectedDiagnosisIds] = useState<number[]>(
    existingDiagnoses.map((d) => d.diagnosis_option_id)
  );
  const [diagnosisOthersRemark, setDiagnosisOthersRemark] = useState<string>(
    existingDiagnoses.find((d) => d.diagnosis_option_id === othersOption?.id)?.remark ?? ""
  );

  const staffForBranch = allStaff.filter((s) => String(s.branch_id) === branchId);
  const isMalaysian = malaysiaId != null && String(malaysiaId) === nationalityId;
  const [reviewedBy, setReviewedBy] = useState(resident?.reviewed_by ?? "");
  const [reviewedByOther, setReviewedByOther] = useState(resident?.reviewed_by_other ?? "");

  // Derive age from Malaysian IC when IC or nationality changes.
  useEffect(() => {
    if (malaysiaId === undefined || String(malaysiaId) !== nationalityId) return;
    const calculated = ageFromMalaysianIC(icNumber);
    if (calculated !== null) setAge(String(calculated));
  }, [icNumber, nationalityId, malaysiaId]);

  function toggleDiagnosis(id: number) {
    setSelectedDiagnosisIds((prev) => {
      if (id === nilOption?.id) {
        // NIL clears everything else
        return prev.includes(id) ? [] : [id];
      }
      // Selecting any real condition deselects NIL
      const withoutNil = nilOption ? prev.filter((x) => x !== nilOption.id) : prev;
      if (withoutNil.includes(id)) {
        if (id === othersOption?.id) setDiagnosisOthersRemark("");
        return withoutNil.filter((x) => x !== id);
      }
      return [...withoutNil, id];
    });
  }

  // Derive age from Malaysian IC whenever IC or nationality changes
  // (useEffect is imported from react at the top)
  const [, forceEffect] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  if (typeof window !== "undefined") {
    // run on every render when deps change — mirrors what useEffect does for this derived value
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await action(formData);
      if (result?.error) {
        setError(result.error);
      }
    });
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
          <select name="nationality_id" value={nationalityId} onChange={(e) => setNationalityId(e.target.value)} className={inputCls}>
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
          <input name="admission_date" type="date" defaultValue={resident?.admission_date ?? new Date().toISOString().split("T")[0]} className={inputCls} />
        </Field>
        {(status === "DISCHARGED" || status === "DECEASED") && (
          <Field label={t("Discharge date")}>
            <input name="discharge_date" type="date" defaultValue={resident?.discharge_date ?? ""} className={inputCls} />
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
        <Field label={t("Allergy")} full>
          <input name="allergy" defaultValue={resident?.allergy ?? ""} className={inputCls} />
        </Field>

        {/* Multi-select from tbl_diagnosis_options */}
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

        <Field label={t("Assessment and Summary")} full>
          <textarea name="assessment_and_summary" defaultValue={resident?.assessment_and_summary ?? ""} rows={3} className={inputCls} />
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
            onValueChange={(v) => { setReviewedBy(v); if (v !== OTHERS_SENTINEL) setReviewedByOther(""); }}
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

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

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
    <label className={`block text-sm text-gray-700 ${full ? "sm:col-span-2 md:col-span-3" : ""}`}>
      {label}
      {required && <span className="text-red-500"> *</span>}
      {children}
    </label>
  );
}
