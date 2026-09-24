"use client";

import { useState } from "react";
import { BodyDiagram, type BodyRegion } from "../body-diagram";
import { CollapsibleCard } from "../collapsible-card";
import { useTranslation } from "@/components/language-provider";

export type BodyChartEntry = { region: string; side: "R" | "L" | null; comment: string };

type Props = {
  findings: BodyChartEntry[];
  setFindings: (findings: BodyChartEntry[]) => void;
};

// No pain scoring -- just region + side + a free-text finding/comment, per
// spec. Tap a hotspot on the front/back/side body chart, type a comment,
// add it to the list; existing findings show below and can be removed
// before saving.
export function BodyChartSection({ findings, setFindings }: Props) {
  const t = useTranslation();
  const [pendingRegion, setPendingRegion] = useState<BodyRegion | null>(null);
  const [comment, setComment] = useState("");

  function selectRegion(region: BodyRegion) {
    setPendingRegion(region);
    setComment("");
  }

  function addFinding() {
    if (!pendingRegion || !comment.trim()) return;
    setFindings([...findings, { region: pendingRegion.name, side: pendingRegion.side, comment: comment.trim() }]);
    setPendingRegion(null);
    setComment("");
  }

  function removeFinding(index: number) {
    setFindings(findings.filter((_, i) => i !== index));
  }

  const markedRegionNames = new Set(findings.map((f) => f.region));

  return (
    <CollapsibleCard
      title={t("Body Chart / Anatomical Findings")}
      badge={findings.length > 0 ? `${findings.length} ${findings.length > 1 ? t("findings") : t("finding")}` : null}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <BodyDiagram
            onSelectRegion={selectRegion}
            markedRegionNames={markedRegionNames}
            pendingRegionName={pendingRegion?.name}
          />
          <p className="mt-2 text-center text-xs text-fg-faint">{t("Tap a point on the diagram to add a finding")}</p>

          {pendingRegion && (
            <div className="mt-3 rounded-md border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 p-3">
              <p className="mb-1 text-sm font-medium text-indigo-900 dark:text-indigo-300">{t(pendingRegion.name)}</p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder={t("Finding / comment...")}
                className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingRegion(null)}
                  className="rounded-md px-2 py-1 text-xs text-fg-subtle hover:bg-surface-strong"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="button"
                  onClick={addFinding}
                  disabled={!comment.trim()}
                  className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {t("Add finding")}
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("Recorded findings")}</h3>
          {findings.length === 0 ? (
            <p className="text-sm text-fg-faint">{t("No findings recorded yet.")}</p>
          ) : (
            <ul className="space-y-2">
              {findings.map((f, i) => (
                <li key={i} className="flex items-start justify-between gap-2 rounded-md border border-line p-2 text-sm">
                  <div>
                    <span className="font-medium text-fg">{t(f.region)}</span>
                    <p className="text-fg-muted">{f.comment}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFinding(i)}
                    className="shrink-0 text-xs text-fg-faint hover:text-red-600 dark:hover:text-red-300"
                  >
                    {t("Remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}
