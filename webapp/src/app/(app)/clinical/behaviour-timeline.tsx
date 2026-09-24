"use client";

import { useState, useMemo, useCallback } from "react";
import type { BehaviourEpisode, BehaviourEntry } from "./behaviour-chart-actions";
import { useTranslation } from "@/components/language-provider";

const TIME_ZONE = "Asia/Kuala_Lumpur";

// ─── Severity system (concern level, not category) ─────────────────────────
type Severity = "neutral" | "mild" | "abnormal" | "high";

const BEHAVIOUR_SEVERITY: Record<string, Severity> = {
  // Verbal
  Quiet:              "neutral",
  Shouting:           "high",
  "Scolding Staff":   "abnormal",
  "Incoherent Speech":"abnormal",
  // Physical
  Calm:               "neutral",
  Restless:           "mild",
  "Walking Around":   "abnormal",
  "Hitting Staff":    "high",
  // Mood
  Relaxed:            "neutral",
  Agitated:           "abnormal",
  Sleepy:             "neutral",
  Anxious:            "mild",
  Angry:              "high",
  Crying:             "mild",
};

const SEVERITY_COLOR: Record<Severity, { bg: string; border: string; text: string; dot: string }> = {
  neutral:  { bg: "#F0FDF4", border: "#4ADE80", text: "#14532D", dot: "#22C55E" },
  mild:     { bg: "#FEFCE8", border: "#FCD34D", text: "#78350F", dot: "#EAB308" },
  abnormal: { bg: "#FFF7ED", border: "#FB923C", text: "#7C2D12", dot: "#F97316" },
  high:     { bg: "#FEF2F2", border: "#F87171", text: "#7F1D1D", dot: "#EF4444" },
};

const SEVERITY_LABEL: Record<Severity, string> = {
  neutral:  "Normal / Neutral",
  mild:     "Mild Concern",
  abnormal: "Abnormal",
  high:     "High Concern",
};

function getSeverity(behaviour: string): Severity {
  return BEHAVIOUR_SEVERITY[behaviour] ?? "mild";
}

// ─── Disturbance ────────────────────────────────────────────────────────────
const DISTURBANCE_COLOR: Record<number, string> = {
  0: "#6EE7B7", 1: "#93C5FD", 2: "#FCD34D", 3: "#FB923C", 4: "#F87171",
};
const DISTURBANCE_LABELS: Record<number, string> = {
  0: "No disturb",
  1: "Occasionally sound",
  2: "Frequent sound (others can sleep)",
  3: "Frequent sound (others can't sleep)",
  4: "Persistent sound",
};

// ─── Time utilities ──────────────────────────────────────────────────────────
function getMYTDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function getMYTHours(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(new Date(iso));
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h + m / 60;
}

function formatMYTTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit",
  });
}

function formatMYTDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric",
  });
}

function durationLabel(startIso: string, endIso: string): string {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function buildDateRange(endDate: string, days: number): string[] {
  const result: string[] = [];
  const end = new Date(`${endDate}T00:00:00+08:00`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    result.push(d.toLocaleDateString("en-CA", { timeZone: TIME_ZONE }));
  }
  return result;
}

function formatDayLabel(dateStr: string, narrow: boolean): { day: string; month: string; weekday: string } {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  return {
    day: d.toLocaleDateString("en-GB", { timeZone: TIME_ZONE, day: "numeric" }),
    month: d.toLocaleDateString("en-GB", { timeZone: TIME_ZONE, month: "short" }),
    weekday: d.toLocaleDateString("en-GB", { timeZone: TIME_ZONE, weekday: narrow ? "narrow" : "short" }),
  };
}

// ─── Lane assignment (per-day, timed episodes only) ──────────────────────────
function assignLanes(timedEps: BehaviourEpisode[]): Map<number, number> {
  const sorted = [...timedEps].sort(
    (a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime()
  );
  const lanes = new Map<number, number>();
  const laneEnds: number[] = [];
  for (const ep of sorted) {
    const startMs = new Date(ep.started_at!).getTime();
    let lane = laneEnds.findIndex((end) => end <= startMs);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = new Date(ep.ended_at!).getTime();
    lanes.set(ep.id, lane);
  }
  return lanes;
}

// ─── Types ───────────────────────────────────────────────────────────────────
type ActiveEpisode = BehaviourEpisode & { staffName?: string };

type Props = {
  episodes: BehaviourEpisode[];
  charts: BehaviourEntry[];
  days: number;
  endDate: string;
  onDrillDown?: (date: string) => void;
};

// ─── Main component ───────────────────────────────────────────────────────────
export function BehaviourTimeline({ episodes, charts, days, endDate, onDrillDown }: Props) {
  const t = useTranslation();
  const [active, setActive] = useState<ActiveEpisode | null>(null);

  const isDayView = days === 1;

  const staffByChartId = useMemo(() => {
    const m = new Map<number, string>();
    for (const ch of charts) {
      const name = ch.tbl_staff?.staff_name ?? ch.created_by_other ?? null;
      if (name) m.set(ch.id, name);
    }
    return m;
  }, [charts]);

  const episodesByDate = useMemo(() => {
    const m = new Map<string, BehaviourEpisode[]>();
    for (const ep of episodes) {
      // Timed episodes: use started_at date. Untimed: use chart_id to find date from charts.
      const d = ep.started_at ? getMYTDateStr(ep.started_at) : null;
      if (!d) continue;
      const list = m.get(d) ?? [];
      list.push(ep);
      m.set(d, list);
    }
    return m;
  }, [episodes]);

  const chartsByDate = useMemo(() => {
    const m = new Map<string, BehaviourEntry[]>();
    for (const ch of charts) {
      const d = getMYTDateStr(ch.entry_timestamp);
      const list = m.get(d) ?? [];
      list.push(ch);
      m.set(d, list);
    }
    return m;
  }, [charts]);

  const disturbanceByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const ch of [...charts].reverse()) {
      const d = getMYTDateStr(ch.entry_timestamp);
      if (ch.disturbance_level != null) m.set(d, ch.disturbance_level);
    }
    return m;
  }, [charts]);

  // Untimed behaviours: in parent chart arrays but without a timed episode for that date
  function getUntimedBehaviours(dateStr: string): Array<{ behaviour: string; category: string }> {
    const dayCharts = chartsByDate.get(dateStr) ?? [];
    const timedNames = new Set((episodesByDate.get(dateStr) ?? []).filter(ep => ep.started_at).map((ep) => ep.behaviour));
    const seen = new Set<string>();
    const result: Array<{ behaviour: string; category: string }> = [];
    for (const ch of dayCharts) {
      for (const b of ch.verbal_behavior ?? []) {
        if (!timedNames.has(b) && !seen.has(b)) { seen.add(b); result.push({ behaviour: b, category: "Verbal" }); }
      }
      for (const b of ch.physical_behavior ?? []) {
        if (!timedNames.has(b) && !seen.has(b)) { seen.add(b); result.push({ behaviour: b, category: "Physical" }); }
      }
      for (const b of ch.emotion_mood ?? []) {
        if (!timedNames.has(b) && !seen.has(b)) { seen.add(b); result.push({ behaviour: b, category: "Mood" }); }
      }
    }
    return result;
  }

  const handleEpisodeClick = useCallback(
    (ep: BehaviourEpisode) => {
      const staffName = staffByChartId.get(ep.chart_id) ?? undefined;
      setActive({ ...ep, staffName });
    },
    [staffByChartId]
  );

  const dates = buildDateRange(endDate, days);

  // Layout dimensions
  const dateLabelW = isDayView ? 100 : days <= 7 ? 80 : days <= 14 ? 72 : 64;
  const laneH = isDayView ? 36 : days <= 7 ? 22 : days <= 14 ? 16 : 12;
  const maxLanes = isDayView ? Infinity : days <= 7 ? 3 : 2;
  const showBarText = isDayView || days <= 7;
  const HOUR_MARKS_GRID = [0, 6, 12, 18, 24];
  const HOUR_MARKS_AXIS = isDayView ? [0, 3, 6, 9, 12, 15, 18, 21, 24] : [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <div className="space-y-3">
      {/* Concern level legend */}
      <div className="flex flex-wrap gap-4 px-1">
        {(["neutral", "mild", "abnormal", "high"] as Severity[]).map((sev) => (
          <div key={sev} className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: SEVERITY_COLOR[sev].dot }} />
            {t(SEVERITY_LABEL[sev])}
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="overflow-x-auto rounded-md border border-line bg-surface shadow-sm">
        {/* Hour axis header (day view) */}
        {isDayView && (
          <div className="flex border-b border-line bg-surface-muted sticky top-0 z-10">
            <div style={{ width: dateLabelW, minWidth: dateLabelW }} className="border-r border-line-subtle" />
            <div className="relative flex-1 h-5">
              {HOUR_MARKS_AXIS.map((h) => (
                <span
                  key={h}
                  className="absolute bottom-0 text-[9px] text-fg-faint"
                  style={{
                    left: `${(h / 24) * 100}%`,
                    transform: h === 0 ? "none" : h === 24 ? "translateX(-100%)" : "translateX(-50%)",
                    paddingBottom: 2,
                  }}
                >
                  {String(h).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>
        )}

        {dates.map((dateStr) => {
          const allDayEps = episodesByDate.get(dateStr) ?? [];
          const timedEps = allDayEps.filter((ep) => ep.started_at && ep.ended_at);
          const laneMap = assignLanes(timedEps);
          const totalLanes = timedEps.length === 0 ? 0 : Math.max(...Array.from(laneMap.values())) + 1;
          const visibleLanes = maxLanes === Infinity ? totalLanes : Math.min(totalLanes, maxLanes);
          const hiddenLanes = totalLanes - visibleLanes;
          const untimedBehaviours = getUntimedBehaviours(dateStr);
          const distLevel = disturbanceByDate.get(dateStr);
          const label = formatDayLabel(dateStr, days > 14);
          const hasContent = timedEps.length > 0 || untimedBehaviours.length > 0;
          const drillable = !isDayView && !!onDrillDown;

          const rowMinH =
            Math.max(visibleLanes, 1) * laneH +
            (untimedBehaviours.length > 0 ? 20 : 0) +
            (isDayView ? 12 : 8);

          return (
            <div
              key={dateStr}
              className={`flex border-b border-line-subtle last:border-b-0 ${drillable ? "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors" : ""}`}
              style={{ minHeight: rowMinH }}
              onClick={drillable ? () => onDrillDown!(dateStr) : undefined}
              title={drillable ? t("Click to view this day in detail") : undefined}
            >
              {/* Date label */}
              <div
                className="flex shrink-0 flex-col items-center justify-center gap-0.5 border-r border-line-subtle px-2 py-2"
                style={{ width: dateLabelW, minWidth: dateLabelW }}
              >
                <div className="text-center leading-none">
                  <div className="text-xs text-fg-faint">{label.weekday}</div>
                  <div className={`font-bold text-fg ${isDayView ? "text-lg" : days <= 7 ? "text-base" : "text-sm"}`}>
                    {label.day}
                  </div>
                  <div className="text-xs text-fg-faint">{label.month}</div>
                </div>
                {distLevel != null && (
                  <div
                    className="rounded px-1 py-0.5 text-center mt-1"
                    style={{ fontSize: 9, backgroundColor: DISTURBANCE_COLOR[distLevel] + "40", color: "var(--fg-secondary)" }}
                    title={`Level ${distLevel}: ${DISTURBANCE_LABELS[distLevel]}`}
                  >
                    L{distLevel}
                  </div>
                )}
                {hiddenLanes > 0 && (
                  <div className="text-[9px] text-indigo-500 font-medium mt-0.5">
                    +{hiddenLanes} {t("more")}
                  </div>
                )}
              </div>

              {/* Track */}
              <div className="flex-1 flex flex-col py-1 px-0.5">
                {/* Empty state */}
                {!hasContent ? (
                  <div className="relative flex-1" style={{ minHeight: laneH }}>
                    {HOUR_MARKS_GRID.map((h) => (
                      <div key={h} className="absolute top-0 bottom-0"
                        style={{ left: `${(h / 24) * 100}%`, borderLeft: "1px dashed var(--line)" }} />
                    ))}
                    <div className="absolute inset-y-0 flex items-center px-2" style={{ fontSize: 10, color: "var(--line-strong)" }}>
                      {t("No episodes")}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Lane rows */}
                    {Array.from({ length: Math.max(visibleLanes, 1) }).map((_, laneIdx) => {
                      const laneEps = timedEps.filter((ep) => laneMap.get(ep.id) === laneIdx);
                      return (
                        <div key={laneIdx} className="relative" style={{ height: laneH, flexShrink: 0 }}>
                          {HOUR_MARKS_GRID.map((h) => (
                            <div key={h} className="absolute top-0 bottom-0"
                              style={{ left: `${(h / 24) * 100}%`, borderLeft: "1px dashed var(--line)" }} />
                          ))}
                          {laneEps.map((ep) => {
                            const startH = getMYTHours(ep.started_at!);
                            const endH = Math.min(getMYTHours(ep.ended_at!), 24);
                            const leftPct = (startH / 24) * 100;
                            const widthPct = Math.max(((endH - startH) / 24) * 100, 0.4);
                            const sev = getSeverity(ep.behaviour);
                            const col = SEVERITY_COLOR[sev];
                            const barH = laneH - 4;
                            return (
                              <button
                                key={ep.id}
                                type="button"
                                className="absolute rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                                style={{
                                  left: `${leftPct}%`, width: `${widthPct}%`,
                                  height: barH, top: 2,
                                  backgroundColor: col.bg,
                                  border: `1.5px solid ${col.border}`,
                                  zIndex: 1, overflow: "hidden", cursor: "pointer", minWidth: 4,
                                }}
                                onClick={(e) => { e.stopPropagation(); handleEpisodeClick(ep); }}
                                aria-label={`${ep.behaviour} ${formatMYTTime(ep.started_at!)}–${formatMYTTime(ep.ended_at!)}`}
                              >
                                {showBarText && (
                                  <span
                                    className="block truncate px-1"
                                    style={{ fontSize: 10, color: col.text, lineHeight: `${barH}px` }}
                                  >
                                    {ep.behaviour}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* Untimed observations */}
                    {untimedBehaviours.length > 0 && (
                      <div className="flex flex-wrap gap-1 px-1 pt-1 pb-0.5">
                        {untimedBehaviours.map(({ behaviour }) => {
                          const col = SEVERITY_COLOR[getSeverity(behaviour)];
                          return (
                            <span
                              key={behaviour}
                              className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ backgroundColor: col.bg, borderColor: col.border, color: col.text }}
                              title={t("Time not specified")}
                            >
                              ~ {behaviour}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour axis footer (multi-day) */}
      {!isDayView && (
        <div className="flex overflow-hidden" style={{ marginLeft: dateLabelW }}>
          {HOUR_MARKS_AXIS.map((h, i, arr) =>
            i === arr.length - 1 ? null : (
              <div key={h} className="flex-1 text-[9px] text-fg-faint" style={{ flexBasis: `${(1 / (arr.length - 1)) * 100}%` }}>
                {String(h).padStart(2, "0")}
              </div>
            )
          )}
        </div>
      )}

      {/* Disturbance legend (day view only) */}
      {isDayView && (
        <div className="rounded-md border border-line-subtle bg-surface-muted p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">{t("Disturbance Level")}</p>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((l) => (
              <div key={l} className="flex items-center gap-1.5 text-xs text-fg-muted">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: DISTURBANCE_COLOR[l] }} />
                L{l} — {DISTURBANCE_LABELS[l]}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drill-down hint for multi-day */}
      {!isDayView && onDrillDown && (
        <p className="text-[10px] text-fg-faint px-1">{t("Tap a day to view its detailed 24-hour timeline")}</p>
      )}

      {/* Episode detail popup */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center"
          onClick={() => setActive(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-elevated shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: SEVERITY_COLOR[getSeverity(active.behaviour)].dot }}
                />
                <span className="font-semibold text-fg">{active.behaviour}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: SEVERITY_COLOR[getSeverity(active.behaviour)].bg,
                    color: SEVERITY_COLOR[getSeverity(active.behaviour)].text,
                  }}
                >
                  {t(SEVERITY_LABEL[getSeverity(active.behaviour)])}
                </span>
                <span className="text-xs text-fg-faint">{active.category}</span>
              </div>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="shrink-0 rounded-full p-1 text-fg-faint hover:text-fg-muted hover:bg-surface-strong"
                aria-label="Close"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-fg-faint">{t("Date")}</dt>
                <dd className="font-medium text-fg">
                  {active.started_at ? formatMYTDate(active.started_at) : "—"}
                </dd>
              </div>
              {active.started_at && active.ended_at ? (
                <>
                  <div>
                    <dt className="text-xs text-fg-faint">{t("Duration")}</dt>
                    <dd className="font-medium text-fg">{durationLabel(active.started_at, active.ended_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-fg-faint">{t("Start time")}</dt>
                    <dd className="font-medium text-fg">{formatMYTTime(active.started_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-fg-faint">{t("End time")}</dt>
                    <dd className="font-medium text-fg">{formatMYTTime(active.ended_at)}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt className="text-xs text-fg-faint">{t("Time")}</dt>
                  <dd className="text-fg-subtle italic text-sm">{t("Not specified")}</dd>
                </div>
              )}
            </dl>

            {active.note && (
              <div className="rounded-md bg-surface-muted p-2.5 text-sm text-fg-secondary">
                <span className="text-xs font-medium text-fg-faint block mb-0.5">{t("Note")}</span>
                {active.note}
              </div>
            )}
            {active.staffName && (
              <div className="text-xs text-fg-faint">
                {t("Entered by")}: <span className="text-fg-muted">{active.staffName}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
