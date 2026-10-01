// Server-rendered Call Bell analytics dashboard. All aggregation happens in
// page.tsx; this file only lays the results out.

import { BarChart3, BellRing, Clock, Gauge, Timer, Users } from "lucide-react";
import type { TranslateParams } from "@/lib/i18n/translate";
import { AnalyticsFilters } from "./filters";
import { CallsByHourChart, ResponseBucketBars } from "./charts";
import {
  formatDuration,
  type BellRow,
  type BranchStat,
  type CallKpis,
  type DisarmEvent,
  type DisarmSummary,
  type HourRow,
  type PatternRow,
  type PeriodKey,
  type ResponseBucket,
} from "./data";

type T = (text: string, params?: TranslateParams) => string;

function KpiCard({
  label,
  value,
  sub,
  tint,
  icon,
  t,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tint: string;
  icon: React.ReactNode;
  t: T;
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tint}`}>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums text-fg">{value}</p>
      <p className="mt-0.5 text-xs text-fg-subtle">{t(label)}</p>
      {sub && <p className="mt-0.5 text-[11px] text-fg-faint">{sub}</p>}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 rounded-md border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">{title}</h3>
        {hint && <p className="text-xs text-fg-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function TableShell({ head, children, colSpan }: { head: string[]; children: React.ReactNode; colSpan: number }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {children}
          {colSpan > 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-6 text-center text-fg-faint">
                —
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function CallbellDashboard({
  t,
  kpis,
  buckets,
  hourRows,
  bellRows,
  patternRows,
  disarms,
  disarmSummary,
  branchStats,
  rangeLabel,
  period,
  from,
  to,
  branch,
  branchOptions,
  nowMs,
}: {
  t: T;
  kpis: CallKpis;
  buckets: ResponseBucket[];
  hourRows: HourRow[];
  bellRows: BellRow[];
  patternRows: PatternRow[];
  disarms: DisarmEvent[];
  disarmSummary: DisarmSummary;
  branchStats: BranchStat[];
  rangeLabel: string;
  period: PeriodKey;
  from: string;
  to: string;
  branch: number;
  branchOptions: { id: number; label: string }[];
  /** Server render time — a disarm ending after this is still running. */
  nowMs: number;
}) {
  const kpisRangeNow = nowMs;
  const noCalls = kpis.totalCalls === 0;
  const answerRate = kpis.totalCalls > 0 ? Math.round((kpis.answeredCalls / kpis.totalCalls) * 100) : 0;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-bold text-fg">{t("Call Bell Analytics")}</h2>
        <span className="text-xs text-fg-faint">{rangeLabel}</span>
      </div>

      <div className="mt-3">
        <AnalyticsFilters period={period} from={from} to={to} branch={branch} branches={branchOptions} />
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          label="Total Calls"
          value={kpis.totalCalls}
          tint="bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
          icon={<BellRing className="h-4 w-4" />}
          t={t}
        />
        <KpiCard
          label="Answered Calls"
          value={kpis.answeredCalls}
          sub={noCalls ? undefined : t("{pct}% of calls", { pct: answerRate })}
          tint="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
          icon={<BarChart3 className="h-4 w-4" />}
          t={t}
        />
        <KpiCard
          label="Avg Response Time"
          value={formatDuration(kpis.avgResponseMs)}
          tint="bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
          icon={<Clock className="h-4 w-4" />}
          t={t}
        />
        <KpiCard
          label="Median Response Time"
          value={formatDuration(kpis.medianResponseMs)}
          tint="bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300"
          icon={<Gauge className="h-4 w-4" />}
          t={t}
        />
        <KpiCard
          label="Longest Response"
          value={formatDuration(kpis.longestResponseMs)}
          tint="bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
          icon={<Timer className="h-4 w-4" />}
          t={t}
        />
        <KpiCard
          label="Calls / Resident"
          value={kpis.callsPerResident === null ? "—" : kpis.callsPerResident.toFixed(1)}
          sub={kpis.callersCount > 0 ? t("{count} residents called", { count: kpis.callersCount }) : undefined}
          tint="bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
          icon={<Users className="h-4 w-4" />}
          t={t}
        />
      </div>

      {noCalls && (
        <p className="mb-4 rounded-md border border-line bg-surface px-4 py-6 text-center text-sm text-fg-faint shadow-sm">
          {t("No call records for the selected branch and date range.")}
        </p>
      )}

      {/* ── Response-time performance ──────────────────────────────────────── */}
      <Section
        title={t("Response Time Performance")}
        hint={t("Answered calls only, by how long staff took to attend")}
      >
        {kpis.answeredCalls === 0 ? (
          <p className="py-6 text-center text-sm text-fg-faint">{t("No answered calls in this period.")}</p>
        ) : (
          <ResponseBucketBars rows={buckets} t={t} />
        )}
      </Section>

      {/* ── Calls by hour ──────────────────────────────────────────────────── */}
      <Section title={t("Calls by Hour")} hint={t("Busiest hours of the day")}>
        {noCalls ? (
          <p className="py-10 text-center text-sm text-fg-faint">{t("No data.")}</p>
        ) : (
          <CallsByHourChart rows={hourRows} t={t} />
        )}
      </Section>

      {/* ── Call volume by bell ────────────────────────────────────────────── */}
      <Section title={t("Call Volume by Bell")} hint={t("Which bells generated the most calls")}>
        <TableShell head={[t("Bell No."), t("Resident"), t("Calls"), t("Avg Response")]} colSpan={bellRows.length === 0 ? 4 : 0}>
          {bellRows.map((b) => (
            <tr key={b.key} className="hover:bg-hover">
              <td className="px-4 py-2 font-medium text-fg">{b.bell_no}</td>
              <td className="px-4 py-2 text-fg-muted">{b.resident || "—"}</td>
              <td className="px-4 py-2 tabular-nums text-fg">{b.calls}</td>
              <td className="px-4 py-2 tabular-nums text-fg-muted">{formatDuration(b.avgResponseMs)}</td>
            </tr>
          ))}
        </TableShell>
        {bellRows.length > 50 && (
          <p className="mt-2 text-xs text-fg-faint">{t("Showing the 50 busiest bells.")}</p>
        )}
      </Section>

      {/* ── Frequent call patterns ─────────────────────────────────────────── */}
      <Section
        title={t("Frequent Call Patterns")}
        hint={t("Repeat calls from the same bell within 30 minutes — may be worth reviewing with the resident")}
      >
        <TableShell head={[t("Resident"), t("Bell No."), t("Period"), t("Calls")]} colSpan={patternRows.length === 0 ? 4 : 0}>
          {patternRows.map((p) => (
            <tr key={p.key} className="hover:bg-hover">
              <td className="px-4 py-2 font-medium text-fg">{p.resident}</td>
              <td className="px-4 py-2 text-fg-muted">{p.bell_no}</td>
              <td className="px-4 py-2 tabular-nums text-fg-muted">{p.periodLabel}</td>
              <td className="px-4 py-2 tabular-nums font-medium text-fg">{p.calls}</td>
            </tr>
          ))}
        </TableShell>
      </Section>

      {/* ── Branch comparison (multi-branch accounts only) ─────────────────── */}
      {branchStats.length > 1 && (
        <Section title={t("Branch Comparison")} hint={t("Same date range across every branch you can access")}>
          <TableShell
            head={[t("Branch"), t("Total Calls"), t("Answered Calls"), t("Avg Response Time")]}
            colSpan={branchStats.length === 0 ? 4 : 0}
          >
            {branchStats.map((b) => (
              <tr key={b.branch_id} className="hover:bg-hover">
                <td className="px-4 py-2 font-medium text-fg">{b.label}</td>
                <td className="px-4 py-2 tabular-nums text-fg">{b.totalCalls}</td>
                <td className="px-4 py-2 tabular-nums text-fg-muted">{b.answeredCalls}</td>
                <td className="px-4 py-2 tabular-nums text-fg-muted">{formatDuration(b.avgResponseMs)}</td>
              </tr>
            ))}
          </TableShell>
        </Section>
      )}

      {/* ── Temporary disarm activity ──────────────────────────────────────── */}
      <Section
        title={t("Temporary Disarm Activity")}
        hint={t("Bells temporarily silenced — calls made during a disarm are logged but not announced")}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Disarm Events"
            value={disarmSummary.events}
            tint="bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
            icon={<Timer className="h-4 w-4" />}
            t={t}
          />
          <KpiCard
            label="Total Disarmed Duration"
            value={formatDuration(disarmSummary.totalDurationMs)}
            tint="bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300"
            icon={<Clock className="h-4 w-4" />}
            t={t}
          />
          <KpiCard
            label="Average Disarm Duration"
            value={formatDuration(disarmSummary.avgDurationMs)}
            tint="bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
            icon={<Gauge className="h-4 w-4" />}
            t={t}
          />
          <KpiCard
            label="Most Disarm Events"
            value={disarmSummary.mostEventsResident || "—"}
            sub={disarmSummary.mostEventsCount > 0 ? t("{count} events", { count: disarmSummary.mostEventsCount }) : undefined}
            tint="bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
            icon={<Users className="h-4 w-4" />}
            t={t}
          />
        </div>

        <TableShell
          head={[t("Resident"), t("Bell No."), t("Start"), t("End"), t("Duration"), t("Reason"), t("Authorised By")]}
          colSpan={disarms.length === 0 ? 7 : 0}
        >
          {disarms.map((d, i) => (
            <tr key={`${d.device_num}-${d.startMs}-${i}`} className="hover:bg-hover">
              <td className="px-4 py-2 font-medium text-fg">{d.resident || "—"}</td>
              <td className="px-4 py-2 font-mono text-xs text-fg-muted">{d.bell_no || d.device_num || "—"}</td>
              <td className="px-4 py-2 whitespace-nowrap text-fg-muted">
                {new Intl.DateTimeFormat("en-MY", {
                  timeZone: "Asia/Kuala_Lumpur",
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date(d.startMs))}
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-fg-muted">
                {d.endMs > kpisRangeNow
                  ? t("Ongoing")
                  : new Intl.DateTimeFormat("en-MY", {
                      timeZone: "Asia/Kuala_Lumpur",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(d.endMs))}
              </td>
              <td className="px-4 py-2 tabular-nums text-fg">{formatDuration(d.durationMs)}</td>
              <td className="px-4 py-2 text-fg-muted">{d.reason || "—"}</td>
              <td className="px-4 py-2 text-fg-muted">{d.authorized_by || "—"}</td>
            </tr>
          ))}
        </TableShell>
      </Section>
    </div>
  );
}