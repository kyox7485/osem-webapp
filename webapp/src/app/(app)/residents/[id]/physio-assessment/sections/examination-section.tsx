"use client";

import { useState } from "react";
import { EXAM_STRUCTURE, POWER_OPTIONS, TONE_OPTIONS, ROM_OPTIONS, REFLEXES_OPTIONS, type ExamLimb, type ExamRow } from "@/lib/physio-scoring";
import { ScoreSelect } from "../score-select";

type Props = {
  examRows: ExamRow[];
  setExamRows: (rows: ExamRow[]) => void;
};

function hasScore(row: ExamRow): boolean {
  return row.power !== null || row.tone !== null || row.rom !== null || row.reflexes !== null;
}

// Own open/closed state, seeded once from whether this region already has a
// score (e.g. carried forward) -- after that it's entirely up to the
// therapist. Deriving `open` straight from live examRows on every render
// would otherwise auto-close a region the moment its last remaining score
// is cleared, fighting a manual toggle mid-edit.
function ExamRegion({ region, rows, children }: { region: string; rows: ExamRow[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => rows.some(hasScore));
  const assessedCount = rows.filter(hasScore).length;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group/region rounded-md border border-gray-200"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 hover:bg-gray-50">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{region}</span>
        <span className="flex items-center gap-2">
          {assessedCount > 0 && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {assessedCount} assessed
            </span>
          )}
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="text-gray-400 transition-transform group-open/region:rotate-90"
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
// Not every body part is assessed at the same visit, so each region (Hip,
// Knee, Shoulder, etc.) is its own collapsible block -- closed by default,
// and only opened automatically if it already carries a score (carried
// forward from a previous note, or on the resident's very first exam if the
// user just expanded it). Therapists only expand what they're actually
// examining.
export function ExaminationSection({ examRows, setExamRows }: Props) {
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

  function regionRows(limb: ExamLimb, region: string) {
    return examRows.filter((r) => r.limb === limb && r.region === region);
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-bold text-gray-900">Physical Examination</h2>
      <p className="mb-3 text-xs text-gray-400">
        Power, Tone, ROM and Reflexes -- leave any field "Not assessed" where not applicable. Tap a body part to record it.
      </p>

      <div className="space-y-3">
        {(Object.keys(EXAM_STRUCTURE) as ExamLimb[]).map((limb) => (
          <details key={limb} open className="group rounded-md border border-gray-200">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              {EXAM_STRUCTURE[limb].label}
            </summary>
            <div className="space-y-2 border-t border-gray-100 p-3">
              {Object.entries(EXAM_STRUCTURE[limb].regions as Record<string, readonly string[]>).map(([region, movements]) => {
                const rows = regionRows(limb, region);
                return (
                  <ExamRegion key={region} region={region} rows={rows}>
                    {movements.map((movement) => (
                      <div key={movement} className="rounded-md border border-gray-100 p-2">
                        <p className="mb-1.5 text-sm font-medium text-gray-700">{movement}</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {(["R", "L"] as const).map((side) => {
                            const cell = findCell(limb, region, movement, side);
                            return (
                              <div key={side} className="rounded-md bg-gray-50 p-2">
                                <p className="mb-1 text-xs font-semibold text-gray-500">{side === "R" ? "Right" : "Left"}</p>
                                <div className="grid grid-cols-2 gap-2">
                                  <ScoreSelect
                                    label="Power"
                                    value={cell?.power ?? null}
                                    onChange={(v) => updateCell(limb, region, movement, side, "power", v)}
                                    options={POWER_OPTIONS}
                                  />
                                  <ScoreSelect
                                    label="Tone"
                                    value={cell?.tone ?? null}
                                    onChange={(v) => updateCell(limb, region, movement, side, "tone", v)}
                                    options={TONE_OPTIONS}
                                  />
                                  <ScoreSelect
                                    label="ROM"
                                    value={cell?.rom ?? null}
                                    onChange={(v) => updateCell(limb, region, movement, side, "rom", v)}
                                    options={ROM_OPTIONS}
                                  />
                                  <ScoreSelect
                                    label="Reflexes"
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
                  </ExamRegion>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
