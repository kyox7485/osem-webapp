"use client";

import { useState } from "react";
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

type Props = {
  resident?: Resident;
  nationalities: LookupOption[];
  dietTypes: LookupOption[];
  feedingTypes: LookupOption[];
  action: (formData: FormData) => Promise<{ error?: string } | void>;
};

export function ResidentForm({ resident, nationalities, dietTypes, feedingTypes, action }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

      <Section title="Basic details">
        <Field label="Name" required>
          <input name="resident_name" defaultValue={resident?.resident_name} required className={inputCls} />
        </Field>
        <Field label="IC number">
          <input name="ic_number" defaultValue={resident?.ic_number ?? ""} className={inputCls} />
        </Field>
        <Field label="Age">
          <input name="age" type="number" defaultValue={resident?.age ?? ""} className={inputCls} />
        </Field>
        <Field label="Gender">
          <select name="gender" defaultValue={resident?.gender ?? ""} className={inputCls}>
            <option value="">--</option>
            {GENDER_OPTIONS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label="Marital status">
          <select name="marital_status" defaultValue={resident?.marital_status ?? ""} className={inputCls}>
            <option value="">--</option>
            {MARITAL_STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Nationality">
          <select name="nationality_id" defaultValue={resident?.nationality_id ?? ""} className={inputCls}>
            <option value="">--</option>
            {nationalities.map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Admission">
        <Field label="Status">
          <select name="status" defaultValue={resident?.status ?? "ACTIVE"} className={inputCls}>
            {RESIDENT_STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Care type">
          <select name="care_type" defaultValue={resident?.care_type ?? ""} className={inputCls}>
            <option value="">--</option>
            {CARE_TYPE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Admission date">
          <input name="admission_date" type="date" defaultValue={resident?.admission_date ?? ""} className={inputCls} />
        </Field>
        <Field label="Discharge date">
          <input name="discharge_date" type="date" defaultValue={resident?.discharge_date ?? ""} className={inputCls} />
        </Field>
        <Field label="Transfer from">
          <select name="transfer_from" defaultValue={resident?.transfer_from ?? ""} className={inputCls}>
            <option value="">--</option>
            {TRANSFER_FROM_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Accompanied by">
          <select name="accompanied_by" defaultValue={resident?.accompanied_by ?? ""} className={inputCls}>
            <option value="">--</option>
            {ACCOMPANIED_BY_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Emergency contact">
          <input name="emergency_contact" defaultValue={resident?.emergency_contact ?? ""} className={inputCls} />
        </Field>
      </Section>

      <Section title="Care">
        <Field label="Mobility">
          <select name="mobility" defaultValue={resident?.mobility ?? ""} className={inputCls}>
            <option value="">--</option>
            {MOBILITY_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Hygiene">
          <select name="hygiene" defaultValue={resident?.hygiene ?? ""} className={inputCls}>
            <option value="">--</option>
            {HYGIENE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Diet type">
          <select name="diet_type_id" defaultValue={resident?.diet_type_id ?? ""} className={inputCls}>
            <option value="">--</option>
            {dietTypes.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Feeding type">
          <select name="feeding_type_id" defaultValue={resident?.feeding_type_id ?? ""} className={inputCls}>
            <option value="">--</option>
            {feedingTypes.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Clinical notes">
        <Field label="Allergy" full>
          <input name="allergy" defaultValue={resident?.allergy ?? ""} className={inputCls} />
        </Field>
        <Field label="Past medical condition" full>
          <textarea name="past_medical_condition" defaultValue={resident?.past_medical_condition ?? ""} rows={3} className={inputCls} />
        </Field>
        <Field label="Current medication list" full>
          <textarea name="current_medication_list" defaultValue={resident?.current_medication_list ?? ""} rows={3} className={inputCls} />
        </Field>
        <Field label="TCA notes" full>
          <textarea
            name="tca_notes"
            defaultValue={resident?.tca_notes ?? ""}
            rows={2}
            placeholder="e.g. MOPD 1/12/2026, SOPD 21/11/2026"
            className={inputCls}
          />
        </Field>
        <Field label="Assessment and summary" full>
          <textarea name="assessment_and_summary" defaultValue={resident?.assessment_and_summary ?? ""} rows={3} className={inputCls} />
        </Field>
      </Section>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {submitting ? "Saving..." : resident ? "Save changes" : "Create resident"}
      </button>
    </form>
  );
}

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-md border border-gray-200 bg-white p-4">
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
