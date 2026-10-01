// Pure rendering components for the Call Bell analytics dashboard.
// No hooks — `t` arrives as a plain prop so these stay server-renderable.

import type { HourRow } from "./data";
import type { TranslateParams } from "@/lib/i18n/translate";

type T = (text: string, params?: TranslateParams) => string;

// ─── Calls-by-hour vertical bar chart ─────────────────────────────────────────

const HOUR_BAR_TINTS = [
  "fill-indigo-300 dark:fill-indigo-800/70",
  "fill-indigo-400 dark:fill-indigo-700/80",
  "fill-indigo-500",
  "fill-indigo-600",
];

/** Deeper tint for the busiest quarter of the day, so peaks read at a glance. */
function barTint(hour: number): string {
  if (hour >= 0 && hour < 6) return HOUR_BAR_TINTS[0];
  if (hour >= 6 && hour < 12) return HOUR_BAR_TINTS[2];
  if (hour >= 12 && hour < 18) return HOUR_BAR_TINTS[3];
  return HOUR_BAR_TINTS[1];
}

export function CallsByHourChart({ rows, t }: { rows: HourRow[]; t: T }) {
  const max = Math.max(...rows.map((r) => r.count), 0);
  const W = 720;
  const H = 180;
  const PAD_L = 34;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 28;
  const CW = W - PAD_L - PAD_R;
  const CH = H - PAD_T - PAD_B;

  const slot = CW / rows.length;
  const barW = Math.max(4, slot - 6);
  const yOf = (v: number) => PAD_T + CH - (max > 0 ? (v / max) * CH : 0);

  const gridValues = [0, Math.round(max / 2), max];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t("Calls by hour")} className="block overflow-visible">
        {gridValues.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={PAD_L + CW} y1={yOf(v)} y2={yOf(v)} stroke="#f1f5f9" strokeWidth="1" className="dark:stroke-line" />
            <text x={PAD_L - 6} y={yOf(v)} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="#94a3b8" fontFamily="inherit">
              {v}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = PAD_L + i * slot + (slot - barW) / 2;
          const h = max > 0 ? Math.max(r.count > 0 ? 2 : 0, (r.count / max) * CH) : 0;
          return (
            <g key={r.hour}>
              <rect x={x} y={PAD_T + CH - h} width={barW} height={h} rx="2" className={barTint(r.hour)}>
                <title>{t("{hour}: {count} calls", { hour: r.label, count: r.count })}</title>
              </rect>
              {r.hour % 3 === 0 && (
                <text x={PAD_L + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="inherit">
                  {r.hour}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-center text-xs text-fg-faint">{t("Hours are in Malaysia time (MYT)")}</p>
    </div>
  );
}

// ─── Response-time bucket bars ────────────────────────────────────────────────

// Green → amber → red as calls get slower, matching the Call Logs slow-response
// colour so the two screens read the same.
const BUCKET_BARS = [
  "bg-emerald-500",
  "bg-teal-500",
  "bg-amber-500",
  "bg-orange-500",
  "bg-red-500",
];

export function ResponseBucketBars({
  rows,
  t,
}: {
  rows: { key: string; label: string; count: number; pct: number }[];
  t: T;
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-center gap-2">
          <div className="w-24 shrink-0 text-right text-xs text-fg-muted">{t(r.label)}</div>
          <div className="relative flex h-5 flex-1 overflow-hidden rounded-full bg-surface-strong">
            <div
              className={`h-5 rounded-full transition-all ${BUCKET_BARS[Math.min(i, BUCKET_BARS.length - 1)]}`}
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
          <div className="w-28 shrink-0 text-right text-xs tabular-nums text-fg-secondary">
            <span className="font-medium text-fg">{r.count}</span>
            <span className="text-fg-faint"> {t("calls")} ({r.pct}%)</span>
          </div>
        </div>
      ))}
    </div>
  );
}