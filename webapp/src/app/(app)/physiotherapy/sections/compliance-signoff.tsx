"use client";

import { PHYSIO_COMPLIANCE_OPTIONS } from "@/lib/types";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { StaffPickerWithOther } from "@/components/staff-picker-with-other";

type Props = {
  treatmentCompliance: string;
  setTreatmentCompliance: (v: string) => void;
  documentedBy: string;
  setDocumentedBy: (v: string) => void;
  documentedByOther: string;
  setDocumentedByOther: (v: string) => void;
  staffOptions: LookupOption[];
};

export function ComplianceSignoff({
  treatmentCompliance,
  setTreatmentCompliance,
  documentedBy,
  setDocumentedBy,
  documentedByOther,
  setDocumentedByOther,
  staffOptions,
}: Props) {
  const t = useTranslation();
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">{t("Treatment Compliance & Documentation")}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          {t("Treatment Compliance & Completion")}
          <select
            value={treatmentCompliance}
            onChange={(e) => setTreatmentCompliance(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">{t("Select compliance")}</option>
            {PHYSIO_COMPLIANCE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>

        <div className="block text-sm text-gray-700 dark:text-gray-300">
          {t("Documented By")} <span className="text-red-500">*</span>
          <div className="mt-1">
            <StaffPickerWithOther
              value={documentedBy}
              otherName={documentedByOther}
              onValueChange={setDocumentedBy}
              onOtherNameChange={setDocumentedByOther}
              staffOptions={staffOptions}
              required
            />
          </div>
        </div>
      </div>
    </div>
  );
}
