"use client";

import { useEffect, useState } from "react";
import type {
  Resident,
  LookupOption,
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

type StaffOption = LookupOption & { branch_id: number };

type Props = {
  resident?: Resident;
  nationalities: LookupOption[];
  dietTypes: LookupOption[];
  feedingTypes: LookupOption[];
  branches: LookupOption[];
  allStaff: StaffOption[];
  // The logged-in account's branch, preselected -- empty for an admin
  // account, who must pick explicitly since admins aren't scoped to one
  // branch.
  defaultBranchId: number | null;
  // Only ADMIN accounts may pick a different (nursing) branch -- everyone
  // else is locked to their own branch, which is why defaultBranchId
  // exists in the first place.
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
  defaultBranchId,
  isAdmin,
  action,
}: Props) {
  const t = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [branchId, setBranchId] = useState<string>(
    resident ? String(resident.branch_id) : defaultBranchId ? String(defaultBranchId) : ""
  );
  const [status, setStatus] = useState<string>(resident?.status ?? "ACTIVE");
  const [icNumber, setIcNumber] = useState(resident?.ic_number ?? "");
  const [nationalityId, setNationalityId] = useState<string>(
    resident?.nationality_id != null ? String(resident.nationality_id) : ""
  );
  const [age, setAge] = useState(resident?.age != null ? String(resident.age) : "");

  const staffForBranch = allStaff.filter((s) => String(s.branch_id) === branchId);
  const malaysiaId = nationalities.find((n) => n.label === "Malaysia")?.id;

  // Malaysian IC numbers encode date of birth in the first 6 digits --
  // derive age from it automatically rather than have it re-entered by
  // hand (and risk it drifting from what the IC actually says).
  useEffect(() => {
    if (malaysiaId === undefined || String(malaysiaId) !== nationalityId) return;
    const calculated = ageFromMalaysianIC(icNumber);
    if (calculated !== null) setAge(String(calculated));
  }, [icNumber, nationalityId, malaysiaId]);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    const result = await action(formData);
    if (result?.error) {
      setError(result.error);
      setSubmitting(false);
    }
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
        <Field label={t("IC number")}>
          <input name="ic_number" value={icNumber} onChange={(e) => setIcNumber(e.target.value)} className={inputCls} />
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
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Marital status")}>
          <select name="marital_status" defaultValue={resident?.marital_status ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {MARITAL_STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Nationality")}>
          <select name="nationality_id" value={nationalityId} onChange={(e) => setNationalityId(e.target.value)} className={inputCls}>
            <option value="">{t("--")}</option>
            {nationalities.map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title={t("Admission")}>
        <Field label={t("Status")}>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {RESIDENT_STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Care type")}>
          <select name="care_type" defaultValue={resident?.care_type ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {CARE_TYPE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Admission date")}>
          <input name="admission_date" type="date" defaultValue={resident?.admission_date ?? ""} className={inputCls} />
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
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Accompanied by")}>
          <select name="accompanied_by" defaultValue={resident?.accompanied_by ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {ACCOMPANIED_BY_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
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
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Hygiene")}>
          <select name="hygiene" defaultValue={resident?.hygiene ?? ""} className={inputCls}>
            <option value="">{t("--")}</option>
            {HYGIENE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
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
        <Field label={t("Past medical condition")} full>
          <textarea name="past_medical_condition" defaultValue={resident?.past_medical_condition ?? ""} rows={3} className={inputCls} />
        </Field>
        <Field label={t("Assessment and summary")} full>
          <textarea name="assessment_and_summary" defaultValue={resident?.assessment_and_summary ?? ""} rows={3} className={inputCls} />
        </Field>
        <Field label={t("Current medication list")} full>
          <textarea name="current_medication_list" defaultValue={resident?.current_medication_list ?? ""} rows={3} className={inputCls} />
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
          <select name="reviewed_by" defaultValue={resident?.reviewed_by ?? ""} required disabled={!branchId} className={inputCls}>
            <option value="" disabled>{branchId ? t("Select who's entering this") : t("Select a branch first")}</option>
            {staffForBranch.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </Field>
      </Section>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? t("Saving...") : resident ? t("Save changes") : t("Create resident")}
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
