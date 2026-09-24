"use client";

import { useTranslation } from "@/components/language-provider";

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

type Props = {
  impression: string;
  setImpression: (v: string) => void;
  planIntervention: string;
  setPlanIntervention: (v: string) => void;
  evaluation: string;
  setEvaluation: (v: string) => void;
};

// Impression/Analysis, Plan & Intervention, Evaluation -- free text, carried
// forward from the previous note but fully editable (per spec these start
// blank on a fresh assessment; page.tsx only seeds them when a previous
// note exists).
export function NarrativeSection({
  impression,
  setImpression,
  planIntervention,
  setPlanIntervention,
  evaluation,
  setEvaluation,
}: Props) {
  const t = useTranslation();
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-gray-100">{t("Impression / Analysis")}</h2>
        <textarea
          value={impression}
          onChange={(e) => setImpression(e.target.value)}
          rows={3}
          placeholder={t("Physiotherapist impression / analysis...")}
          className={inputCls}
        />
      </div>

      <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-gray-100">{t("Plan & Intervention")}</h2>
        <textarea
          value={planIntervention}
          onChange={(e) => setPlanIntervention(e.target.value)}
          rows={3}
          className={inputCls}
        />
      </div>

      <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-gray-100">{t("Evaluation")}</h2>
        <textarea
          value={evaluation}
          onChange={(e) => setEvaluation(e.target.value)}
          rows={3}
          className={inputCls}
        />
      </div>
    </div>
  );
}
