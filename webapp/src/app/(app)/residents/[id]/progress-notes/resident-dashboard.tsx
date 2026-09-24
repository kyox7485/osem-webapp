"use client";

import { formatDateTime, formatDate } from "@/lib/format-date";
import { useTranslation } from "@/components/language-provider";

// Quick-glance panel for a doctor reviewing this resident: static clinical
// background (history/medication/allergy/TCA, from tbl_residents) plus the
// most recent nursing-chart vitals and the last-ordered value of each
// progress note "plan" field. Plan fields are optional per note -- a
// doctor only fills in whatever's relevant on a given visit -- so "last
// dressing plan" means the most recent note where dressing_plan was
// actually set, not necessarily the most recent note overall.

type Vital = {
  entry_timestamp: string;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  spo2_condition: string | null;
};

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

      <DashCard title={t("Recent vitals")}>
        {vitals.length === 0 ? (
          <EmptyNote text={t("No vitals recorded yet.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="py-1 pr-3">{t("Date")}</th>
                  <th className="py-1 pr-3">{t("BP")}</th>
                  <th className="py-1 pr-3">{t("HR")}</th>
                  <th className="py-1 pr-3">{t("Temp")}</th>
                  <th className="py-1 pr-3">{t("SpO2")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {vitals.map((v, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3 text-fg-subtle">{formatDateTime(v.entry_timestamp)}</td>
                    <td className="py-1 pr-3 text-fg">
                      {v.systolic_bp ?? "--"}/{v.diastolic_bp ?? "--"}
                    </td>
                    <td className="py-1 pr-3 text-fg">{v.heart_rate ?? "--"}</td>
                    <td className="py-1 pr-3 text-fg">{v.temperature ?? "--"}</td>
                    <td className="py-1 pr-3 text-fg">
                      {v.spo2 ?? "--"}
                      {v.spo2_condition ? ` (${v.spo2_condition})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>

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

function DashCard({
  title,
  children,
  collapsible,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  if (collapsible) {
    return (
      <details className="group rounded-md border border-line bg-surface p-4 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-fg">
          {title}
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="text-fg-faint transition-transform group-open:rotate-90"
          >
            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="mt-3">{children}</div>
      </details>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-fg">{title}</h2>
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
