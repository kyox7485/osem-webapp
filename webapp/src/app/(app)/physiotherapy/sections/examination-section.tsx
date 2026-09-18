"use client";

import { useState } from "react";
import { EXAM_STRUCTURE, POWER_OPTIONS, TONE_OPTIONS, ROM_OPTIONS, REFLEXES_OPTIONS, type ExamLimb, type ExamRow } from "@/lib/physio-scoring";
import { ScoreSelect } from "../score-select";
import { CollapsibleCard } from "../collapsible-card";
import { useTranslation } from "@/components/language-provider";

type Props = {
  examRows: ExamRow[];
  setExamRows: (rows: ExamRow[]) => void;
};

function hasScore(row: ExamRow): boolean {
  return row.power !== null || row.tone !== null || row.rom !== null || row.reflexes !== null;
}

// Generic collapsible group used for both the Upper/Lower Limb level and
// each body part (Hip, Knee, Shoulder, ...) within it. Always starts
// closed -- the therapist expands only what they mean to look at or edit,
// even when the group already carries a score (carried forward from a
// previous note). Independent per-instance open state means collapsing one
// group never affects its parent or any sibling group.
function ExamGroup({
  label,
  rows,
  labelClassName,
  children,
}: {
  label: string;
  rows: ExamRow[];
  labelClassName: string;
  children: React.ReactNode;
}) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const assessedCount = rows.filter(hasScore).length;

  return (
    <details
      open={open}
      // currentTarget, not target -- Physical Examination nests Limb inside
      // it and Region inside Limb, and a toggle on a nested <details> can
      // reach an ancestor's onToggle handler; e.target would then be the
      // descendant that actually toggled, incorrectly flipping this group's
      // own state (e.g. collapsing Hip would also collapse Lower Limb and
      // Physical Examination above it).
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="group/exam rounded-md border border-gray-200"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 hover:bg-gray-50">
        <span className={labelClassName}>{t(label)}</span>
        <span className="flex items-center gap-2">
          {assessedCount > 0 && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {assessedCount} {t("assessed")}
            </span>
          )}
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="text-gray-400 transition-transform group-open/exam:rotate-90"
          >
            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <div className="space-y-2 border-t border-gray-100 p-3">{children}</div>
    </details>
  );
}

// Power/Tone/ROM/Reflexes, Right/Left, grouped Lower Limb / Upper Limb ->
// region -> movement. Nothing here is required -- every cell can be left
// "Not assessed". Right/Left render side-by-side on desktop, stacked on
// mobile (each movement is its own compact card rather than a wide table,
// to avoid horizontal scrolling).
//
// Not every body part is assessed at the same visit, so Physical
// Examination, each limb (Upper/Lower) and each body part (Hip, Knee,
// Shoulder, etc.) within it is its own independently collapsible block --
// always closed by default, even when pre-filled. Collapsing one never
// affects its parent or siblings; the "N assessed" badge lets a therapist
// see at a glance whether a collapsed group has data without opening it.
export function ExaminationSection({ examRows, setExamRows }: Props) {
  const t = useTranslation();
  function updateCell(limb: ExamLimb, region: string, movement: string, side: "R" | "L", field: keyof ExamRow, value: number | null) {
    setExamRows(
      examRows.map((row) =>
        row.limb === limb && row.region === region && row.movement === movement && row.side === side
          ? { ...row, [field]: value }
          : row
      )
    );
  }

  function findCell(limb: ExamLimb, region: string, movement: string, side: "R" | "L") {
    return examRows.find((r) => r.limb === limb && r.region === region && r.movement === movement && r.side === side);
  }

  function limbRows(limb: ExamLimb) {
    return examRows.filter((r) => r.limb === limb);
  }

  function regionRows(limb: ExamLimb, region: string) {
    return examRows.filter((r) => r.limb === limb && r.region === region);
  }

  const assessedTotal = examRows.filter(hasScore).length;

  return (
    <CollapsibleCard title={t("Physical Examination")} badge={assessedTotal > 0 ? `${assessedTotal} ${t("assessed")}` : null}>
      <p className="mb-3 text-xs text-gray-400">
        {t('Power, Tone, ROM and Reflexes -- leave any field "Not assessed" where not applicable. Tap a body part to record it.')}
      </p>

      <div className="space-y-3">
        {(Object.keys(EXAM_STRUCTURE) as ExamLimb[]).map((limb) => (
          <ExamGroup
            key={limb}
            label={EXAM_STRUCTURE[limb].label}
            rows={limbRows(limb)}
            labelClassName="text-sm font-semibold text-gray-800"
          >
            {Object.entries(EXAM_STRUCTURE[limb].regions as Record<string, readonly string[]>).map(([region, movements]) => (
              <ExamGroup
                key={region}
                label={region}
                rows={regionRows(limb, region)}
                labelClassName="text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                {movements.map((movement) => (
                  <div key={movement} className="rounded-md border border-gray-100 p-2">
                    <p className="mb-1.5 text-sm font-medium text-gray-700">{t(movement)}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {(["R", "L"] as const).map((side) => {
                        const cell = findCell(limb, region, movement, side);
                        return (
                          <div key={side} className="rounded-md bg-gray-50 p-2">
                            <p className="mb-1 text-xs font-semibold text-gray-500">{side === "R" ? t("Right") : t("Left")}</p>
                            <div className="grid grid-cols-2 gap-2">
                              <ScoreSelect
                                label={t("Power")}
                                value={cell?.power ?? null}
                                onChange={(v) => updateCell(limb, region, movement, side, "power", v)}
                                options={POWER_OPTIONS}
                              />
                              <ScoreSelect
                                label={t("Tone")}
                                value={cell?.tone ?? null}
                                onChange={(v) => updateCell(limb, region, movement, side, "tone", v)}
                                options={TONE_OPTIONS}
                              />
                              <ScoreSelect
                                label={t("ROM")}
                                value={cell?.rom ?? null}
                                onChange={(v) => updateCell(limb, region, movement, side, "rom", v)}
                                options={ROM_OPTIONS}
                              />
                              <ScoreSelect
                                label={t("Reflexes")}
                                value={cell?.reflexes ?? null}
                                onChange={(v) => updateCell(limb, region, movement, side, "reflexes", v)}
                                options={REFLEXES_OPTIONS}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </ExamGroup>
            ))}
          </ExamGroup>
        ))}
      </div>
    </CollapsibleCard>
  );
}
