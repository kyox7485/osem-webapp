// Exact scoring scales + descriptions transcribed from Physio MS Template.xlsx
// -- do not substitute another commonly-used clinical scale. `value: null`
// always means "not assessed", never 0 -- every dropdown built from these
// options must keep a blank/"Not assessed" choice that maps to null.

export type ScoreOption = { value: number; label: string };

function withLabels(entries: [number, string][]): ScoreOption[] {
  return entries.map(([value, description]) => ({ value, label: `${value} — ${description}` }));
}

export const POWER_OPTIONS: ScoreOption[] = withLabels([
  [0, "No contraction"],
  [1, "Flicker or trace of contraction"],
  [2, "Active movement possible only with gravity eliminated"],
  [3, "Active movement against gravity but not resistance"],
  [4, "Active movement against resistance and gravity"],
  [5, "Normal power"],
]);

export const TONE_OPTIONS: ScoreOption[] = withLabels([
  [0, "No increase in tone"],
  [1, "Slight increase in tone giving a catch when limb is moved"],
  [2, "More marked increase in tone"],
  [3, "Considerable increase in tone - passive movement difficult"],
  [4, "Limb rigid"],
]);

export const ROM_OPTIONS: ScoreOption[] = withLabels([
  [0, "Active full range of motion"],
  [1, "Passive full range of motion"],
  [2, "Active range of motion (not full)"],
  [3, "Passive range of motion (not full)"],
  [4, "Deformity"],
]);

export const REFLEXES_OPTIONS: ScoreOption[] = withLabels([
  [0, "Normal"],
  [1, "Slight reduced"],
  [2, "Markedly reduced"],
  [3, "Hyperactive"],
  [4, "Severely abnormal (e.g. Clonus)"],
]);

export const BALANCE_OPTIONS: ScoreOption[] = withLabels([
  [0, "Excellent"],
  [1, "Good"],
  [2, "Fair"],
  [3, "Poor"],
]);

export const COORDINATION_OPTIONS: ScoreOption[] = withLabels([
  [0, "Normal performance"],
  [1, "Minimum impairment, complete activity slightly less than normal control and speed"],
  [2, "Moderate impairment, able to complete activity but slow"],
  [3, "Severe impairment without movement completion"],
  [4, "Activity impossible"],
]);

export const FUNCTIONAL_OPTIONS: ScoreOption[] = withLabels([
  [0, "Independent"],
  [1, "Minimum assistance"],
  [2, "Moderate assistance"],
  [3, "Maximum assistance"],
  [4, "Unable to perform"],
]);

export type PhysioCareSetting = "IP" | "OP";

export type TreatmentTypeOption = {
  label: string;
  creditHours: number;
  dept: PhysioCareSetting;
};

// The treatment type list + credit-hour mapping used to live here as a
// hardcoded PHYSIO_TREATMENT_TYPES array. It's now stored in Supabase
// (tbl_physio_treatment_types, see lib/lookups.ts's getPhysioTreatmentTypes)
// so credit-hour bindings can be edited directly in the database -- e.g.
// changing "Full Physio (1hr)" from 1 credit hour to 2 -- without a code
// change or redeploy. This file keeps only the shared type.

// Limb -> region -> movement list, exactly as laid out in the Excel's
// Examination section (rows 48-78). Trunk sits under the Lower Limb half of
// the sheet in the source template (Bending/Rotation are genuinely sided;
// Flexors/Extensors are kept sided too for fidelity to the spec) -- kept as
// its own region here rather than nested under a limb.
export const EXAM_STRUCTURE = {
  lower: {
    label: "Lower Limb",
    regions: {
      Hip: ["Flexors", "Extensors", "Abductors", "Adductors", "Lateral Rotation", "Medial Rotation"],
      Knee: ["Flexors", "Extensors"],
      Ankle: ["Dorsi Flexors", "Plantar Flexors", "Inversors", "Eversors"],
      Foot: ["Flexors", "Extensors"],
      Trunk: ["Flexors", "Extensors", "Bending", "Rotation"],
    },
  },
  upper: {
    label: "Upper Limb",
    regions: {
      Shoulder: [
        "Flexors", "Extensors", "Abductors", "Adductors", "Lateral Rotation", "Medial Rotation",
        "Elevators", "Depressors", "Antepulsors", "Retropulsors",
      ],
      Elbow: ["Flexors", "Extensors"],
      Forearm: ["Supinators", "Pronators"],
      Wrist: ["Flexors", "Extensors"],
      Fingers: ["Flexors", "Extensors", "Abductors", "Opposition"],
    },
  },
} as const;

export type ExamLimb = keyof typeof EXAM_STRUCTURE;
export type ExamSide = "R" | "L";

export type ExamCell = {
  power: number | null;
  tone: number | null;
  rom: number | null;
  reflexes: number | null;
};

// One row per (limb, region, movement, side) -- matches physio_examinations.
export type ExamRow = {
  limb: ExamLimb;
  region: string;
  movement: string;
  side: ExamSide;
} & ExamCell;

const EMPTY_CELL: ExamCell = { power: null, tone: null, rom: null, reflexes: null };

// Builds one row per (limb, region, movement, side) from EXAM_STRUCTURE, all
// scores null -- the default grid a fresh assessment starts from.
export function buildEmptyExamRows(): ExamRow[] {
  const rows: ExamRow[] = [];
  (Object.keys(EXAM_STRUCTURE) as ExamLimb[]).forEach((limb) => {
    const regions = EXAM_STRUCTURE[limb].regions as Record<string, readonly string[]>;
    Object.entries(regions).forEach(([region, movements]) => {
      movements.forEach((movement) => {
        (["R", "L"] as ExamSide[]).forEach((side) => {
          rows.push({ limb, region, movement, side, ...EMPTY_CELL });
        });
      });
    });
  });
  return rows;
}

export type FunctionalScores = {
  supine_to_side_lying: number | null;
  side_lying_to_sitting: number | null;
  sitting_to_standing: number | null;
  sit_at_edge_of_bed: number | null;
  ambulation: number | null;
};

export type BalanceScores = {
  sitting_static: number | null;
  sitting_dynamic: number | null;
  standing_static: number | null;
  standing_dynamic: number | null;
};

export type CoordinationScores = {
  upper_limb_right: number | null;
  upper_limb_left: number | null;
  lower_limb_right: number | null;
  lower_limb_left: number | null;
};

export const EMPTY_FUNCTIONAL: FunctionalScores = {
  supine_to_side_lying: null,
  side_lying_to_sitting: null,
  sitting_to_standing: null,
  sit_at_edge_of_bed: null,
  ambulation: null,
};

export const EMPTY_BALANCE: BalanceScores = {
  sitting_static: null,
  sitting_dynamic: null,
  standing_static: null,
  standing_dynamic: null,
};

export const EMPTY_COORDINATION: CoordinationScores = {
  upper_limb_right: null,
  upper_limb_left: null,
  lower_limb_right: null,
  lower_limb_left: null,
};

function sumDefined(values: (number | null)[]): number {
  return values.reduce((total: number, v) => (v === null ? total : total + v), 0);
}

// Pure, synchronous, no I/O -- imported by both the client (live "Current
// Score" preview) and the server action (the value actually persisted), so
// the two can never disagree. Every null/unassessed field is skipped
// entirely, never coerced to 0. Power is inverted (5 - power) to match the
// Excel's hidden score column: it's the only field whose raw grade runs
// 0=worst..5=normal, opposite of every other field's 0=normal..higher=worse
// direction, so it has to be flipped before summing with the rest.
export function computePhysioScore(
  examRows: ExamRow[],
  functional: FunctionalScores,
  balance: BalanceScores,
  coordination: CoordinationScores
): number {
  let total = 0;

  for (const row of examRows) {
    if (row.power !== null) total += 5 - row.power;
    if (row.tone !== null) total += row.tone;
    if (row.rom !== null) total += row.rom;
    if (row.reflexes !== null) total += row.reflexes;
  }

  total += sumDefined(Object.values(functional));
  total += sumDefined(Object.values(balance));
  total += sumDefined(Object.values(coordination));

  return total;
}
