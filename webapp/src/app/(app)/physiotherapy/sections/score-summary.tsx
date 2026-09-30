"use client";

import { useTranslation } from "@/components/language-provider";
import type { PhysioScoreResult } from "@/lib/physio-scoring";

type Props = {
  current: PhysioScoreResult;
  previous: PhysioScoreResult | null;
};

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

// Read-only -- never manually entered, and deliberately free of any
// difference/interpretation line: no "improved", "worsened", "+X%". The
// Normalized Impairment Score and Assessment Coverage are two separate
// descriptive metrics and are never combined into one number.
export function ScoreSummary({ current, previous }: Props) {
  const t = useTranslation();

  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-fg">{t("Current Assessment")}</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t("Normalized Impairment")} value={formatPercent(current.normalizedScore)} emphasis />
        <Tile label={t("Raw Impairment")} value={`${current.rawScore} / ${current.maxPossibleScore}`} />
        <Tile label={t("Items Assessed")} value={String(current.assessedItemCount)} />
        <Tile label={t("Assessment Coverage")} value={formatPercent(current.coveragePercent)} />
      </div>

      {previous && (
        <div className="mt-4 border-t border-line-subtle pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
            {t("Previous Assessment")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Tile label={t("Normalized Impairment")} value={formatPercent(previous.normalizedScore)} />
            <Tile label={t("Raw Impairment")} value={`${previous.rawScore} / ${previous.maxPossibleScore}`} />
            <Tile label={t("Items Assessed")} value={String(previous.assessedItemCount)} />
            <Tile label={t("Assessment Coverage")} value={formatPercent(previous.coveragePercent)} />
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-md p-3 text-center ${emphasis ? "bg-indigo-50 dark:bg-indigo-950/40" : "bg-surface-muted"}`}>
      <p
        className={`text-xs font-medium uppercase tracking-wide ${
          emphasis ? "text-indigo-500 dark:text-indigo-400" : "text-fg-subtle"
        }`}
      >
        {label}
      </p>
      <p
        className={`text-2xl font-bold ${
          emphasis ? "text-indigo-700 dark:text-indigo-300" : "text-fg-secondary"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
