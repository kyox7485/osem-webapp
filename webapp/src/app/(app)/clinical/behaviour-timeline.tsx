"use client";

import { useState, useCallback, useMemo } from "react";
import type { BehaviourEpisode, BehaviourEntry } from "./behaviour-chart-actions";
import { useTranslation } from "@/components/language-provider";

const TIME_ZONE = "Asia/Kuala_Lumpur";

const CATEGORY_COLOR: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  Verbal:   { bg: "#DBEAFE", border: "#3B82F6", text: "#1D4ED8", dot: "#3B82F6" },
  Physical: { bg: "#FEF3C7", border: "#F59E0B", text: "#B45309", dot: "#F59E0B" },
  Mood:     { bg: "#EDE9FE", border: "#8B5CF6", text: "#6D28D9", dot: "#8B5CF6" },
  Restraint:{ bg: "#D1FAE5", border: "#10B981", text: "#065F46", dot: "#10B981" },
};

const DISTURBANCE_COLOR: Record<number, string> = {
  0: "#6EE7B7", // green
  1: "#93C5FD", // blue
  2: "#FCD34D", // yellow
  3: "#FB923C", // orange
  4: "#F87171", // red
};

const DISTURBANCE_LABELS: Record<number, string> = {
  0: "No disturb",
  1: "Occasionally sound",
  2: "Frequent sound (others can sleep)",
  3: "Frequent sound (others can't sleep)",
  4: "Persistent sound",
};

function getMYTDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function getMYTHours(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h + m / 60;
}

function formatMYTTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMYTDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function durationLabel(startIso: string, endIso: string): string {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function buildDateRange(endDate: string, days: number): string[] {
  // endDate is YYYY-MM-DD in MYT
  const result: string[] = [];
  const end = new Date(`${endDate}T00:00:00+08:00`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    result.push(d.toLocaleDateString("en-CA", { timeZone: TIME_ZONE }));
  }
  return result;
}

function formatDayLabel(dateStr: string, days: number): { day: string; month: string; weekday: string } {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  const day = d.toLocaleDateString("en-GB", { timeZone: TIME_ZONE, day: "numeric" });
  const month = d.toLocaleDateString("en-GB", { timeZone: TIME_ZONE, month: "short" });
  const weekday = d.toLocaleDateString("en-GB", { timeZone: TIME_ZONE, weekday: days <= 14 ? "short" : "narrow" });
  return { day, month, weekday };
}

type ActiveEpisode = BehaviourEpisode & { staffName?: string };

type Props = {
  episodes: BehaviourEpisode[];
  charts: BehaviourEntry[];
  days: number;
  endDate: string; // YYYY-MM-DD MYT
};

export function BehaviourTimeline({ episodes, charts, days, endDate }: Props) {
  const t = useTranslation();
  const [active, setActive] = useState<ActiveEpisode | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Map chart id → staff name
  const staffByChartId = useMemo(() => {
    const m = new Map<number, string>();
    for (const ch of charts) {
      const name = ch.tbl_staff?.staff_name ?? ch.created_by_other ?? null;
      if (name) m.set(ch.id, name);
    }
    return m;
  }, [charts]);

  // Map date → disturbance level (most recent chart for that date)
  const disturbanceByDate = new Map<string, number>();
  for (const ch of [...charts].reverse()) {
    const d = getMYTDateStr(ch.entry_timestamp);
    if (ch.disturbance_level != null) disturbanceByDate.set(d, ch.disturbance_level);
  }

  // Group episodes by MYT date
  const episodesByDate = new Map<string, BehaviourEpisode[]>();
  for (const ep of episodes) {
    const d = getMYTDateStr(ep.started_at);
    const list = episodesByDate.get(d) ?? [];
    list.push(ep);
    episodesByDate.set(d, list);
  }

  const dates = buildDateRange(endDate, days);
  const rowH = days <= 7 ? 64 : days <= 14 ? 44 : 28;
  const barH = days <= 7 ? 30 : days <= 14 ? 20 : 12;
  const showText = days <= 7;

  const handleEpisodeClick = useCallback((ep: BehaviourEpisode) => {
    const staffName = staffByChartId.get(ep.chart_id) ?? undefined;
    setActive({ ...ep, staffName });
  }, [staffByChartId]);

  const handleDayClick = useCallback((dateStr: string) => {
    if (days >= 30) {
      setExpandedDay((prev) => (prev === dateStr ? null : dateStr));
    }
  }, [days]);

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-1">
        {Object.entries(CATEGORY_COLOR).map(([cat, col]) => (
          <div key={cat} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: col.dot }} />
            {t(cat)}
          </div>
        ))}
      </div>

      {/* Timeline rows */}
      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white shadow-sm">
        {dates.map((dateStr, dIdx) => {
          const label = formatDayLabel(dateStr, days);
          const dayEpisodes = episodesByDate.get(dateStr) ?? [];
          const distLevel = disturbanceByDate.get(dateStr);
          const isExpanded = expandedDay === dateStr;
          const effectiveRowH = (days >= 30 && isExpanded) ? 64 : rowH;
          const effectiveBarH = (days >= 30 && isExpanded) ? 30 : barH;
          const showEpText = (days >= 30 && isExpanded) ? true : showText;

          return (
            <div
              key={dateStr}
              className={`flex border-b border-gray-100 last:border-b-0 ${days >= 30 ? "cursor-pointer hover:bg-gray-50" : ""}`}
              style={{ minHeight: `${effectiveRowH}px` }}
              onClick={days >= 30 ? () => handleDayClick(dateStr) : undefined}
            >
              {/* Date column */}
              <div
                className="flex shrink-0 flex-col items-end justify-center gap-0.5 border-r border-gray-100 pr-2 pl-3"
                style={{ width: days <= 7 ? 80 : days <= 14 ? 72 : 64, minWidth: days <= 7 ? 80 : days <= 14 ? 72 : 64 }}
              >
                <div className="text-center leading-none">
                  <div className="text-xs font-medium text-gray-400">{label.weekday}</div>
                  <div className={`font-bold leading-tight text-gray-800 ${days <= 7 ? "text-lg" : days <= 14 ? "text-base" : "text-sm"}`}>
                    {label.day}
                  </div>
                  <div className="text-xs text-gray-400">{label.month}</div>
                </div>
                {distLevel != null && (
                  <div
                    className="mt-1 rounded px-1 py-0.5 text-center"
                    style={{ fontSize: 9, backgroundColor: DISTURBANCE_COLOR[distLevel] + "40", color: "#374151" }}
                    title={`Level ${distLevel}: ${DISTURBANCE_LABELS[distLevel]}`}
                  >
                    L{distLevel}
                  </div>
                )}
              </div>

              {/* Timeline track */}
              <div className="relative flex-1 py-2 px-1" style={{ minHeight: `${effectiveRowH}px` }}>
                {/* Hour grid lines */}
                {[0, 6, 12, 18, 24].map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0"
                    style={{ left: `${(h / 24) * 100}%`, borderLeft: "1px dashed #E5E7EB", zIndex: 0 }}
                  />
                ))}
                {/* Hour labels (only 7-day) */}
                {days <= 7 && dIdx === 0 && (
                  <>
                    {[0, 6, 12, 18].map((h) => (
                      <div
                        key={h}
                        className="absolute top-0 text-[9px] text-gray-400 leading-none"
                        style={{ left: `${(h / 24) * 100}%`, paddingLeft: 2 }}
                      >
                        {String(h).padStart(2, "0")}:00
                      </div>
                    ))}
                  </>
                )}

                {/* Episode bars */}
                {dayEpisodes.map((ep) => {
                  const startH = getMYTHours(ep.started_at);
                  const endH = Math.min(getMYTHours(ep.ended_at), 24);
                  const leftPct = (startH / 24) * 100;
                  const widthPct = Math.max(((endH - startH) / 24) * 100, 0.5);
                  const col = CATEGORY_COLOR[ep.category] ?? CATEGORY_COLOR.Verbal;

                  return (
                    <button
                      key={ep.id}
                      type="button"
                      className="absolute rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        height: effectiveBarH,
                        top: "50%",
                        transform: "translateY(-50%)",
                        backgroundColor: col.bg,
                        border: `1px solid ${col.border}`,
                        zIndex: 1,
                        overflow: "hidden",
                        cursor: "pointer",
                        minWidth: 4,
                      }}
                      onClick={(e) => { e.stopPropagation(); handleEpisodeClick(ep); }}
                      aria-label={`${ep.behaviour} ${formatMYTTime(ep.started_at)}–${formatMYTTime(ep.ended_at)}`}
                    >
                      {showEpText && (
                        <span
                          className="block truncate px-1 leading-tight"
                          style={{ fontSize: 10, color: col.text, lineHeight: `${effectiveBarH}px` }}
                        >
                          {ep.behaviour}
                        </span>
                      )}
                    </button>
                  );
                })}

                {dayEpisodes.length === 0 && (
                  <div
                    className="absolute inset-y-0 flex items-center px-2"
                    style={{ fontSize: 10, color: "#D1D5DB" }}
                  >
                    {t("No episodes")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour axis for 7-day and 14-day */}
      {days <= 14 && (
        <div className="flex overflow-hidden" style={{ marginLeft: days <= 7 ? 80 : 72 }}>
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <div
              key={h}
              className="flex-1 text-center text-[9px] text-gray-400"
              style={{ flexBasis: `${(1 / 8) * 100}%` }}
            >
              {String(h).padStart(2, "0")}
            </div>
          ))}
        </div>
      )}

      {/* Disturbance legend */}
      {days <= 7 && (
        <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{t("Disturbance Level")}</p>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((l) => (
              <div key={l} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: DISTURBANCE_COLOR[l] }}
                />
                L{l} — {DISTURBANCE_LABELS[l]}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail popup */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={() => setActive(null)}>
          <div
            className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLOR[active.category]?.dot ?? "#6B7280" }}
                />
                <span className="font-semibold text-gray-900">{active.behaviour}</span>
                <span className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: (CATEGORY_COLOR[active.category]?.bg ?? "#F3F4F6"),
                    color: (CATEGORY_COLOR[active.category]?.text ?? "#374151"),
                  }}
                >
                  {active.category}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="rounded-full p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                aria-label="Close"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-gray-400">{t("Date")}</dt>
                <dd className="font-medium text-gray-800">{formatMYTDate(active.started_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{t("Duration")}</dt>
                <dd className="font-medium text-gray-800">{durationLabel(active.started_at, active.ended_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{t("Start time")}</dt>
                <dd className="font-medium text-gray-800">{formatMYTTime(active.started_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{t("End time")}</dt>
                <dd className="font-medium text-gray-800">{formatMYTTime(active.ended_at)}</dd>
              </div>
            </dl>

            {active.note && (
              <div className="rounded-md bg-gray-50 p-2.5 text-sm text-gray-700">
                <span className="text-xs font-medium text-gray-400 block mb-0.5">{t("Note")}</span>
                {active.note}
              </div>
            )}

            {active.staffName && (
              <div className="text-xs text-gray-400">
                {t("Entered by")}: <span className="text-gray-600">{active.staffName}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
