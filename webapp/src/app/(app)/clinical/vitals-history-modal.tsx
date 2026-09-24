"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import {
  type Vital,
  getDailyAverages,
  getDXTReadings,
  resolveDateRange,
  defaultCustomRange,
  filterVitalsByRange,
  formatVitalDate,
  formatVitalDateTime,
  type DateRangeOption,
} from "@/lib/vitals";
import {
  InteractiveVitalChart,
  VITAL_UNITS,
  formatVitalValue,
  type ChartPoint,
  type VitalKind,
} from "./interactive-vital-chart";

const VITAL_ORDER: VitalKind[] = ["BP", "HR", "Temp", "SpO2", "DXT"];
const RANGE_OPTIONS: Exclude<DateRangeOption, "custom">[] = [7, 14, 28];

const VITAL_TITLES: Record<VitalKind, string> = {
  BP: "Blood Pressure",
  HR: "Heart Rate",
  Temp: "Temperature",
  SpO2: "SpO2",
  DXT: "DXT (Blood Glucose)",
};

type Props = {
  vitals: Vital[];
  onClose: () => void;
};

/**
 * Same point shape as the main-page cards, just over a wider range:
 * BP/HR/Temp/SpO2 are one daily average per calendar day, DXT is one point
 * per actual reading. The modal filters the already-loaded vitals in
 * memory -- no extra Supabase round trip per control change.
 */
function buildPoints(kind: VitalKind, vitals: Vital[]): ChartPoint[] {
  if (kind === "DXT") {
    return getDXTReadings(vitals).map((r) => ({
      id: r.id,
      label: formatVitalDateTime(r.timestamp),
      primary: r.value,
      isDailyAverage: false,
      remark: r.remark,
    }));
  }

  return getDailyAverages(vitals)
    .map((d) => {
      const primary =
        kind === "BP" ? d.systolic_bp
        : kind === "HR" ? d.heart_rate
        : kind === "Temp" ? d.temperature
        : d.spo2;
      return {
        id: d.dateKey,
        // Date only. A daily average has no time of day, and showing one
        // would imply the reading happened at that moment.
        label: formatVitalDate(`${d.dateKey}T00:00:00+08:00`),
        primary,
        secondary: kind === "BP" ? d.diastolic_bp : null,
        isDailyAverage: true,
        remark: kind === "SpO2" ? d.spo2_condition : null,
      } satisfies ChartPoint;
    })
    .filter((p) => p.primary !== null);
}

// Mounted only while open, so every control resets to a sensible default
// each time the clinician opens it -- no "did I leave it on Custom from
// last time" state to reason about, and no effect needed to re-seed it.
export function VitalsHistoryModal({ vitals, onClose }: Props) {
  const t = useTranslation();
  const [kind, setKind] = useState<VitalKind>("BP");
  const [option, setOption] = useState<DateRangeOption>(7);
  const [custom, setCustom] = useState(() => defaultCustomRange(vitals));

  // Escape to close, and hold the page behind the sheet still on mobile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const { points, invalidRange } = useMemo(() => {
    const range = resolveDateRange(vitals, option, custom.start, custom.end);
    const invalid = option === "custom" && range === null;
    return { points: invalid ? [] : buildPoints(kind, filterVitalsByRange(vitals, range)), invalidRange: invalid };
  }, [vitals, option, custom.start, custom.end, kind]);

  const rangeInvalid = invalidRange || (option === "custom" && custom.start !== "" && custom.end !== "" && custom.start > custom.end);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vitals-history-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Bottom sheet on phones, centred dialog from `sm` up. dvh keeps it
          inside the visible viewport when the iOS toolbar is showing. */}
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:max-h-[88vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 id="vitals-history-title" className="text-base font-bold text-fg sm:text-lg">
              {t("Vital history")}
            </h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {t("BP, HR, temperature and SpO2 show a daily average. DXT shows every actual reading.")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose()}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-2 text-fg-muted transition-colors hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label={t("Close")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {/* One vital at a time -- five full charts at once is the
              dashboard this is deliberately not. */}
          <div className="flex gap-1" role="tablist" aria-label={t("Select vital")}>
            {VITAL_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={`min-h-9 flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:px-3 ${
                  kind === k
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                    : "text-fg-muted hover:bg-hover hover:text-fg"
                }`}
              >
                {t(k)}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {RANGE_OPTIONS.map((d) => (
              <RangeChip key={d} active={option === d} onClick={() => setOption(d)}>
                {d} {t("days")}
              </RangeChip>
            ))}
            <RangeChip active={option === "custom"} onClick={() => setOption("custom")}>
              {t("Custom")}
            </RangeChip>
          </div>

          {option === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-fg-subtle">
                {t("Start date")}
                <input
                  type="date"
                  value={custom.start}
                  max={custom.end || undefined}
                  onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                  className="mt-1 block w-full min-h-9 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </label>
              <label className="block text-xs font-medium text-fg-subtle">
                {t("End date")}
                <input
                  type="date"
                  value={custom.end}
                  min={custom.start || undefined}
                  onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                  className="mt-1 block w-full min-h-9 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </label>
              {rangeInvalid && (
                <p className="col-span-2 text-xs text-red-600 dark:text-red-400">
                  {t("Start date must be on or before end date.")}
                </p>
              )}
            </div>
          )}

          <div className="mt-4">
            <InteractiveVitalChart
              kind={kind}
              points={points}
              title={t(VITAL_TITLES[kind])}
              emptyText={rangeInvalid ? t("Select a valid date range") : t("No readings in this period")}
            />
          </div>

          {/* The plotted numbers, spelled out, so nothing is reachable only
              by tapping a marker. */}
          {points.length > 0 && (
            <details className="group mt-4 border-t border-line pt-3">
              <summary className="cursor-pointer list-none text-xs font-semibold text-fg-subtle">
                {points.length} {kind === "DXT" ? t("readings") : t("days with readings")}
              </summary>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
                {points
                  .slice()
                  .reverse()
                  .map((p) => (
                    <li key={p.id} className="flex items-baseline justify-between gap-3 text-fg-muted">
                      <span className="truncate">{p.label}</span>
                      <span className="shrink-0 tabular-nums text-fg">
                        {formatVitalValue(kind, p)} {VITAL_UNITS[kind]}
                        {p.remark ? <span className="ml-2 italic text-fg-faint">{p.remark}</span> : null}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function RangeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        active
          ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300"
          : "border-line text-fg-muted hover:bg-hover hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
