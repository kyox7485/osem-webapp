"use client";

import type { TreatmentTypeOption } from "@/lib/physio-scoring";
import { useTranslation } from "@/components/language-provider";

type Props = {
  residentName: string;
  icNumber: string | null;
  gender: string | null;
  age: number | null;
  entryTimestamp: string;
  setEntryTimestamp: (v: string) => void;
  treatmentTypeOptions: TreatmentTypeOption[];
  treatmentType: string;
  setTreatmentType: (v: string) => void;
  creditHours: string;
  setCreditHours: (v: string) => void;
  // "Resident" for IP, "Patient" for OP -- everything else on this card is
  // identical between care settings.
  label?: string;
};

export function ResidentInfoSection({
  residentName,
  icNumber,
  gender,
  age,
  entryTimestamp,
  setEntryTimestamp,
  treatmentTypeOptions,
  treatmentType,
  setTreatmentType,
  creditHours,
  setCreditHours,
  label,
}: Props) {
  const t = useTranslation();
  const resolvedLabel = label ?? t("Resident");
  function handleTreatmentTypeChange(value: string) {
    setTreatmentType(value);
    // Credit Hours auto-fills from the treatment type's standard value, per
    // the reference table, but stays editable afterward if the therapist
    // needs to override it.
    const match = treatmentTypeOptions.find((t) => t.label === value);
    if (match) setCreditHours(String(match.creditHours));
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-900">{resolvedLabel} / {t("Assessment Information")}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-gray-400">{resolvedLabel}</p>
          <p className="text-sm font-medium text-gray-900">{residentName}</p>
          <p className="text-xs text-gray-500">{icNumber ?? "--"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">{t("Gender")}</p>
          <p className="text-sm font-medium text-gray-900">{gender ?? "--"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">{t("Age")}</p>
          <p className="text-sm font-medium text-gray-900">{age ?? "--"}</p>
        </div>
        <label className="block text-sm text-gray-700">
          {t("Date")}
          <input
            type="datetime-local"
            value={entryTimestamp}
            onChange={(e) => setEntryTimestamp(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm text-gray-700">
          {t("Type of Treatment")}
          <select
            value={treatmentType}
            onChange={(e) => handleTreatmentTypeChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">{t("Select treatment type")}</option>
            {treatmentTypeOptions.map((opt) => (
              <option key={opt.label} value={opt.label}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-gray-700">
          {t("Credit Hours")}
          <input
            type="number"
            step="0.1"
            value={creditHours}
            onChange={(e) => setCreditHours(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
      </div>
    </div>
  );
}
