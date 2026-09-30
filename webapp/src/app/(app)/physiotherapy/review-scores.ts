// Shared shape for the Review tab: one entry's score bundle, plus the
// precomputed bundles for a whole list.
//
// Scoring is done once on the server (page.tsx) from the persisted child
// rows via `scoreStoredAssessment` -- the client never re-derives a score,
// so there is no formula living in two places.

import type { ExamRow, PhysioScoreResult } from "@/lib/physio-scoring";

export type ReviewBodyChartFinding = { region: string; side: string | null; comment: string };

export type ReviewScores = {
  /**
   * `null` when the child rows weren't loaded for this entry -- which is the
   * deliberate case in the all-patients view, where pulling the exam grid
   * for every entry across every patient would be a much heavier query for
   * a list that's only used to spot an entry and open that patient. The
   * timeline shows "—" for these cells rather than pretending they are zero.
   */
  score: PhysioScoreResult | null;
  /** Only the movements that carry a score -- the stored rows, not the full grid. */
  examRows: ExamRow[];
  bodyChart: ReviewBodyChartFinding[];
};

export type ReviewScoresByAssessment = Record<number, ReviewScores>;
