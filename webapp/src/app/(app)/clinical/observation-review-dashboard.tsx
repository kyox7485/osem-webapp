"use client";

import { useState } from "react";
import { formatDateTime, formatDate } from "@/lib/format-date";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ObservationEntry } from "./observation-chart-actions";
import type { ObservationStatusRow } from "./observation-status-actions";

type Props = {
  entries: ObservationEntry[];
  activeEpisodes: ObservationStatusRow[];
  completedEpisodes: ObservationStatusRow[];
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

const TIME_ZONE = "Asia/Kuala_Lumpur";

function todayMYT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function daysAgoMYT(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return d.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function dateKeyMYT(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

// Returns the number of days spanned by [start, end], or 0 when either is
// missing (custom filter not yet applied).
function calcDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(`${start}T12:00:00+08:00`);
  const e = new Date(`${end}T12:00:00+08:00`);
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

function formatDuration(startedAt: string, t: (s: string) => string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const totalHours = Math.max(0, Math.floor(ms / 3600000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0) return `${hours}${t("h")}`;
  return `${days}${t("d")} ${hours}${t("h")}`;
}

const yesNo = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : null);
const val = (v: string | number | null | undefined) => (v != null && v !== "" ? String(v) : null);

type ComparisonRow = { label: string; previous: string | null; latest: string | null };

function behaviorLabel(entry: ObservationEntry): string | null {
  const parts = [...(entry.behavior ?? []), ...(entry.behavior_other ? [`Others: ${entry.behavior_other}`] : [])];
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildComparisonRows(latest: ObservationEntry, previous: ObservationEntry | undefined): ComparisonRow[] {
  const bp = (e: ObservationEntry) =>
    e.systolic_bp != null || e.diastolic_bp != null ? `${val(e.systolic_bp) ?? "--"}/${val(e.diastolic_bp) ?? "--"} mmHg` : null;

  const rows: Array<[string, string | null, string | null]> = [
    ["BP", previous ? bp(previous) : null, bp(latest)],
    ["HR", previous ? (val(previous.heart_rate) ? `${val(previous.heart_rate)} bpm` : null) : null, val(latest.heart_rate) ? `${val(latest.heart_rate)} bpm` : null],
    ["Temperature", previous ? (val(previous.temperature) ? `${val(previous.temperature)}°C` : null) : null, val(latest.temperature) ? `${val(latest.temperature)}°C` : null],
    ["SpO₂", previous ? (val(previous.spo2) ? `${val(previous.spo2)}%` : null) : null, val(latest.spo2) ? `${val(latest.spo2)}%` : null],
    ["DXT", previous ? (val(previous.dxt) ? `${val(previous.dxt)} mmol/L` : null) : null, val(latest.dxt) ? `${val(latest.dxt)} mmol/L` : null],
    ["SOB / Cough", previous ? yesNo(previous.sob_cough) : null, yesNo(latest.sob_cough)],
    ["Pain", previous ? yesNo(previous.pain) : null, yesNo(latest.pain)],
    ["Vomiting", previous ? yesNo(previous.vomiting) : null, yesNo(latest.vomiting)],
    ["Diarrhea", previous ? yesNo(previous.diarrhea) : null, yesNo(latest.diarrhea)],
    ["Wound", previous ? val(previous.wound) : null, val(latest.wound)],
    ["Appetite", previous ? val(previous.appetite) : null, val(latest.appetite)],
    ["Urine", previous ? val(previous.urine) : null, val(latest.urine)],
    ["Behavior", previous ? behaviorLabel(previous) : null, behaviorLabel(latest)],
    ["AVPU", previous ? val(previous.avpu) : null, val(latest.avpu)],
    ["Active Issue", previous ? val(previous.active_issue) : null, val(latest.active_issue)],
  ];

  // Only show rows that have a current value -- an empty latest with an
  // empty previous carries no information worth a row.
  return rows.filter(([, , latestVal]) => latestVal != null).map(([label, previousVal, latestVal]) => ({ label, previous: previousVal, latest: latestVal }));
}

export function ObservationReviewDashboard({ entries, activeEpisodes, completedEpisodes, currentStart, currentEnd, error }: Props) {
  const push = useNavPush();
  const t = useTranslation();
  const [expandedResidentId, setExpandedResidentId] = useState<number | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(currentStart || daysAgoMYT(3));
  const [customTo, setCustomTo] = useState(currentEnd || todayMYT());

  const days = calcDays(currentStart, currentEnd) || 3;
  const isCustom = days !== 3 && days !== 7;

  function applyRange(n: 3 | 7) {
    setShowCustom(false);
    const params = new URLSearchParams();
    params.set("tab", "observation-chart");
    params.set("start", daysAgoMYT(n));
    params.set("end", todayMYT());
    push(`/clinical?${params.toString()}`);
  }

  function applyCustom() {
    if (!customFrom || !customTo || customTo < customFrom) return;
    setShowCustom(false);
    const params = new URLSearchParams();
    params.set("tab", "observation-chart");
    params.set("start", customFrom);
    params.set("end", customTo);
    push(`/clinical?${params.toString()}`);
  }

  const entriesByResident = new Map<number, ObservationEntry[]>();
  for (const entry of entries) {
    const list = entriesByResident.get(entry.resident_id) ?? [];
    list.push(entry);
    entriesByResident.set(entry.resident_id, list);
  }

  const today = todayMYT();

  return (
    <div className="space-y-4">
      {/* Date filter */}
      <div className="rounded-md border border-line bg-surface p-4 shadow-sm space-y-3">
        <div>
          <p className="mb-1 text-sm font-medium text-fg-secondary">{t("Period")}</p>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => applyRange(3)}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                days === 3 && !isCustom && !showCustom ? "border-indigo-600 bg-indigo-600 text-white" : "border-line-strong bg-surface text-fg-secondary hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-300"
              }`}
            >
              3 {t("Days")}
            </button>
            <button
              type="button"
              onClick={() => applyRange(7)}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                days === 7 && !isCustom && !showCustom ? "border-indigo-600 bg-indigo-600 text-white" : "border-line-strong bg-surface text-fg-secondary hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-300"
              }`}
            >
              7 {t("Days")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCustom((v) => !v);
                setCustomFrom(currentStart || daysAgoMYT(3));
                setCustomTo(currentEnd || todayMYT());
              }}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                isCustom || showCustom ? "border-indigo-600 bg-indigo-600 text-white" : "border-line-strong bg-surface text-fg-secondary hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-300"
              }`}
            >
              {t("Custom")}
            </button>
          </div>
        </div>

        {showCustom && (
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">{t("From")}</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">{t("To")}</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!customFrom || !customTo || customTo < customFrom}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {t("Apply")}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="rounded-md border border-indigo-100 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 text-sm font-medium text-indigo-900 dark:text-indigo-200">
        {activeEpisodes.length} {t("residents currently under observation")}
      </div>

      {activeEpisodes.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-fg-faint">
          {t("No residents are currently under observation.")}
        </div>
      ) : (
        <div className="space-y-3">
          {activeEpisodes.map((episode) => {
            const residentEntries = entriesByResident.get(episode.resident_id) ?? [];
            const latest = residentEntries[0];
            const previous = residentEntries[1];
            const residentName = episode.tbl_residents?.resident_name ?? "--";
            const startedBy = episode.starter?.staff_name ?? episode.started_by_other ?? "--";
            const hasReportToday = residentEntries.some((e) => dateKeyMYT(e.entry_timestamp) === today);
            const isExpanded = expandedResidentId === episode.resident_id;
            const comparisonRows = latest ? buildComparisonRows(latest, previous) : [];

            // Group this resident's entries by day, newest first, preserving
            // multiple entries on the same day.
            const timelineByDate = new Map<string, ObservationEntry[]>();
            for (const e of residentEntries) {
              const key = dateKeyMYT(e.entry_timestamp);
              const list = timelineByDate.get(key) ?? [];
              list.push(e);
              timelineByDate.set(key, list);
            }

            return (
              <div key={episode.id} className="rounded-md border border-line bg-surface shadow-sm">
                <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-fg">{residentName}</p>
                      <p className="text-xs text-fg-subtle">
                        {t("Under observation for")} {formatDuration(episode.started_at, t)} · {t("started by")} {startedBy}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        hasReportToday ? "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300" : "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300"
                      }`}
                    >
                      {hasReportToday ? t("Today's report done") : t("No report today yet")}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
                    <span>{residentEntries.length} {t("reports in period")}</span>
                    {latest && (
                      <span>
                        {t("Latest")}: {formatDateTime(latest.entry_timestamp)} — {latest.tbl_staff?.staff_name ?? latest.created_by_other ?? "--"}
                      </span>
                    )}
                  </div>

                  {!latest ? (
                    <p className="mt-3 text-sm text-fg-faint">{t("No observation chart entries in this period.")}</p>
                  ) : (
                    <div className="mt-3 space-y-1 border-t border-line-subtle pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                        {previous ? t("Latest vs previous entry") : t("Latest entry")}
                      </p>
                      <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-fg-secondary sm:grid-cols-2">
                        {comparisonRows.map((row) => (
                          <div key={row.label} className="flex justify-between gap-2">
                            <span className="text-fg-faint">{t(row.label)}</span>
                            <span>
                              {row.previous != null && row.previous !== row.latest && (
                                <span className="text-fg-faint line-through decoration-line-strong">{row.previous}</span>
                              )}{" "}
                              <span className="font-medium">{row.latest}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {residentEntries.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpandedResidentId(isExpanded ? null : episode.resident_id)}
                      className="mt-3 flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {t("Timeline")}
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div className="space-y-3 border-t border-line-subtle bg-surface-muted p-4">
                    {[...timelineByDate.entries()].map(([dateKey, dayEntries]) => (
                      <div key={dateKey}>
                        <p className="mb-1 text-xs font-semibold text-fg-subtle">{formatDate(dayEntries[0].entry_timestamp)}</p>
                        <div className="space-y-2">
                          {dayEntries.map((e) => (
                            <div key={e.id} className="rounded-md border border-line bg-surface p-3 text-sm shadow-sm">
                              <div className="mb-1 flex justify-between text-xs text-fg-faint">
                                <span>{formatDateTime(e.entry_timestamp)}</span>
                                <span>{e.tbl_staff?.staff_name ?? e.created_by_other ?? "--"}</span>
                              </div>
                              {e.active_issue && <p className="mb-1 text-sm font-medium text-amber-700 dark:text-amber-300">⚠️ {e.active_issue}</p>}
                              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-fg-secondary sm:grid-cols-3">
                                <span>BP: {val(e.systolic_bp) ?? "--"}/{val(e.diastolic_bp) ?? "--"}</span>
                                <span>HR: {val(e.heart_rate) ?? "--"}</span>
                                <span>Temp: {val(e.temperature) ?? "--"}°C</span>
                                <span>SpO₂: {val(e.spo2) ?? "--"}%</span>
                                <span>DXT: {val(e.dxt) ?? "--"}</span>
                                <span>AVPU: {val(e.avpu) ?? "--"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Completed observations */}
      <div className="rounded-md border border-line bg-surface shadow-sm">
        <button
          type="button"
          onClick={() => setShowCompleted((v) => !v)}
          className="flex w-full items-center gap-1 px-4 py-3 text-sm font-medium text-fg-secondary"
        >
          {showCompleted ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {t("Completed Observations")} ({completedEpisodes.length})
        </button>
        {showCompleted && (
          <div className="space-y-2 border-t border-line-subtle p-4">
            {completedEpisodes.length === 0 ? (
              <p className="text-sm text-fg-faint">{t("No completed observation episodes.")}</p>
            ) : (
              completedEpisodes.map((ep) => (
                <div key={ep.id} className="rounded-md border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-fg">{ep.tbl_residents?.resident_name ?? "--"}</span>
                    <span className="text-xs text-fg-subtle">
                      {formatDate(ep.started_at)} → {ep.ended_at ? formatDate(ep.ended_at) : "--"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {t("Ended reason")}: {ep.end_reason ?? "--"} · {t("ended by")} {ep.ender?.staff_name ?? ep.ended_by_other ?? "--"}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
