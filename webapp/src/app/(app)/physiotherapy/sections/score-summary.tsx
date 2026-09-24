"use client";

import { useTranslation } from "@/components/language-provider";

type Props = {
  currentScore: number;
  previousScore: number | null;
};

// Read-only -- never manually entered. No difference/interpretation shown,
// per spec: just the two numbers.
export function ScoreSummary({ currentScore, previousScore }: Props) {
  const t = useTranslation();
  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-fg">{t("Score Summary")}</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-md bg-indigo-50 dark:bg-indigo-950/40 p-3 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-500 dark:text-indigo-400">{t("Current Score")}</p>
          <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">{currentScore}</p>
        </div>
        <div className="rounded-md bg-surface-muted p-3 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("Previous Score")}</p>
          <p className="text-2xl font-bold text-fg-secondary">{previousScore === null ? "—" : previousScore}</p>
        </div>
      </div>
    </div>
  );
}
