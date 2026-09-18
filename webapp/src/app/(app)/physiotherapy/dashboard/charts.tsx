import type { PatientTypeKey, TypeTotals } from "./data";
import { totalHours } from "./data";

// Fixed per-category colors used consistently across every chart on this
// dashboard (KPI tiles, stacked bars, donut, mix bars) so a color always
// means the same patient type everywhere on the page. Reuses the exact
// tint colors the app's own sidebar already assigns to its modules
// (Physiotherapy = emerald, Residents = blue, Staff = amber) so the
// dashboard's data colors read as part of the same system, not a palette
// invented just for charts.
export const TYPE_COLOR: Record<PatientTypeKey, { bar: string; dot: string; text: string; bg: string }> = {
  inpatient: { bar: "#059669", dot: "bg-emerald-600", text: "text-emerald-700", bg: "bg-emerald-50" },
  outpatient: { bar: "#2563eb", dot: "bg-blue-600", text: "text-blue-700", bg: "bg-blue-50" },
  housecall: { bar: "#d97706", dot: "bg-amber-600", text: "text-amber-700", bg: "bg-amber-50" },
};

const TYPE_ORDER: PatientTypeKey[] = ["inpatient", "outpatient", "housecall"];

export function formatHours(n: number): string {
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}h`;
}

// Legend row shared by the stacked bar chart and the donut -- kept as one
// small component so the color <-> label mapping never drifts between them.
export function TypeLegend({ labels }: { labels: Record<PatientTypeKey, string> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {TYPE_ORDER.map((k) => (
        <div key={k} className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className={`h-2.5 w-2.5 rounded-full ${TYPE_COLOR[k].dot}`} />
          {labels[k]}
        </div>
      ))}
    </div>
  );
}

// Full IP/OP/Housecall breakdown shown on hover/focus of a bar or column --
// CSS-only (group-hover/group-focus), so no client JS is needed to make
// these charts interactive.
function BreakdownTooltip({
  totals,
  labels,
  position = "top",
}: {
  totals: TypeTotals;
  labels: Record<PatientTypeKey, string>;
  position?: "top" | "top-left" | "bottom";
}) {
  const total = totalHours(totals);
  const placement =
    position === "bottom"
      ? "top-full translate-y-1"
      : position === "top-left"
        ? "bottom-full -translate-y-1 left-0"
        : "bottom-full -translate-y-1 left-1/2 -translate-x-1/2";
  return (
    <div
      role="tooltip"
      className={`pointer-events-none absolute z-10 w-44 rounded-md border border-gray-200 bg-white p-2.5 text-left opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${placement}`}
    >
      <p className="mb-1.5 flex items-baseline justify-between text-xs font-bold text-gray-900">
        <span>{formatHours(total)}</span>
      </p>
      <div className="space-y-1">
        {TYPE_ORDER.map((k) => {
          const v = totals[k];
          const pct = total > 0 ? (v / total) * 100 : 0;
          return (
            <div key={k} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5 text-gray-600">
                <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_COLOR[k].dot}`} />
                <span className="truncate">{labels[k]}</span>
              </span>
              <span className="shrink-0 font-medium text-gray-800">
                {formatHours(v)} <span className="text-gray-400">({pct.toFixed(0)}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Horizontal 100%-stacked bar showing a single entity's IP/OP/Housecall
// credit-hour split -- used both for the per-branch comparison and the
// per-therapist "strength" mix. Hovering or focusing the bar reveals the
// full breakdown via BreakdownTooltip.
export function StackedBar({
  label,
  totals,
  sublabel,
  labels,
  tooltipPosition = "top",
}: {
  label: React.ReactNode;
  totals: TypeTotals;
  sublabel?: React.ReactNode;
  labels: Record<PatientTypeKey, string>;
  // "bottom" is for a bar with nothing above it to clip into (e.g. the
  // first row of a scrollable table) -- see therapist-table.tsx.
  tooltipPosition?: "top" | "top-left" | "bottom";
}) {
  const total = totalHours(totals);
  return (
    <div className="group relative" tabIndex={total > 0 ? 0 : undefined}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-gray-800">{label}</span>
        <span className="shrink-0 text-xs text-gray-500">
          {formatHours(total)}
          {sublabel}
        </span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {total === 0
          ? null
          : TYPE_ORDER.map((k) => {
              const v = totals[k];
              if (v <= 0) return null;
              const pct = (v / total) * 100;
              return (
                <div
                  key={k}
                  style={{ width: `${pct}%`, backgroundColor: TYPE_COLOR[k].bar }}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                />
              );
            })}
      </div>
      {total > 0 && <BreakdownTooltip totals={totals} labels={labels} position={tooltipPosition} />}
    </div>
  );
}

// Vertical grouped/stacked column chart for the weekly trend -- each column
// is itself a mini 100%-of-max stacked bar so both the total shape and the
// type mix are visible at a glance. Hovering or focusing a column reveals
// its full breakdown via BreakdownTooltip.
export function TrendChart({
  buckets,
  labels,
}: {
  buckets: { label: string; totals: TypeTotals }[];
  labels: Record<PatientTypeKey, string>;
}) {
  const max = Math.max(...buckets.map((b) => totalHours(b.totals)), 1);
  return (
    <div className="flex h-40 items-end gap-1.5 sm:gap-2">
      {buckets.map((b, i) => {
        const total = totalHours(b.totals);
        const heightPct = Math.max((total / max) * 100, total > 0 ? 3 : 0);
        // First/last couple of columns would push the centered tooltip
        // past the card edge -- left-align it there instead.
        const edgePosition = i < 1 ? "top-left" : undefined;
        return (
          <div
            key={i}
            className="group relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
            tabIndex={total > 0 ? 0 : undefined}
          >
            <div className="flex h-32 w-full items-end overflow-hidden rounded-t-sm bg-gray-50">
              <div className="flex w-full flex-col justify-end" style={{ height: `${heightPct}%` }}>
                {[...TYPE_ORDER].reverse().map((k) => {
                  const v = b.totals[k];
                  if (v <= 0) return null;
                  const segPct = (v / total) * 100;
                  return <div key={k} style={{ height: `${segPct}%`, backgroundColor: TYPE_COLOR[k].bar }} className="w-full" />;
                })}
              </div>
            </div>
            <span className="truncate text-[10px] text-gray-500">{b.label}</span>
            {total > 0 && <BreakdownTooltip totals={b.totals} labels={labels} position={edgePosition} />}
          </div>
        );
      })}
    </div>
  );
}

// Donut built from stacked SVG stroke-dasharray arcs -- avoids pulling in a
// chart library for a single 3-slice chart. Center shows the grand total.
export function DonutChart({
  totals,
  size = 152,
  t,
}: {
  totals: TypeTotals;
  size?: number;
  t: (text: string) => string;
}) {
  const total = totalHours(totals);
  const radius = size / 2 - 14;
  const circumference = 2 * Math.PI * radius;
  let offsetAccum = 0;

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f3f4f6" strokeWidth={14} />
        {total > 0 &&
          TYPE_ORDER.map((k) => {
            const v = totals[k];
            if (v <= 0) return null;
            const frac = v / total;
            const dash = frac * circumference;
            const el = (
              <circle
                key={k}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={TYPE_COLOR[k].bar}
                strokeWidth={14}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offsetAccum}
                strokeLinecap="butt"
              >
                <title>{`${k}: ${formatHours(v)} (${(frac * 100).toFixed(0)}%)`}</title>
              </circle>
            );
            offsetAccum += dash;
            return el;
          })}
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-2xl font-bold tracking-tight text-gray-900">{formatHours(total)}</p>
        <p className="mb-2 text-xs text-gray-500">{t("total credit hours")}</p>
        <div className="space-y-1">
          {TYPE_ORDER.map((k) => {
            const v = totals[k];
            const pct = total > 0 ? (v / total) * 100 : 0;
            return (
              <div key={k} className="flex items-center gap-1.5 text-xs">
                <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_COLOR[k].dot}`} />
                <span className="text-gray-600">{formatHours(v)}</span>
                <span className="text-gray-400">({pct.toFixed(0)}%)</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Bullet-style bar comparing actual weekly-average hours to the 45hr/week
// baseline. Going over the baseline is expected (overtime happens) so the
// overflow segment renders in the same positive indigo tone, not a warning
// color -- only the caption text distinguishes "over"/"under".
export function WorkloadBar({
  avgWeeklyHours,
  baseline,
  t,
}: {
  avgWeeklyHours: number;
  baseline: number;
  t: (text: string) => string;
}) {
  const max = Math.max(avgWeeklyHours, baseline) * 1.15;
  const barPct = Math.min((avgWeeklyHours / max) * 100, 100);
  const targetPct = (baseline / max) * 100;
  const delta = avgWeeklyHours - baseline;

  return (
    <div className="w-full">
      <div className="relative h-2.5 w-full rounded-full bg-gray-100">
        <div
          className={`h-2.5 rounded-full ${delta >= 0 ? "bg-emerald-600" : "bg-emerald-400"}`}
          style={{ width: `${barPct}%` }}
        >
          <title>{`${avgWeeklyHours.toFixed(1)}h / week (baseline ${baseline}h)`}</title>
        </div>
        <div
          className="absolute top-[-3px] h-[16px] w-[2px] rounded-full bg-gray-400"
          style={{ left: `${targetPct}%` }}
          title={`${baseline}h/week baseline`}
        />
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        {t("{h}h/wk avg").replace("{h}", avgWeeklyHours.toFixed(1))}
        {" · "}
        {delta >= 0 ? (
          <span className="font-medium text-emerald-700">{t("+{h}h overtime").replace("{h}", delta.toFixed(1))}</span>
        ) : (
          <span className="text-gray-500">{t("{h}h below baseline").replace("{h}", Math.abs(delta).toFixed(1))}</span>
        )}
      </p>
    </div>
  );
}
