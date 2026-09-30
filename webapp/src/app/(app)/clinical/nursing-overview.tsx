"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/format-date";
import { AdminRecordControls } from "@/components/admin-record-controls";
import { PdfDownloadLink } from "@/components/pdf-download-link";
import type { NursingChartEntry, RawMeal, RawHygieneEpisode, RawEliminationEpisode } from "./nursing-chart-module";
import type { ClinicalLookups } from "@/lib/lookups";
import type { TranslateParams } from "@/lib/i18n/translate";

type T = (text: string, params?: TranslateParams) => string;

// ─── Date helpers (MYT, no import from lib/lookups -- pure logic) ─────────────

function localDateMYT(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
  });
}

// ─── Fluid Balance Trend (SVG) ────────────────────────────────────────────────

type FluidPoint = { date: string; label: string; input: number | null; output: number | null };

export function NursingFluidTrend({ entries, t }: { entries: NursingChartEntry[]; t: T }) {
  // Aggregate per calendar day (MYT) — sum input/output across all entries for that day.
  // Missing data ≠ zero: only days with at least one non-null value appear.
  const byDay = new Map<string, { input: number | null; output: number | null }>();
  for (const e of entries) {
    const d = localDateMYT(e.entry_timestamp);
    const prev = byDay.get(d) ?? { input: null, output: null };
    const newIn = e.fluid_input != null ? (prev.input ?? 0) + e.fluid_input : prev.input;
    const newOut = e.fluid_output != null ? (prev.output ?? 0) + e.fluid_output : prev.output;
    byDay.set(d, { input: newIn, output: newOut });
  }

  const points: FluidPoint[] = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, label: dateLabel(`${date}T12:00:00+08:00`), ...v }));

  const hasData = points.some((p) => p.input != null || p.output != null);
  if (!hasData) {
    return <p className="py-4 text-center text-sm text-fg-faint">{t("No data recorded.")}</p>;
  }

  const W = 560;
  const H = 140;
  const PL = 44;
  const PR = 16;
  const PT = 12;
  const PB = 28;
  const CW = W - PL - PR;
  const CH = H - PT - PB;

  const allVals = points.flatMap((p) => [p.input, p.output]).filter((v): v is number => v != null);
  const maxVal = Math.max(...allVals, 1);
  const niceMax = Math.ceil(maxVal / 100) * 100 || 100;

  const xOf = (i: number) => (points.length === 1 ? PL + CW / 2 : PL + (i / (points.length - 1)) * CW);
  const yOf = (v: number) => PT + CH - (v / niceMax) * CH;

  const gridVals = [0, Math.round(niceMax * 0.5), niceMax];

  function buildLine(key: "input" | "output") {
    const segs: string[] = [];
    let inSeg = false;
    for (let i = 0; i < points.length; i++) {
      const v = points[i][key];
      if (v != null) {
        segs.push(`${inSeg ? "L" : "M"} ${xOf(i)} ${yOf(v)}`);
        inSeg = true;
      } else {
        inSeg = false;
      }
    }
    return segs.join(" ");
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block overflow-visible" role="img" aria-label={t("Fluid Balance Trend")}>
        {gridVals.map((v) => {
          const y = yOf(v);
          return (
            <g key={v}>
              <line x1={PL} y1={y} x2={PL + CW} y2={y} stroke="#f1f5f9" strokeWidth="1" className="dark:stroke-line" />
              <text x={PL - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="#94a3b8" fontFamily="inherit">{v}</text>
            </g>
          );
        })}
        <path d={buildLine("input")} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={buildLine("output")} fill="none" stroke="#f97316" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 3" />
        {points.map((p, i) => (
          <g key={i}>
            {p.input != null && (
              <g>
                <circle cx={xOf(i)} cy={yOf(p.input)} r="8" fill="transparent" />
                <circle cx={xOf(i)} cy={yOf(p.input)} r="3.5" fill="#6366f1" stroke="white" strokeWidth="1.5" className="dark:stroke-surface" />
                <title>{`${p.label} ${t("Input")}: ${p.input} ${t("ml")}`}</title>
              </g>
            )}
            {p.output != null && (
              <g>
                <circle cx={xOf(i)} cy={yOf(p.output)} r="8" fill="transparent" />
                <circle cx={xOf(i)} cy={yOf(p.output)} r="3.5" fill="#f97316" stroke="white" strokeWidth="1.5" className="dark:stroke-surface" />
                <title>{`${p.label} ${t("Output")}: ${p.output} ${t("ml")}`}</title>
              </g>
            )}
          </g>
        ))}
        {points.map((p, i) => {
          const skip = points.length > 8 && i % 3 !== 0 && i !== points.length - 1;
          if (skip) return null;
          return (
            <text key={i} x={xOf(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="inherit">{p.label}</text>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 justify-center text-xs text-fg-faint">
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-indigo-500 rounded" />{t("Input")}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-orange-400 rounded border-b border-dashed border-orange-400" style={{ borderBottom: "2px dashed #f97316", background: "none", display: "inline-block", height: 0 }} />{t("Output")}</span>
      </div>
    </div>
  );
}

// ─── Meal / Feeding matrix ────────────────────────────────────────────────────

type MealRow = { date: string; label: string; oral: string[]; tube: string[]; aspirate: number | null };

const TUBE_TYPES = ["tube", "tiub", "ng", "peg", "nasogastric"];

function isTubeMeal(meal: RawMeal, lookups: ClinicalLookups): boolean {
  if (meal.meal_type_other) {
    return TUBE_TYPES.some((k) => meal.meal_type_other!.toLowerCase().includes(k));
  }
  if (meal.meal_type_id) {
    const label = lookups.mealTypes.find((m) => Number(m.id) === meal.meal_type_id)?.label ?? "";
    return TUBE_TYPES.some((k) => label.toLowerCase().includes(k));
  }
  return false;
}

function mealLabel(meal: RawMeal, lookups: ClinicalLookups): string {
  const type = meal.meal_type_other || lookups.mealTypes.find((m) => Number(m.id) === meal.meal_type_id)?.label || "";
  const portion = meal.meal_portion_other || lookups.mealPortions.find((m) => Number(m.id) === meal.meal_portion_id)?.label || "";
  const time = lookups.feedingTimes.find((m) => Number(m.id) === meal.feeding_time_id)?.label || "";
  return [time, type, portion, meal.feeding_volume].filter(Boolean).join(" ");
}

export function NursingMealMatrix({ entries, lookups, t }: { entries: NursingChartEntry[]; lookups: ClinicalLookups; t: T }) {
  const byDay = new Map<string, MealRow>();
  for (const e of entries) {
    const d = localDateMYT(e.entry_timestamp);
    if (!byDay.has(d)) byDay.set(d, { date: d, label: dateLabel(`${d}T12:00:00+08:00`), oral: [], tube: [], aspirate: null });
    const row = byDay.get(d)!;
    for (const m of e.raw_meals) {
      if (isTubeMeal(m, lookups)) {
        row.tube.push(mealLabel(m, lookups));
        if (m.aspirate_amount != null) {
          row.aspirate = (row.aspirate ?? 0) + m.aspirate_amount;
        }
      } else {
        row.oral.push(mealLabel(m, lookups));
      }
    }
  }

  const rows = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0 || rows.every((r) => r.oral.length === 0 && r.tube.length === 0)) {
    return <p className="py-4 text-center text-sm text-fg-faint">{t("No data recorded.")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line-subtle">
            <th className="py-1.5 pr-2 text-left font-medium text-fg-subtle">{t("Date")}</th>
            <th className="px-2 py-1.5 text-left font-medium text-fg-subtle">{t("Oral feeds")}</th>
            <th className="px-2 py-1.5 text-left font-medium text-fg-subtle">{t("Tube feeds")}</th>
            <th className="py-1.5 pl-2 text-right font-medium text-fg-subtle">{t("Aspirate")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((r) => (
            <tr key={r.date} className="hover:bg-hover">
              <td className="py-1.5 pr-2 font-medium text-fg whitespace-nowrap">{r.label}</td>
              <td className="px-2 py-1.5 text-fg-secondary">
                {r.oral.length > 0 ? <ul className="space-y-0.5">{r.oral.map((s, i) => <li key={i}>{s}</li>)}</ul> : <span className="text-fg-faint">—</span>}
              </td>
              <td className="px-2 py-1.5 text-fg-secondary">
                {r.tube.length > 0 ? <ul className="space-y-0.5">{r.tube.map((s, i) => <li key={i}>{s}</li>)}</ul> : <span className="text-fg-faint">—</span>}
              </td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-fg-secondary">
                {r.aspirate != null ? `${r.aspirate} ${t("ml")}` : <span className="text-fg-faint">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Elimination matrix ───────────────────────────────────────────────────────

type ElimRow = { date: string; label: string; bowel: string[]; urine: string[] };

export function NursingEliminationMatrix({ entries, lookups, t }: { entries: NursingChartEntry[]; lookups: ClinicalLookups; t: T }) {
  const bowelById = new Map(lookups.bowelOutputTypes.map((o) => [Number(o.id), o.label]));
  const urineById = new Map(lookups.passUrineTypes.map((o) => [Number(o.id), o.label]));

  const byDay = new Map<string, ElimRow>();
  for (const e of entries) {
    const d = localDateMYT(e.entry_timestamp);
    if (!byDay.has(d)) byDay.set(d, { date: d, label: dateLabel(`${d}T12:00:00+08:00`), bowel: [], urine: [] });
    const row = byDay.get(d)!;
    for (const ep of e.raw_elimination) {
      for (const id of ep.bowel_output_ids ?? []) {
        const lbl = bowelById.get(id);
        if (lbl) row.bowel.push(lbl);
      }
      if (ep.pass_urine_id) {
        const lbl = urineById.get(ep.pass_urine_id);
        if (lbl) row.urine.push(lbl);
      }
    }
  }

  const rows = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0 || rows.every((r) => r.bowel.length === 0 && r.urine.length === 0)) {
    return <p className="py-4 text-center text-sm text-fg-faint">{t("No data recorded.")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line-subtle">
            <th className="py-1.5 pr-2 text-left font-medium text-fg-subtle">{t("Date")}</th>
            <th className="px-2 py-1.5 text-left font-medium text-fg-subtle">{t("Bowel")}</th>
            <th className="py-1.5 pl-2 text-left font-medium text-fg-subtle">{t("Urine")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((r) => (
            <tr key={r.date} className="hover:bg-hover">
              <td className="py-1.5 pr-2 font-medium text-fg whitespace-nowrap">{r.label}</td>
              <td className="px-2 py-1.5 text-fg-secondary">
                {r.bowel.length > 0
                  ? r.bowel.map((s, i) => <span key={i} className="mr-1 inline-block rounded bg-surface-strong px-1">{t(s)}</span>)
                  : <span className="text-fg-faint">—</span>}
              </td>
              <td className="py-1.5 pl-2 text-fg-secondary">
                {r.urine.length > 0
                  ? r.urine.map((s, i) => <span key={i} className="mr-1 inline-block rounded bg-surface-strong px-1">{t(s)}</span>)
                  : <span className="text-fg-faint">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Hygiene / ADL matrix ─────────────────────────────────────────────────────

type HygieneRow = { date: string; label: string; bySelf: string[]; withAssist: string[] };

export function NursingHygieneMatrix({ entries, lookups, t }: { entries: NursingChartEntry[]; lookups: ClinicalLookups; t: T }) {
  const actById = new Map(lookups.hygieneCareActivities.map((o) => [Number(o.id), o.label]));

  const byDay = new Map<string, HygieneRow>();
  for (const e of entries) {
    const d = localDateMYT(e.entry_timestamp);
    if (!byDay.has(d)) byDay.set(d, { date: d, label: dateLabel(`${d}T12:00:00+08:00`), bySelf: [], withAssist: [] });
    const row = byDay.get(d)!;
    for (const h of e.raw_hygiene) {
      const acts = (h.activity_ids ?? []).map((id) => actById.get(id)).filter((v): v is string => !!v);
      if (h.assistance_level === "By Self") {
        row.bySelf.push(...acts);
      } else {
        row.withAssist.push(...acts);
      }
    }
  }

  const rows = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0 || rows.every((r) => r.bySelf.length === 0 && r.withAssist.length === 0)) {
    return <p className="py-4 text-center text-sm text-fg-faint">{t("No data recorded.")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line-subtle">
            <th className="py-1.5 pr-2 text-left font-medium text-fg-subtle">{t("Date")}</th>
            <th className="px-2 py-1.5 text-left font-medium text-emerald-600 dark:text-emerald-400">S – {t("By Self")}</th>
            <th className="py-1.5 pl-2 text-left font-medium text-indigo-600 dark:text-indigo-400">A – {t("With Assistance")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((r) => (
            <tr key={r.date} className="hover:bg-hover">
              <td className="py-1.5 pr-2 font-medium text-fg whitespace-nowrap">{r.label}</td>
              <td className="px-2 py-1.5 text-fg-secondary">
                {r.bySelf.length > 0
                  ? r.bySelf.map((s, i) => <span key={i} className="mr-1 inline-block rounded bg-emerald-50 dark:bg-emerald-950/30 px-1 text-emerald-700 dark:text-emerald-300">{t(s)}</span>)
                  : <span className="text-fg-faint">—</span>}
              </td>
              <td className="py-1.5 pl-2 text-fg-secondary">
                {r.withAssist.length > 0
                  ? r.withAssist.map((s, i) => <span key={i} className="mr-1 inline-block rounded bg-indigo-50 dark:bg-indigo-950/30 px-1 text-indigo-700 dark:text-indigo-300">{t(s)}</span>)
                  : <span className="text-fg-faint">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Condition matrix (Activity / Complaint / Behaviour / Disturbance) ────────

type CondRow = { date: string; label: string; activity: string[]; complaints: string[]; psycho: string[]; disturbance: string[] };

export function NursingConditionMatrix({ entries, lookups, t }: { entries: NursingChartEntry[]; lookups: ClinicalLookups; t: T }) {
  const actById = new Map(lookups.activities.map((o) => [Number(o.id), o.label]));
  const complById = new Map(lookups.activeComplaints.map((o) => [Number(o.id), o.label]));
  const psychoById = new Map(lookups.psychoSocialBehaviours.map((o) => [Number(o.id), o.label]));
  const distById = new Map(lookups.disturbanceLevels.map((o) => [Number(o.id), o.label]));

  const byDay = new Map<string, CondRow>();
  for (const e of entries) {
    const d = localDateMYT(e.entry_timestamp);
    if (!byDay.has(d)) byDay.set(d, { date: d, label: dateLabel(`${d}T12:00:00+08:00`), activity: [], complaints: [], psycho: [], disturbance: [] });
    const row = byDay.get(d)!;
    for (const id of e.activity_ids ?? []) {
      const lbl = actById.get(id);
      if (lbl && !row.activity.includes(lbl)) row.activity.push(lbl);
    }
    for (const id of e.active_complaint_ids ?? []) {
      const lbl = complById.get(id);
      if (lbl && !row.complaints.includes(lbl)) row.complaints.push(lbl);
    }
    for (const id of e.psycho_social_behaviour_ids ?? []) {
      const lbl = psychoById.get(id);
      if (lbl && !row.psycho.includes(lbl)) row.psycho.push(lbl);
    }
    for (const id of e.disturbance_level_ids ?? []) {
      const lbl = distById.get(id);
      if (lbl && !row.disturbance.includes(lbl)) row.disturbance.push(lbl);
    }
  }

  const rows = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  const hasAny = rows.some((r) => r.activity.length > 0 || r.complaints.length > 0 || r.psycho.length > 0 || r.disturbance.length > 0);
  if (!hasAny) return <p className="py-4 text-center text-sm text-fg-faint">{t("No data recorded.")}</p>;

  function Tags({ items }: { items: string[] }) {
    if (items.length === 0) return <span className="text-fg-faint">—</span>;
    return <>{items.map((s, i) => <span key={i} className="mr-1 inline-block rounded bg-surface-strong px-1">{t(s)}</span>)}</>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line-subtle">
            <th className="py-1.5 pr-2 text-left font-medium text-fg-subtle">{t("Date")}</th>
            <th className="px-2 py-1.5 text-left font-medium text-fg-subtle">{t("Activity")}</th>
            <th className="px-2 py-1.5 text-left font-medium text-fg-subtle">{t("Active complaint")}</th>
            <th className="px-2 py-1.5 text-left font-medium text-fg-subtle">{t("Psycho-social behaviour")}</th>
            <th className="py-1.5 pl-2 text-left font-medium text-fg-subtle">{t("Disturbance level")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((r) => (
            <tr key={r.date} className="hover:bg-hover">
              <td className="py-1.5 pr-2 font-medium text-fg whitespace-nowrap">{r.label}</td>
              <td className="px-2 py-1.5"><Tags items={r.activity} /></td>
              <td className="px-2 py-1.5"><Tags items={r.complaints} /></td>
              <td className="px-2 py-1.5"><Tags items={r.psycho} /></td>
              <td className="py-1.5 pl-2"><Tags items={r.disturbance} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Nursing Timeline (chronological card list) ───────────────────────────────

export function NursingTimeline({ entries, t }: { entries: NursingChartEntry[]; t: T }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (entries.length === 0) {
    return <p className="py-4 text-center text-sm text-fg-faint">{t("No data recorded.")}</p>;
  }

  const TAG_GROUPS: [keyof NursingChartEntry, string][] = [
    ["elimination_labels", "Diaper checks"],
    ["activity_labels", "Activity"],
    ["disturbance_level_labels", "Disturbance level"],
    ["psycho_social_labels", "Psycho-social behaviour"],
    ["active_complaint_labels", "Active complaint"],
    ["meal_labels", "Meals"],
    ["hygiene_labels", "Hygiene care"],
  ];

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const isExpanded = expandedId === entry.id;
        const tagGroups = TAG_GROUPS.filter(([key]) => (entry[key] as string[]).length > 0);
        return (
          <div
            key={entry.id}
            onClick={() => setExpandedId(isExpanded ? null : entry.id)}
            className="cursor-pointer rounded-md border border-line bg-surface p-3 shadow-sm transition-colors hover:border-indigo-200 dark:hover:border-indigo-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-fg-secondary">{formatDateTime(entry.entry_timestamp)}</span>
              <span className="flex items-center gap-2 text-xs text-fg-faint">
                <PdfDownloadLink href={`/api/reports/nursing-chart?id=${entry.id}`} />
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className={`text-fg-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                  <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>

            {!isExpanded && (
              <p className="mt-1 text-xs text-fg-faint">
                {tagGroups.length > 0
                  ? `${tagGroups.length} ${t(tagGroups.length > 1 ? "areas" : "area")} ${t("recorded -- click to view")}`
                  : t("Click to view")}
              </p>
            )}

            {isExpanded && (
              <div className="mt-2 space-y-1.5 border-t border-line-subtle pt-2">
                {entry.tube_feeding && (
                  <p className="text-xs text-fg-muted"><span className="font-medium text-fg-subtle">{t("Tube feeding")}: </span>{entry.tube_feeding}</p>
                )}
                {tagGroups.map(([key, label]) => (
                  <p key={key} className="text-xs text-fg-muted">
                    <span className="font-medium text-fg-subtle">{t(label)}: </span>
                    {(entry[key] as string[]).join(key === "elimination_labels" ? " | " : ", ")}
                  </p>
                ))}
                {(entry.fluid_input !== null || entry.fluid_output !== null) && (
                  <p className="text-xs text-fg-muted"><span className="font-medium text-fg-subtle">{t("Fluid I/O")}: </span>{entry.fluid_input ?? "--"} / {entry.fluid_output ?? "--"} {t("ml")}</p>
                )}
                {entry.cbd_drainage && (
                  <p className="text-xs text-fg-muted"><span className="font-medium text-fg-subtle">{t("CBD drainage")}: </span>{entry.cbd_drainage}</p>
                )}
                {entry.intervention && (
                  <p className="text-xs text-fg-muted"><span className="font-medium text-fg-subtle">{t("Intervention")}: </span>{entry.intervention}</p>
                )}
                {entry.doctors_plan && (
                  <p className="text-xs text-fg-muted"><span className="font-medium text-fg-subtle">{t("Doctor's plan")}: </span>{entry.doctors_plan}</p>
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
              <span className="text-xs text-fg-faint">{t("Entered by")}: {entry.entered_by_name}</span>
              <AdminRecordControls kind="nursing_chart" id={entry.id} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

export function OverviewSection({ title, children }: { title: string; children: import("react").ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-surface shadow-sm">
      <div className="border-b border-line-subtle px-4 py-2.5">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
