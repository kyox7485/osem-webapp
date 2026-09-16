"use client";

import { EXAM_STRUCTURE, POWER_OPTIONS, TONE_OPTIONS, ROM_OPTIONS, REFLEXES_OPTIONS, type ExamLimb, type ExamRow } from "@/lib/physio-scoring";
import { ScoreSelect } from "../score-select";

type Props = {
  examRows: ExamRow[];
  setExamRows: (rows: ExamRow[]) => void;
};

// Power/Tone/ROM/Reflexes, Right/Left, grouped Lower Limb / Upper Limb ->
// region -> movement. Nothing here is required -- every cell can be left
// "Not assessed". Right/Left render side-by-side on desktop, stacked on
// mobile (each movement is its own compact card rather than a wide table,
// to avoid horizontal scrolling).
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

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-bold text-gray-900">Physical Examination</h2>
      <p className="mb-3 text-xs text-gray-400">Power, Tone, ROM and Reflexes -- leave any field "Not assessed" where not applicable.</p>

      <div className="space-y-3">
        {(Object.keys(EXAM_STRUCTURE) as ExamLimb[]).map((limb) => (
          <details key={limb} open className="group rounded-md border border-gray-200">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              {EXAM_STRUCTURE[limb].label}
            </summary>
            <div className="space-y-4 border-t border-gray-100 p-3">
              {Object.entries(EXAM_STRUCTURE[limb].regions as Record<string, readonly string[]>).map(([region, movements]) => (
                <div key={region}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{region}</h3>
                  <div className="space-y-2">
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
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
