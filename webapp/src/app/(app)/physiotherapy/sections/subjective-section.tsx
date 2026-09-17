"use client";

import { useTranslation } from "@/components/language-provider";

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

type Props = {
  chiefComplaint: string;
  setChiefComplaint: (v: string) => void;
  currentHistory: string;
  setCurrentHistory: (v: string) => void;
  pastMedicalHistory: string;
  socialHistory: string;
  setSocialHistory: (v: string) => void;
};

// Chief Complaint / Current History / Social History carry forward from the
// previous note and stay editable. Past Medical History always re-populates
// fresh from the resident's own record (not from a previous physio note) --
// read-only here for that reason.
export function SubjectiveSection({
  chiefComplaint,
  setChiefComplaint,
  currentHistory,
  setCurrentHistory,
  pastMedicalHistory,
  socialHistory,
  setSocialHistory,
}: Props) {
  const t = useTranslation();
  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold text-gray-900">{t("Subjective Assessment")}</h2>

      <label className="block text-sm text-gray-700">
        {t("Chief Complaint")}
        <textarea
          value={chiefComplaint}
          onChange={(e) => setChiefComplaint(e.target.value)}
          rows={2}
          className={inputCls}
        />
      </label>

      <label className="block text-sm text-gray-700">
        {t("Current History")}
        <textarea
          value={currentHistory}
          onChange={(e) => setCurrentHistory(e.target.value)}
          rows={2}
          className={inputCls}
        />
      </label>

      <label className="block text-sm text-gray-700">
        {t("Past Medical History")} <span className="font-normal text-gray-400">({t("from resident record")})</span>
        <textarea value={pastMedicalHistory} readOnly rows={2} className={`${inputCls} bg-gray-50 text-gray-600`} />
      </label>

      <label className="block text-sm text-gray-700">
        {t("Social History")}
        <textarea
          value={socialHistory}
          onChange={(e) => setSocialHistory(e.target.value)}
          rows={2}
          className={inputCls}
        />
      </label>
    </div>
  );
}
