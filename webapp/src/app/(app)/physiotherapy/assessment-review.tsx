"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate, formatDateTime } from "@/lib/format-date";
import {
  EXAM_STRUCTURE,
  PHYSIO_CATEGORY_KEYS,
  PHYSIO_CATEGORY_LABELS,
  type ExamLimb,
  type PhysioCategoryKey,
} from "@/lib/physio-scoring";
import { useTranslation } from "@/components/language-provider";
import { PdfDownloadLink } from "@/components/pdf-download-link";
import { AdminRecordControls } from "@/components/admin-record-controls";
import type { ReviewScores, ReviewScoresByAssessment } from "./review-scores";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { X } from "lucide-react";

export type ReviewAssessment = {
  id: number;
  entry_timestamp: string;
  treatment_type: string | null;
  credit_hours: number | null;
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
};

type DurPreset = "1m" | "3m" | "6m" | "1y" | "all" | "custom";

const DUR_PRESETS: { key: DurPreset; label: string }[] = [
  { key: "1m", label: "1 Month" },
  { key: "3m", label: "3 Months" },
  { key: "6m", label: "6 Months" },
  { key: "1y", label: "1 Year" },
  { key: "all", label: "All History" },
  { key: "custom", label: "Custom" },
];

const PRESET_MONTHS: Record<Exclude<DurPreset, "all" | "custom">, number> = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };

function getMytToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
}

// UTC arithmetic, deliberately: `new Date(y, m, d)` builds in the RUNTIME's
// local zone, which differs between the Node server and the browser and could
// shift the cutoff by a day -- the cutoff decides which points the trend
// renders, so a mismatch here would be a hydration mismatch. Malaysia has no
// DST, so UTC here is a plain date shift with no zone semantics to lose.
function subtractMonths(months: number, fromDate: string): string {
  const [y, m, d] = fromDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 - months, d));
  return shifted.toISOString().slice(0, 10);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function rawRange(score: { rawScore: number; maxPossibleScore: number } | null): string {
  return score ? `${score.rawScore} / ${score.maxPossibleScore}` : "—";
}

/**
 * Review Notes for the physiotherapy module: a Normalized Impairment trend,
 * the latest assessment's summary, and a clinical timeline that opens the
 * full assessment detail on click.
 *
 * Nothing here interprets the numbers -- no improved/worsened wording, no
 * invented clinical thresholds. The only hint about a partial grid is a
 * neutral, factual note. Every score arrives precomputed from the server
 * (see review-scores.ts) so the client never re-derives one.
 */
export function PhysioAssessmentReview({
  assessments,
  scoresByAssessment,
  residentId,
}: {
  assessments: ReviewAssessment[];
  scoresByAssessment: ReviewScoresByAssessment;
  residentId: number | null;
}) {
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [activeDur, setActiveDur] = useState<DurPreset>("1m");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // "assessments" arrives newest-first (ORDER BY entry_timestamp DESC); the
  // trend plots oldest-to-newest so the line reads left to right.
  const chronologically = useMemo(() => [...assessments].reverse(), [assessments]);
  const latest = chronologically[chronologically.length - 1] ?? null;

  const trendPoints = useMemo(() => {
    const today = getMytToday();
    let from: number | null = null;
    let to: number | null = null;

    if (activeDur !== "all" && activeDur !== "custom") {
      from = new Date(`${subtractMonths(PRESET_MONTHS[activeDur], today)}T00:00:00+08:00`).getTime();
    } else if (activeDur === "custom") {
      // With only one of the two dates filled in there is no closed range to
      // filter on, so the whole history stays on screen rather than silently
      // narrowing to a half-open window.
      if (customStart && customEnd) {
        from = new Date(`${customStart}T00:00:00+08:00`).getTime();
        to = new Date(`${customEnd}T23:59:59+08:00`).getTime();
      }
    }

    return chronologically
      .filter((a) => {
        if (scoresByAssessment[a.id]?.score?.normalizedScore === null || scoresByAssessment[a.id]?.score === null) {
          return false;
        }
        const time = new Date(a.entry_timestamp).getTime();
        if (from !== null && time < from) return false;
        if (to !== null && time > to) return false;
        return true;
      })
      .map((a) => {
        const score = scoresByAssessment[a.id].score!;
        return {
          assessment: a,
          normalizedScore: score.normalizedScore as number,
          coveragePercent: score.coveragePercent,
          rawScore: score.rawScore,
          maxPossibleScore: score.maxPossibleScore,
        };
      });
  }, [chronologically, scoresByAssessment, activeDur, customStart, customEnd]);

  if (assessments.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-fg-faint">
        {t("No physiotherapy assessments yet.")}
      </div>
    );
  }

  const openDetail = (id: number) => guardedAction(() => setDetailId(id));

  return (
    <div className="space-y-4">
      {/* ── A. Normalized Impairment Trend ─────────────────────────────── */}
      {/* A per-patient trend only makes sense once one patient is picked:
          in the all-patients view the list spans many people and a single
          line through their scores would be meaningless. */}
      {residentId !== null && (
        <section className="rounded-md border border-line bg-surface p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-fg">{t("Normalized Impairment Trend")}</h3>
          <div className="flex flex-wrap gap-2">
            {DUR_PRESETS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveDur(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeDur === key
                    ? "bg-indigo-600 text-white"
                    : "bg-surface-muted text-fg-secondary hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300"
                }`}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        {activeDur === "custom" && (
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="physio-trend-start" className="mb-1 block text-xs font-medium text-fg-secondary">
                {t("Start date")}
              </label>
              <input
                type="date"
                id="physio-trend-start"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-1.5 text-xs text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="physio-trend-end" className="mb-1 block text-xs font-medium text-fg-secondary">
                {t("End date")}
              </label>
              <input
                type="date"
                id="physio-trend-end"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-1.5 text-xs text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        )}

        {trendPoints.length < 2 ? (
          <p className="py-6 text-center text-xs text-fg-faint">
            {t("Not enough scored assessments in this period to draw a trend.")}
          </p>
        ) : (
          <TrendChart points={trendPoints} t={t} />
        )}

        <p className="mt-2 text-[11px] text-fg-faint">
          {t("Higher normalized impairment = greater impairment among the fields assessed. Coverage is descriptive only.")}
        </p>
      </section>
      )}

      {/* ── B. Latest Assessment Summary ───────────────────────────────── */}
      {residentId !== null && latest && (
        <LatestSummary assessment={latest} scoresByAssessment={scoresByAssessment} t={t} />
      )}

      {/* ── C. Clinical Timeline ───────────────────────────────────────── */}
      <section className="rounded-md border border-line bg-surface shadow-sm">
        <h3 className="border-b border-line-subtle px-4 py-3 text-sm font-bold text-fg">{t("Clinical Timeline")}</h3>

        {/* Desktop: the full 9-column grid. The mobile list below is a
            second rendering of the same entries rather than a responsive
            re-flow of this table, so the page itself never scrolls
            sideways at narrow widths. */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line-subtle text-fg-subtle">
                <th className="px-4 py-2 font-semibold">{t("Date / Time")}</th>
                {/* In the unfiltered view every row is a different person,
                    so the name is what distinguishes them. */}
                {residentId === null && <th className="px-4 py-2 font-semibold">{t("Patient")}</th>}
                <th className="px-4 py-2 font-semibold">{t("Normalized")}</th>
                <th className="px-4 py-2 font-semibold">{t("Coverage")}</th>
                <th className="px-4 py-2 font-semibold">{t("Raw Score")}</th>
                <th className="px-4 py-2 font-semibold">{t("Treatment")}</th>
                <th className="px-4 py-2 font-semibold">{t("Functional")}</th>
                <th className="px-4 py-2 font-semibold">{t("Balance")}</th>
                <th className="px-4 py-2 font-semibold">{t("Coordination")}</th>
                <th className="px-4 py-2 font-semibold">{t("Clinical Note")}</th>
              </tr>
            </thead>
            <tbody>
              {assessments.map((a) => {
                const score = scoresByAssessment[a.id]?.score ?? null;
                return (
                  <tr
                    key={a.id}
                    tabIndex={0}
                    role="button"
                    onClick={() => openDetail(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDetail(a.id);
                      }
                    }}
                    className="cursor-pointer border-b border-line-subtle transition-colors last:border-b-0 hover:bg-hover"
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-fg">{formatDateTime(a.entry_timestamp)}</td>
                    {residentId === null && (
                      <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">{a.patient_name ?? "--"}</td>
                    )}
                    <td className="whitespace-nowrap px-4 py-2 font-semibold text-indigo-600 dark:text-indigo-400">
                      {percent(score?.normalizedScore ?? null)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-fg-secondary">{percent(score?.coveragePercent ?? null)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-fg-secondary">{rawRange(score)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-fg-secondary">{a.treatment_type ?? "--"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-fg-secondary">
                      {percent(score?.categories.functional.normalizedScore ?? null)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-fg-secondary">
                      {percent(score?.categories.balance.normalizedScore ?? null)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-fg-secondary">
                      {percent(score?.categories.coordination.normalizedScore ?? null)}
                    </td>
                    <td className="px-4 py-2 text-fg-secondary">
                      <ClampedText value={a.chief_complaint ?? a.current_history} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <ul className="divide-y divide-line-subtle lg:hidden">
          {assessments.map((a) => {
            const score = scoresByAssessment[a.id]?.score ?? null;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => openDetail(a.id)}
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-hover"
                >
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-fg">{formatDateTime(a.entry_timestamp)}</span>
                    <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                      {percent(score?.normalizedScore ?? null)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-secondary">
                    {a.patient_name && <span className="font-medium text-fg">{a.patient_name}</span>}
                    <span>{a.treatment_type ?? "--"}</span>
                    <span>
                      {t("Coverage")}: {percent(score?.coveragePercent ?? null)}
                    </span>
                    <span>
                      {t("Raw Score")}: {rawRange(score)}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <ClampedText value={a.chief_complaint ?? a.current_history} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {detailId !== null && assessments.some((a) => a.id === detailId) && (
        <AssessmentDetailModal
          assessment={assessments.find((a) => a.id === detailId)!}
          scores={scoresByAssessment[detailId] ?? null}
          onClose={() => setDetailId(null)}
          t={t}
        />
      )}
    </div>
  );
}

// ── A. Trend chart ────────────────────────────────────────────────────────

type TrendPoint = {
  assessment: ReviewAssessment;
  normalizedScore: number;
  coveragePercent: number | null;
  rawScore: number;
  maxPossibleScore: number;
};

// One point per actual assessment date, placed at its real timestamp -- no
// empty daily rows to fill in. Fixed 0-100% y domain so the shape is
// comparable across durations and patients. The tooltip states the date and
// the three numbers and stops there.
function TrendChart({ points, t }: { points: TrendPoint[]; t: (key: string) => string }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const W = 720;
  const H = 180;
  const PAD = { top: 12, right: 12, bottom: 24, left: 32 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // X is the real timestamp, so a gap between two visits reads as a gap rather
  // than being smoothed away. Two assessments on the same day (or several in
  // one session) collapse onto one x, which is why the dots are layered in
  // reverse chronological order -- the most recent sits on top and stays
  // clickable.
  const times = points.map((p) => new Date(p.assessment.entry_timestamp).getTime());
  const minTime = Math.min(...times);
  const span = Math.max(...times) - minTime;

  const x = (i: number) => (span === 0 ? PAD.left + plotW / 2 : PAD.left + ((times[i] - minTime) / span) * plotW);
  const y = (value: number) => PAD.top + plotH - (value / 100) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.normalizedScore)}`).join(" ");

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={t("Normalized Impairment Trend")}
      >
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-line-subtle" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="fill-fg-faint text-[10px]">
              {v}
            </text>
          </g>
        ))}

        <path d={path} fill="none" className="stroke-indigo-500" strokeWidth={2} strokeLinejoin="round" />

        {points
          .map((p, i) => ({ p, i }))
          .reverse()
          .map(({ p, i }) => (
            <g key={p.assessment.id}>
              <circle cx={x(i)} cy={y(p.normalizedScore)} r={hovered === i ? 5 : 3.5} className="fill-indigo-500" />
              {/* Invisible hit target sized to the space around the dot --
                  a 3.5px dot is far too small to hover or tap on its own. */}
              <circle
                cx={x(i)}
                cy={y(p.normalizedScore)}
                r={Math.max(10, plotW / Math.max(points.length * 2, 12))}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${formatDate(p.assessment.entry_timestamp)} — ${p.normalizedScore}%`}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
              />
            </g>
          ))}

        <text x={PAD.left} y={H - 6} className="fill-fg-faint text-[10px]">
          {formatDate(points[0].assessment.entry_timestamp)}
        </text>
        {points.length > 1 && (
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-fg-faint text-[10px]">
            {formatDate(points[points.length - 1].assessment.entry_timestamp)}
          </text>
        )}
      </svg>

      {hovered !== null && <TrendTooltip point={points[hovered]} t={t} />}
    </div>
  );
}

function TrendTooltip({ point, t }: { point: TrendPoint; t: (key: string) => string }) {
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 w-52 rounded-md border border-line bg-elevated p-2.5 shadow-lg">
      <p className="mb-1.5 text-xs font-bold text-fg">{formatDateTime(point.assessment.entry_timestamp)}</p>
      <div className="space-y-1">
        <TooltipRow label={t("Normalized Impairment")} value={percent(point.normalizedScore)} />
        <TooltipRow label={t("Coverage")} value={percent(point.coveragePercent)} />
        <TooltipRow label={t("Raw Score")} value={`${point.rawScore} / ${point.maxPossibleScore}`} />
      </div>
    </div>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </div>
  );
}

// ── B. Latest assessment summary ──────────────────────────────────────────

function LatestSummary({
  assessment,
  scoresByAssessment,
  t,
}: {
  assessment: ReviewAssessment;
  scoresByAssessment: ReviewScoresByAssessment;
  t: (key: string) => string;
}) {
  const score = scoresByAssessment[assessment.id]?.score ?? null;
  if (!score) return null;

  const assessedCategories = PHYSIO_CATEGORY_KEYS.filter((key) => score.categories[key].assessedItemCount > 0);

  return (
    <section className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-fg">{t("Latest Assessment Summary")}</h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label={t("Date / Time")} value={formatDateTime(assessment.entry_timestamp)} />
        <SummaryTile label={t("Treatment")} value={assessment.treatment_type ?? "--"} />
        <SummaryTile
          label={t("Credit Hours")}
          value={assessment.credit_hours === null ? "--" : String(assessment.credit_hours)}
        />
        <SummaryTile label={t("Documented by")} value={assessment.documented_by_name} />
        <SummaryTile label={t("Normalized Impairment")} value={percent(score.normalizedScore)} emphasis />
        <SummaryTile label={t("Assessment Coverage")} value={percent(score.coveragePercent)} />
        <SummaryTile label={t("Raw Score")} value={rawRange(score)} />
        <SummaryTile
          label={t("Items Assessed")}
          value={`${score.assessedItemCount} / ${score.availableItemCount}`}
        />
      </div>

      {/* Neutral, factual note only -- no clinical threshold is implied. */}
      {score.coveragePercent !== null && score.coveragePercent < 100 && (
        <p className="mt-2 text-[11px] text-fg-faint">
          {t("Coverage is partial — some fields in this assessment have no recorded value.")}
        </p>
      )}

      {assessedCategories.length > 0 && (
        <div className="mt-4 border-t border-line-subtle pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{t("Category Breakdown")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {assessedCategories.map((key) => (
              <CategoryTile key={key} categoryKey={key} category={score.categories[key]} t={t} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CategoryTile({
  categoryKey,
  category,
  t,
}: {
  categoryKey: PhysioCategoryKey;
  category: { rawScore: number; maxPossibleScore: number; assessedItemCount: number; normalizedScore: number | null };
  t: (key: string) => string;
}) {
  return (
    <div className="rounded-md bg-surface-muted p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
        {t(PHYSIO_CATEGORY_LABELS[categoryKey])}
      </p>
      <p className="text-lg font-bold text-fg">{percent(category.normalizedScore)}</p>
      <p className="text-[11px] text-fg-faint">
        {t("Raw Score")} {category.rawScore} / {category.maxPossibleScore}
      </p>
      <p className="text-[11px] text-fg-faint">
        {t("Items Assessed")} {category.assessedItemCount}
      </p>
    </div>
  );
}

function SummaryTile({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-md p-3 ${emphasis ? "bg-indigo-50 dark:bg-indigo-950/40" : "bg-surface-muted"}`}>
      <p
        className={`text-xs font-medium uppercase tracking-wide ${
          emphasis ? "text-indigo-500 dark:text-indigo-400" : "text-fg-subtle"
        }`}
      >
        {label}
      </p>
      <p
        className={`truncate text-sm font-semibold ${emphasis ? "text-indigo-700 dark:text-indigo-300" : "text-fg"}`}
      >
        {value}
      </p>
    </div>
  );
}

// ── C. Full assessment detail ─────────────────────────────────────────────

function AssessmentDetailModal({
  assessment,
  scores,
  onClose,
  t,
}: {
  assessment: ReviewAssessment;
  scores: ReviewScores | null;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const score = scores?.score ?? null;
  const examRows = scores?.examRows ?? [];
  const bodyChart = scores?.bodyChart ?? [];

  // Escape closes, matching the read-detail idiom this panel replaced.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("Assessment Detail")}
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-4xl rounded-md border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-fg">{t("Assessment Detail")}</h2>
          <div className="flex shrink-0 items-center gap-3">
            <PdfDownloadLink href={`/api/reports/physio-assessment?id=${assessment.id}`} />
            <button
              type="button"
              onClick={onClose}
              aria-label={t("Close")}
              className="rounded-md p-1 text-fg-faint transition-colors hover:bg-hover hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label={t("Date / Time")} value={formatDateTime(assessment.entry_timestamp)} />
          <SummaryTile label={t("Treatment")} value={assessment.treatment_type ?? "--"} />
          <SummaryTile
            label={t("Credit Hours")}
            value={assessment.credit_hours === null ? "--" : String(assessment.credit_hours)}
          />
          <SummaryTile label={t("Documented by")} value={assessment.documented_by_name} />
          <SummaryTile label={t("Normalized Impairment")} value={percent(score?.normalizedScore ?? null)} emphasis />
          <SummaryTile label={t("Assessment Coverage")} value={percent(score?.coveragePercent ?? null)} />
          <SummaryTile label={t("Raw Score")} value={rawRange(score)} />
          <SummaryTile
            label={t("Items Assessed")}
            value={score ? `${score.assessedItemCount} / ${score.availableItemCount}` : "—"}
          />
        </div>

        <div className="space-y-3 text-sm">
          <ReadRow label={t("Chief Complaint")} value={assessment.chief_complaint} />
          <ReadRow label={t("Current History")} value={assessment.current_history} />
          <ReadRow label={t("Past Medical History")} value={assessment.past_medical_history} />
          <ReadRow label={t("Social History")} value={assessment.social_history} />

          {bodyChart.length > 0 && (
            <div>
              <p className="font-medium text-fg-subtle">{t("Body Chart Findings")}</p>
              <ul className="ml-4 list-disc text-fg-secondary">
                {bodyChart.map((f, i) => (
                  <li key={i}>
                    {f.region}
                    {f.side ? ` (${f.side})` : ""}: {f.comment}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {examRows.length > 0 && (
            <div>
              <p className="font-medium text-fg-subtle">{t("Physical Examination")}</p>
              <div className="space-y-1">
                {(Object.keys(EXAM_STRUCTURE) as ExamLimb[]).map((limb) => {
                  const rows = examRows.filter((r) => r.limb === limb);
                  if (rows.length === 0) return null;
                  return (
                    <div key={limb}>
                      <p className="text-xs font-semibold uppercase text-fg-faint">{EXAM_STRUCTURE[limb].label}</p>
                      <ul className="ml-4 list-disc text-fg-secondary">
                        {rows.map((r, i) => (
                          <li key={i}>
                            {r.region} {r.movement} ({r.side}): {t("Power")} {r.power ?? "--"}, {t("Tone")} {r.tone ?? "--"},{" "}
                            {t("ROM")} {r.rom ?? "--"}, {t("Reflexes")} {r.reflexes ?? "--"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {score && (
            <div>
              <p className="font-medium text-fg-subtle">{t("Functional / Balance / Coordination Scores")}</p>
              <div className="space-y-1 text-fg-secondary">
                {PHYSIO_CATEGORY_KEYS.filter((k) => k !== "examination" && score.categories[k].assessedItemCount > 0).map(
                  (k) => (
                    <p key={k}>
                      {t(PHYSIO_CATEGORY_LABELS[k])}: {percent(score.categories[k].normalizedScore)} (
                      {score.categories[k].rawScore} / {score.categories[k].maxPossibleScore})
                    </p>
                  )
                )}
              </div>
            </div>
          )}

          <ReadRow label={t("Impression / Analysis")} value={assessment.impression} />
          <ReadRow label={t("Plan & Intervention")} value={assessment.plan_intervention} />
          <ReadRow label={t("Evaluation")} value={assessment.evaluation} />
          <ReadRow label={t("Treatment Compliance")} value={assessment.treatment_compliance} />
        </div>

        <div className="mt-4 border-t border-line-subtle pt-3">
          <AdminRecordControls kind="physio_assessment" id={assessment.id} className="flex justify-end" />
        </div>
      </div>
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────

function ReadRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="text-fg-secondary">
      <span className="font-medium text-fg-subtle">{label}: </span>
      {value}
    </p>
  );
}

// Narrative text in the timeline is clamped to ~2 lines; the full wording is
// always one click away in the detail modal.
function ClampedText({ value }: { value: string | null }) {
  if (!value) return <span className="text-fg-faint">--</span>;
  return <span className="line-clamp-2">{value}</span>;
}
