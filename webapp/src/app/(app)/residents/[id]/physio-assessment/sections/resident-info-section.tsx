"use client";

import { PHYSIO_TREATMENT_TYPE_OPTIONS } from "@/lib/types";

type Props = {
  residentName: string;
  gender: string | null;
  age: number | null;
  // Formatted server-side (page.tsx) and passed down as a plain string --
  // computing "now" independently during SSR vs client hydration would
  // reintroduce the locale/timing hydration-mismatch this app already
  // works around elsewhere (see lib/format-date.ts).
  entryDateLabel: string;
  treatmentType: string;
  setTreatmentType: (v: string) => void;
  creditHours: string;
  setCreditHours: (v: string) => void;
};

export function ResidentInfoSection({
  residentName,
  gender,
  age,
  entryDateLabel,
  treatmentType,
  setTreatmentType,
  creditHours,
  setCreditHours,
}: Props) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-900">Resident / Assessment Information</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-gray-400">Resident</p>
          <p className="text-sm font-medium text-gray-900">{residentName}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Gender</p>
          <p className="text-sm font-medium text-gray-900">{gender ?? "--"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Age</p>
          <p className="text-sm font-medium text-gray-900">{age ?? "--"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Date</p>
          <p className="text-sm font-medium text-gray-900">{entryDateLabel}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm text-gray-700">
          Type of Treatment
          <select
            value={treatmentType}
            onChange={(e) => setTreatmentType(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">Select treatment type</option>
            {PHYSIO_TREATMENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-gray-700">
          Credit Hours
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
