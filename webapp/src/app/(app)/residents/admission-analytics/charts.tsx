// Pure rendering components for the Admission Analytics dashboard.
// No hooks — safe to render from server components.

import type { TrendPoint, AgeGenderRow, LOSBucket, CategoryRow } from "./data";

// ─── Occupancy trend chart ────────────────────────────────────────────────────

// SVG line + area chart with improved hover interaction.
// One data point per month-end snapshot.
export function OccupancyTrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">No occupancy data for this period.</p>
    );
  }

  const W = 600;
  const H = 160;
  const PAD_L = 44;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 32;
  const CW = W - PAD_L - PAD_R; // chart width
  const CH = H - PAD_T - PAD_B; // chart height

  const maxVal = Math.max(...points.map((p) => p.occupied), 1);
  // Round max up to a "nice" number for the y-axis
  const niceMax = Math.ceil(maxVal / 10) * 10 || 10;

  const xOf = (i: number) =>
    points.length === 1 ? PAD_L + CW / 2 : PAD_L + (i / (points.length - 1)) * CW;
  const yOf = (v: number) => PAD_T + CH - (v / niceMax) * CH;

  const lineD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(p.occupied)}`).join(" ");

  const areaD = [
    `M ${xOf(0)} ${PAD_T + CH}`,
    ...points.map((p, i) => `L ${xOf(i)} ${yOf(p.occupied)}`),
    `L ${xOf(points.length - 1)} ${PAD_T + CH}`,
    "Z",
  ].join(" ");

  // Y-axis grid lines (0, 25%, 50%, 75%, 100% of niceMax)
  const gridValues = [0, Math.round(niceMax * 0.25), Math.round(niceMax * 0.5), Math.round(niceMax * 0.75), niceMax];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        aria-label="Occupancy trend chart"
        role="img"
        className="block overflow-visible"
      >
        {/* Grid lines + y-axis labels */}
        {gridValues.map((v) => {
          const y = yOf(v);
          return (
            <g key={v}>
              <line
                x1={PAD_L}
                y1={y}
                x2={PAD_L + CW}
                y2={y}
                stroke="#f1f5f9"
                strokeWidth="1"
              />
              <text
                x={PAD_L - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="9"
                fill="#94a3b8"
                fontFamily="inherit"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaD} fill="rgba(99,102,241,0.08)" />

        {/* Line */}
        {points.length > 1 && (
          <path d={lineD} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Dots with hover targets */}
        {points.map((p, i) => (
          <g key={i}>
            {/* Larger invisible hover target */}
            <circle
              cx={xOf(i)}
              cy={yOf(p.occupied)}
              r="8"
              fill="transparent"
              style={{ cursor: "pointer" }}
              className="hover-target"
            />
            {/* Visible dot */}
            <circle
              cx={xOf(i)}
              cy={yOf(p.occupied)}
              r="4"
              fill="#6366f1"
              stroke="white"
              strokeWidth="1.5"
            />
            <title>{`${p.label}\nOccupancy: ${p.occupied} residents`}</title>
          </g>
        ))}

        {/* X-axis labels */}
        {points.map((p, i) => {
          // Show every label when ≤ 8 points, otherwise every 3rd
          const skip = points.length > 8 && i % 3 !== 0 && i !== points.length - 1;
          if (skip) return null;
          return (
            <text
              key={i}
              x={xOf(i)}
              y={H - 4}
              textAnchor="middle"
              fontSize="9"
              fill="#94a3b8"
              fontFamily="inherit"
            >
              {p.label}
            </text>
          );
        })}
      </svg>
      <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">Hover over data points to see details</p>
    </div>
  );
}

// ─── Age × Gender table ───────────────────────────────────────────────────────

export function AgeGenderTable({ rows }: { rows: AgeGenderRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      male: acc.male + r.male,
      female: acc.female + r.female,
      unknown: acc.unknown + r.unknown,
      total: acc.total + r.total,
    }),
    { male: 0, female: 0, unknown: 0, total: 0 }
  );

  const hasUnknown = totals.unknown > 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-800">
            <th className="py-1.5 pr-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Age</th>
            <th className="px-2 py-1.5 text-right text-xs font-medium text-blue-600 dark:text-blue-400">Male</th>
            <th className="px-2 py-1.5 text-right text-xs font-medium text-rose-500 dark:text-rose-400">Female</th>
            {hasUnknown && (
              <th className="px-2 py-1.5 text-right text-xs font-medium text-gray-400 dark:text-gray-500">–</th>
            )}
            <th className="py-1.5 pl-2 text-right text-xs font-medium text-gray-700 dark:text-gray-300">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
          {rows.map((r) => (
            <tr key={r.group}>
              <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200 tabular-nums">{r.group}</td>
              <td className="px-2 py-2 text-right tabular-nums text-blue-700 dark:text-blue-300">{r.male}</td>
              <td className="px-2 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{r.female}</td>
              {hasUnknown && (
                <td className="px-2 py-2 text-right tabular-nums text-gray-400 dark:text-gray-500">{r.unknown}</td>
              )}
              <td className="py-2 pl-2 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">{r.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 dark:border-gray-800">
            <td className="py-2 pr-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total</td>
            <td className="px-2 py-2 text-right font-bold tabular-nums text-blue-700 dark:text-blue-300">{totals.male}</td>
            <td className="px-2 py-2 text-right font-bold tabular-nums text-rose-600 dark:text-rose-400">{totals.female}</td>
            {hasUnknown && (
              <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-400 dark:text-gray-500">{totals.unknown}</td>
            )}
            <td className="py-2 pl-2 text-right font-bold tabular-nums text-gray-900 dark:text-gray-100">{totals.total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Horizontal bar (reused for LOS, mobility, feeding, hygiene) ──────────────

// Color bands indexed by sort position (most-common = deeper tint).
const BAR_COLORS = [
  "bg-indigo-500",
  "bg-indigo-400",
  "bg-indigo-300",
  "bg-indigo-200",
  "bg-indigo-100",
];

export function HorizontalBar({
  label,
  count,
  pct,
  colorClass,
  maxCount,
}: {
  label: string;
  count: number;
  pct: number;
  colorClass?: string;
  maxCount: number;
}) {
  const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const color = colorClass ?? "bg-indigo-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-32 shrink-0 truncate text-right text-xs text-gray-600 dark:text-gray-400" title={label}>
        {label}
      </div>
      <div className="relative flex h-4 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-4 rounded-full transition-all ${color}`}
          style={{ width: `${barWidth}%` }}
          title={`${count} residents (${pct}%)`}
        />
      </div>
      <div className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-700 dark:text-gray-300">
        <span className="font-medium">{count}</span>
        <span className="text-gray-400 dark:text-gray-500"> ({pct}%)</span>
      </div>
    </div>
  );
}

export function CategoryBars({ rows, emptyLabel = "No data." }: { rows: CategoryRow[]; emptyLabel?: string }) {
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">{emptyLabel}</p>;
  }
  const maxCount = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <HorizontalBar
          key={r.label}
          label={r.label}
          count={r.count}
          pct={r.pct}
          colorClass={BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)]}
          maxCount={maxCount}
        />
      ))}
    </div>
  );
}

// ─── LOS distribution bars ───────────────────────────────────────────────────

const LOS_COLORS = ["bg-emerald-500", "bg-emerald-400", "bg-emerald-300", "bg-emerald-200"];

export function LOSBars({ buckets, avgDays }: { buckets: LOSBucket[]; avgDays: number | null }) {
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="space-y-2">
      {buckets.map((b, i) => (
        <div key={b.label} className="flex items-center gap-2">
          <div className="w-24 shrink-0 text-right text-xs text-gray-600 dark:text-gray-400">{b.label}</div>
          <div className="relative flex h-4 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className={`h-4 rounded-full ${LOS_COLORS[Math.min(i, LOS_COLORS.length - 1)]}`}
              style={{ width: `${maxCount > 0 ? (b.count / maxCount) * 100 : 0}%` }}
            />
          </div>
          <div className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-gray-700 dark:text-gray-300">
            {b.count}
          </div>
        </div>
      ))}
      {avgDays !== null && (
        <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">Average LOS</span>
            <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {avgDays} <span className="text-sm font-normal text-gray-400 dark:text-gray-500">days</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

export function KpiCard({
  label,
  value,
  sub,
  tint,
  icon,
  delta,
  clickable,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tint: string;
  icon: React.ReactNode;
  delta?: { value: number; positive: boolean } | null;
  clickable?: boolean;
}) {
  return (
    <div className={`rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm ${clickable ? "cursor-pointer transition-all hover:border-indigo-300 hover:shadow-md" : ""}`}>
      <div className="flex items-start justify-between">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tint}`}>{icon}</span>
        {delta !== undefined && delta !== null && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
              delta.positive ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300" : "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400"
            }`}
          >
            {delta.positive ? (
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 2.5L10 7H2L6 2.5Z" />
              </svg>
            ) : (
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 9.5L2 5H10L6 9.5Z" />
              </svg>
            )}
            {Math.abs(delta.value)}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">{value}</p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{sub}</p>}
      {clickable && <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">Click for details</p>}
    </div>
  );
}
