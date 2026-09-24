"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format-date";
import { useTranslation } from "@/components/language-provider";
import {
  type Vital,
  getDailyAverages,
  getDXTReadings,
  resolveDateRange,
  filterVitalsByRange,
  formatVitalDateTime,
} from "@/lib/vitals";
import {
  InteractiveVitalChart,
  VITAL_UNITS,
  formatVitalValue,
  resolveActivePointId,
  type ChartPoint,
  type VitalKind,
  type VitalPointSelection,
} from "./interactive-vital-chart";
import { VitalsHistoryModal } from "./vitals-history-modal";

type PlanEntry = { entry_timestamp: string; value: string } | null;

type Props = {
  allergy: string | null;
  pastMedicalCondition: string | null;
  currentMedicationList: string | null;
  tcaNotes: string | null;
  vitals: Vital[];
  plans: {
    medical: PlanEntry;
    nursing: PlanEntry;
    diet: PlanEntry;
    dressing: PlanEntry;
    monitoring: PlanEntry;
    physio: PlanEntry;
  };
  // Collapsed-by-default, click-to-expand cards -- used while creating a
  // new entry, to keep reference info out of the way without hiding it
  // entirely. When reviewing past notes the same info is shown open.
  collapsible?: boolean;
};

const DXT_CARD_LIMIT = 10;

function dailyPoints(
  daily: ReturnType<typeof getDailyAverages>,
  pick: (d: ReturnType<typeof getDailyAverages>[number]) => number | null,
  secondary?: (d: ReturnType<typeof getDailyAverages>[number]) => number | null,
  remark?: (d: ReturnType<typeof getDailyAverages>[number]) => string | null
): ChartPoint[] {
  return daily
    .map((d) => ({
      id: d.dateKey,
      // Calendar date only -- a daily average didn't happen at a time.
      label: formatDate(`${d.dateKey}T00:00:00+08:00`),
      primary: pick(d),
      secondary: secondary?.(d) ?? null,
      isDailyAverage: true,
      remark: remark?.(d) ?? null,
    }))
    .filter((p) => p.primary !== null);
}

export function ResidentDashboard({
  allergy,
  pastMedicalCondition,
  currentMedicationList,
  tcaNotes,
  vitals,
  plans,
  collapsible = false,
}: Props) {
  const t = useTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);

  // Main-page default: the latest 7 calendar days of readings, collapsed to
  // one daily average per day. DXT is the exception -- see below.
  const daily = useMemo(() => {
    const range = resolveDateRange(vitals, 7, "", "");
    return getDailyAverages(filterVitalsByRange(vitals, range));
  }, [vitals]);

  // DXT is never averaged (some residents are only tested twice a week, so
  // a daily average would invent readings) -- the card shows the latest 10
  // actual readings with their real timestamps.
  const dxt = useMemo(() => getDXTReadings(vitals, DXT_CARD_LIMIT), [vitals]);

  const cards = useMemo(() => {
    const bp = dailyPoints(daily, (d) => d.systolic_bp, (d) => d.diastolic_bp);
    const hr = dailyPoints(daily, (d) => d.heart_rate);
    const temp = dailyPoints(daily, (d) => d.temperature);
    const spo2 = dailyPoints(daily, (d) => d.spo2, undefined, (d) => d.spo2_condition);
    const dxtPoints: ChartPoint[] = dxt.map((r) => ({
      id: r.id,
      // DXT is an actual reading, so the real time of day belongs here.
      label: formatVitalDateTime(r.timestamp),
      primary: r.value,
      isDailyAverage: false,
      remark: r.remark,
    }));
    return { BP: bp, HR: hr, Temp: temp, SpO2: spo2, DXT: dxtPoints };
  }, [daily, dxt]);

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DashCard title={t("Medical / surgical history")} collapsible={collapsible}>
          <ClampedText value={pastMedicalCondition} />
        </DashCard>
        <DashCard title={t("Current medication list")} collapsible={collapsible}>
          <ClampedText value={currentMedicationList} />
        </DashCard>
        <DashCard title={t("Known allergy")} collapsible={collapsible}>
          <ClampedText value={allergy} />
        </DashCard>
      </div>

      <DashCard title={t("TCA notes")} collapsible={collapsible}>
        <ClampedText value={tcaNotes} />
      </DashCard>

      <DashCard
        title={t("Recent vitals")}
        action={
          vitals.length > 0 ? (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="-mr-1 flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              {t("View history")}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null
        }
      >
        {vitals.length === 0 ? (
          <EmptyNote text={t("No vitals recorded yet.")} />
        ) : (
          // 5 cards, no range controls on the page -- the detailed history
          // lives behind "View history" so this stays scannable on mobile.
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <VitalCard kind="BP" points={cards.BP} />
            <VitalCard kind="HR" points={cards.HR} />
            <VitalCard kind="Temp" points={cards.Temp} />
            <VitalCard kind="SpO2" points={cards.SpO2} />
            <VitalCard kind="DXT" points={cards.DXT} />
          </div>
        )}
      </DashCard>

      {historyOpen && <VitalsHistoryModal vitals={vitals} onClose={() => setHistoryOpen(false)} />}

      <DashCard title={t("Last ordered plans")} collapsible={collapsible}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PlanRow label={t("Medical / treatment plan")} entry={plans.medical} />
          <PlanRow label={t("Nursing plan")} entry={plans.nursing} />
          <PlanRow label={t("Diet plan")} entry={plans.diet} />
          <PlanRow label={t("Dressing plan")} entry={plans.dressing} />
          <PlanRow label={t("Monitoring plan")} entry={plans.monitoring} />
          <PlanRow label={t("Physio plan")} entry={plans.physio} />
        </div>
      </DashCard>
    </div>
  );
}

/**
 * One vital card. The value is the loudest thing on it, the sparkline
 * supports it, and the date/remark is quiet -- in that order.
 *
 * Point selection is lifted up to the card so the big number and the chart
 * highlight always agree. The latest reading is the default; hovering a
 * point previews it, and tapping one keeps it until "Latest" is tapped.
 */
function VitalCard({ kind, points }: { kind: VitalKind; points: ChartPoint[] }) {
  const t = useTranslation();
  const [selection, setSelection] = useState<VitalPointSelection>({ hoveredId: null, selectedId: null });
  const active = points.find((p) => p.id === resolveActivePointId(points, selection)) ?? null;
  // True only when the user has committed to something other than the newest
  // point -- that's when the escape hatch to "Latest" is worth showing.
  const pinned = selection.selectedId !== null && selection.selectedId !== points[points.length - 1]?.id;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-fg-secondary">{t(kind)}</span>
        <span className="text-[10px] text-fg-faint">
          {kind === "DXT" ? t("Latest 10") : t("7-day daily avg")}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold leading-none tabular-nums text-fg">
          {active ? formatVitalValue(kind, active) : "--"}
        </span>
        {active && <span className="text-xs text-fg-muted">{VITAL_UNITS[kind]}</span>}
        {/* Reserved whether or not it is shown, so previewing a point can't
            reflow the value or push the sparkline down the card. */}
        {pinned && (
          <button
            type="button"
            onClick={() => setSelection({ hoveredId: null, selectedId: null })}
            className="ml-auto shrink-0 self-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            {t("Latest")}
          </button>
        )}
      </div>
      <InteractiveVitalChart
        kind={kind}
        points={points}
        compact
        title={t(kind)}
        selection={selection}
        onSelectionChange={setSelection}
      />
    </div>
  );
}

function DashCard({
  title,
  action,
  children,
  collapsible,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  if (collapsible) {
    return (
      <details className="group rounded-md border border-line bg-surface p-4 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-fg">
          <span>{title}</span>
          <div className="flex items-center gap-1">
            {action}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              className="text-fg-faint transition-transform group-open:rotate-90"
            >
              <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </summary>
        <div className="mt-3">{children}</div>
      </details>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function ClampedText({ value }: { value: string | null }) {
  const t = useTranslation();
  if (!value) return <EmptyNote text={t("None recorded.")} />;
  return <p className="whitespace-pre-wrap text-sm text-fg">{value}</p>;
}

function PlanRow({ label, entry }: { label: string; entry: PlanEntry }) {
  const t = useTranslation();
  return (
    <div>
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      {entry ? (
        <dd className="text-sm text-fg">
          {entry.value}
          <span className="block text-xs text-fg-faint">{formatDate(entry.entry_timestamp)}</span>
        </dd>
      ) : (
        <dd className="text-sm text-fg-faint">{t("No entry yet")}</dd>
      )}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-fg-faint">{text}</p>;
}
