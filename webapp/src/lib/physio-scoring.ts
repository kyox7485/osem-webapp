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

/**
 * The standard credit hours for a treatment type, or null when the type
 * isn't in the list (the caller then leaves the field alone). Always fed
 * from tbl_physio_treatment_types -- no value is baked in here.
 */
export function standardCreditHours(
  options: Pick<TreatmentTypeOption, "label" | "creditHours">[],
  label: string
): number | null {
  if (!label) return null;
  const match = options.find((o) => o.label === label);
  return match ? match.creditHours : null;
}

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

/**
 * The complete exam grid with `assessedRows`' values merged in, everything
 * else left null.
 *
 * Two callers need exactly this, which is why it lives here rather than
 * being written twice:
 *
 *  - The New Entry form, to carry the previous assessment's values forward
 *    into a full grid of movements to edit (the stored rows only cover the
 *    movements that were actually scored).
 *  - The review/analytics readers, so a stored assessment is scored against
 *    the SAME available-item count as a fresh one -- Assessment Coverage
 *    would otherwise be meaningless if the denominator shrank with the
 *    number of rows that happened to be persisted.
 */
export function buildFullExamGrid(assessedRows: ExamRow[] | undefined): ExamRow[] {
  const empty = buildEmptyExamRows();
  if (!assessedRows || assessedRows.length === 0) return empty;
  const byKey = new Map(assessedRows.map((r) => [`${r.limb}|${r.region}|${r.movement}|${r.side}`, r]));
  return empty.map((row) => byKey.get(`${row.limb}|${row.region}|${row.movement}|${row.side}`) ?? row);
}

/** Scores one persisted assessment against the full grid. The read-side twin of the form's live score. */
export function scoreStoredAssessment(input: {
  assessedExamRows: ExamRow[] | undefined;
  functional: FunctionalScores;
  balance: BalanceScores;
  coordination: CoordinationScores;
}): PhysioScoreResult {
  return computePhysioScoreResult(
    buildFullExamGrid(input.assessedExamRows),
    input.functional,
    input.balance,
    input.coordination
  );
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

// Maximum impairment each scale can express. These are the real per-field
// ceilings from the option lists above -- deliberately NOT one flat
// denominator, because an assessment with 100 recorded fields and one with
// 20 recorded fields must both normalize to the same 0-100% range.
export const SCORE_MAX = {
  power: 5,
  tone: 4,
  rom: 4,
  reflexes: 4,
  functional: 4,
  balance: 3,
  coordination: 4,
} as const;

export const PHYSIO_CATEGORY_KEYS = ["examination", "functional", "balance", "coordination"] as const;
export type PhysioCategoryKey = (typeof PHYSIO_CATEGORY_KEYS)[number];

export const PHYSIO_CATEGORY_LABELS: Record<PhysioCategoryKey, string> = {
  examination: "Physical Examination",
  functional: "Functional",
  balance: "Balance",
  coordination: "Coordination",
};

// One category's slice of the score. normalizedScore is null when nothing in
// that category was assessed -- never 0, which is a real reading.
export type PhysioCategoryScore = {
  rawScore: number;
  maxPossibleScore: number;
  assessedItemCount: number;
  normalizedScore: number | null;
};

// The result of one canonical scoring pass, shared verbatim by the client
// (live "Current Assessment" preview) and the server action (the value
// actually persisted), so the two can never disagree.
export type PhysioScoreResult = {
  /** Sum of assessed impairment points -- what physio_assessments.total_score stores. */
  rawScore: number;
  /** Sum of the maxima of every field that actually holds a value. */
  maxPossibleScore: number;
  /** rawScore / maxPossibleScore * 100, rounded to 1dp. null when nothing is assessed. */
  normalizedScore: number | null;
  /** How many scorable fields carry a value. */
  assessedItemCount: number;
  /** How many scorable fields exist in the grid this assessment was scored against. */
  availableItemCount: number;
  /** assessedItemCount / availableItemCount * 100, rounded to 1dp. null when there are no fields at all. */
  coveragePercent: number | null;
  categories: Record<PhysioCategoryKey, PhysioCategoryScore>;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalize(raw: number, max: number): number | null {
  if (max <= 0) return null;
  return round1((raw / max) * 100);
}

type FieldAccumulator = {
  rawScore: number;
  maxPossibleScore: number;
  assessedItemCount: number;
};

// `impairment` maps a stored grade to its impairment points (Power is
// inverted, everything else already increases with impairment) and `max` is
// that field's ceiling. A null grade contributes to neither accumulator --
// "not assessed" is never 0.
function accumulateField(
  acc: FieldAccumulator,
  grade: number | null,
  impairment: (grade: number) => number,
  max: number
): void {
  if (grade === null) return;
  acc.rawScore += impairment(grade);
  acc.maxPossibleScore += max;
  acc.assessedItemCount += 1;
}

function finishCategory(acc: FieldAccumulator): PhysioCategoryScore {
  return {
    rawScore: acc.rawScore,
    maxPossibleScore: acc.maxPossibleScore,
    assessedItemCount: acc.assessedItemCount,
    normalizedScore: normalize(acc.rawScore, acc.maxPossibleScore),
  };
}

function emptyAccumulator(): FieldAccumulator {
  return { rawScore: 0, maxPossibleScore: 0, assessedItemCount: 0 };
}

function accumulateGroup(acc: FieldAccumulator, values: (number | null)[], max: number): void {
  for (const value of values) {
    accumulateField(acc, value, (v) => v, max);
  }
}

/**
 * THE canonical physio scoring pass. Pure, synchronous, no I/O.
 *
 * The historical `total_score` column is a raw sum of assessed impairment
 * points and stays that way -- it is kept verbatim for audit/history. But a
 * raw sum is not comparable across assessments, because two assessments can
 * have very different numbers of assessed fields (20 fields scoring 20 looks
 * "better" than 100 fields scoring 50 purely on volume). The primary
 * longitudinal metric is therefore `normalizedScore`:
 *
 *     raw impairment / maximum possible impairment x 100
 *
 * with the maximum built per-field from the real scale ceilings, over only
 * the fields that actually hold a value. Higher = greater impairment among
 * the fields assessed. `coveragePercent` is a SEPARATE descriptive metric --
 * how much of the grid carries a value -- and is deliberately not folded into
 * the impairment score.
 */
export function computePhysioScoreResult(
  examRows: ExamRow[],
  functional: FunctionalScores,
  balance: BalanceScores,
  coordination: CoordinationScores
): PhysioScoreResult {
  const exam = emptyAccumulator();

  for (const row of examRows) {
    accumulateField(exam, row.power, (power) => SCORE_MAX.power - power, SCORE_MAX.power);
    accumulateField(exam, row.tone, (tone) => tone, SCORE_MAX.tone);
    accumulateField(exam, row.rom, (rom) => rom, SCORE_MAX.rom);
    accumulateField(exam, row.reflexes, (reflexes) => reflexes, SCORE_MAX.reflexes);
  }

  const functionalAcc = emptyAccumulator();
  accumulateGroup(functionalAcc, Object.values(functional), SCORE_MAX.functional);

  const balanceAcc = emptyAccumulator();
  accumulateGroup(balanceAcc, Object.values(balance), SCORE_MAX.balance);

  const coordinationAcc = emptyAccumulator();
  accumulateGroup(coordinationAcc, Object.values(coordination), SCORE_MAX.coordination);

  const rawScore = exam.rawScore + functionalAcc.rawScore + balanceAcc.rawScore + coordinationAcc.rawScore;
  const maxPossibleScore =
    exam.maxPossibleScore + functionalAcc.maxPossibleScore + balanceAcc.maxPossibleScore + coordinationAcc.maxPossibleScore;
  const assessedItemCount =
    exam.assessedItemCount + functionalAcc.assessedItemCount + balanceAcc.assessedItemCount + coordinationAcc.assessedItemCount;

  // Coverage is measured against the grid this assessment was actually scored
  // against: 4 exam fields per row, plus the fixed functional/balance/
  // coordination field counts.
  const availableItemCount = examRows.length * 4 + 5 + 4 + 4;

  return {
    rawScore,
    maxPossibleScore,
    normalizedScore: normalize(rawScore, maxPossibleScore),
    assessedItemCount,
    availableItemCount,
    coveragePercent: availableItemCount > 0 ? round1((assessedItemCount / availableItemCount) * 100) : null,
    categories: {
      examination: finishCategory(exam),
      functional: finishCategory(functionalAcc),
      balance: finishCategory(balanceAcc),
      coordination: finishCategory(coordinationAcc),
    },
  };
}

/**
 * The raw sum only -- what physio_assessments.total_score stores. Kept as the
 * exported name the server action already calls; identical value to before.
 */
export function computePhysioScore(
  examRows: ExamRow[],
  functional: FunctionalScores,
  balance: BalanceScores,
  coordination: CoordinationScores
): number {
  return computePhysioScoreResult(examRows, functional, balance, coordination).rawScore;
}
