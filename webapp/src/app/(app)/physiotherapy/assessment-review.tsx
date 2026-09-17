"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/format-date";
import { EXAM_STRUCTURE, type ExamLimb, type ExamRow } from "@/lib/physio-scoring";
import { useTranslation } from "@/components/language-provider";

export type ReviewAssessment = {
  id: number;
  entry_timestamp: string;
  treatment_type: string | null;
  total_score: number | null;
  documented_by_name: string;
  // Only set in the "all patients" unfiltered view (no one patient picked
  // above) -- each entry needs to say whose it is once the list spans more
  // than one person.
  patient_name?: string;
  chief_complaint: string | null;
  current_history: string | null;
  past_medical_history: string | null;
  social_history: string | null;
  impression: string | null;
  plan_intervention: string | null;
  evaluation: string | null;
  treatment_compliance: string | null;
  examRows: ExamRow[];
  bodyChart: { region: string; side: string | null; comment: string }[];
};

// Past-assessment cards click to expand, same idiom as
// clinical/progress-notes-module.tsx's Review Notes tab -- summary line by
// default, full read-only detail (every section) once expanded.
export function PhysioAssessmentReview({ assessments }: { assessments: ReviewAssessment[] }) {
  const t = useTranslation();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (assessments.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
        {t("No physiotherapy assessments yet.")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assessments.map((a) => {
        const isExpanded = expandedId === a.id;
        return (
          <div
            key={a.id}
            onClick={() => setExpandedId(isExpanded ? null : a.id)}
            className="cursor-pointer rounded-md border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-200"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
              <span>{formatDateTime(a.entry_timestamp)}</span>
              {a.patient_name && <span className="font-bold text-gray-900">{a.patient_name}</span>}
              <span>{a.treatment_type ?? "--"}</span>
              <span>{t("Documented by")}: {a.documented_by_name}</span>
              <span className="font-semibold text-indigo-600">{t("Score")}: {a.total_score ?? "--"}</span>
            </div>

            {isExpanded && (
              <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 text-sm">
                <ReadRow label={t("Current History")} value={a.current_history} />
                <ReadRow label={t("Past Medical History")} value={a.past_medical_history} />
                <ReadRow label={t("Social History")} value={a.social_history} />

                {a.bodyChart.length > 0 && (
                  <div>
                    <p className="font-medium text-gray-500">{t("Body Chart Findings")}</p>
                    <ul className="ml-4 list-disc text-gray-700">
                      {a.bodyChart.map((f, i) => (
                        <li key={i}>
                          {f.region}: {f.comment}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {a.examRows.length > 0 && (
                  <div>
                    <p className="font-medium text-gray-500">{t("Physical Examination")}</p>
                    <div className="space-y-1">
                      {(Object.keys(EXAM_STRUCTURE) as ExamLimb[]).map((limb) => {
                        const rows = a.examRows.filter((r) => r.limb === limb);
                        if (rows.length === 0) return null;
                        return (
                          <div key={limb}>
                            <p className="text-xs font-semibold uppercase text-gray-400">{EXAM_STRUCTURE[limb].label}</p>
                            <ul className="ml-4 list-disc text-gray-700">
                              {rows.map((r, i) => (
                                <li key={i}>
                                  {r.region} {r.movement} ({r.side}): {t("Power")} {r.power ?? "--"}, {t("Tone")} {r.tone ?? "--"},
                                  {" "}{t("ROM")} {r.rom ?? "--"}, {t("Reflexes")} {r.reflexes ?? "--"}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <ReadRow label={t("Impression / Analysis")} value={a.impression} />
                <ReadRow label={t("Plan & Intervention")} value={a.plan_intervention} />
                <ReadRow label={t("Evaluation")} value={a.evaluation} />
                <ReadRow label={t("Treatment Compliance")} value={a.treatment_compliance} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReadRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="text-gray-700">
      <span className="font-medium text-gray-500">{label}: </span>
      {value}
    </p>
  );
}
