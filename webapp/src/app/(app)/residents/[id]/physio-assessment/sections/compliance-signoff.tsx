"use client";

import { PHYSIO_COMPLIANCE_OPTIONS } from "@/lib/types";
import type { LookupOption } from "@/lib/types";

type Props = {
  treatmentCompliance: string;
  setTreatmentCompliance: (v: string) => void;
  documentedBy: string;
  setDocumentedBy: (v: string) => void;
  staffOptions: LookupOption[];
};

export function ComplianceSignoff({
  treatmentCompliance,
  setTreatmentCompliance,
  documentedBy,
  setDocumentedBy,
  staffOptions,
}: Props) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-900">Treatment Compliance & Documentation</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm text-gray-700">
          Treatment Compliance & Completion
          <select
            value={treatmentCompliance}
            onChange={(e) => setTreatmentCompliance(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">Select compliance</option>
            {PHYSIO_COMPLIANCE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-gray-700">
          Documented By <span className="text-red-500">*</span>
          <select
            value={documentedBy}
            onChange={(e) => setDocumentedBy(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">Select staff</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
