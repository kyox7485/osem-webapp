import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getServerTranslator } from "@/lib/i18n/server";
import { PageTitle } from "@/components/page-header";
import { BedDouble, DoorOpen, Home, Clock } from "lucide-react";

import { PhysioModuleTabs } from "../module-tabs";
import { DashboardFilters } from "./dashboard-filters";
import { StatTile } from "./stat-tile";
import { TherapistTable } from "./therapist-table";
import { StackedBar, TrendChart, DonutChart, TypeLegend } from "./charts";
import {
  resolveDateRange,
  previousPeriod,
  getPhysioRelevantBranches,
  getAllowedBranchIds,
  getPhysioTherapists,
  fetchAssessments,
  sumByType,
  totalHours,
  aggregateByBranch,
  aggregateByTherapist,
  bucketByPeriod,
  rangeInWeeks,
  percentChange,
  PATIENT_TYPE_LABELS,
  type PeriodKey,
  type AssessmentRow,
} from "./data";

export default async function PhysioDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    start?: string;
    end?: string;
    branch?: string;
    view?: string;
    therapist?: string;
  }>;
}) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const { t } = await getServerTranslator();
  const sp = await searchParams;

  const period = (["week", "month", "quarter", "custom"].includes(sp.period ?? "") ? sp.period : "month") as PeriodKey;
  const start = sp.start ?? "";
  const end = sp.end ?? "";
  const branchFilter = sp.branch ? Number(sp.branch) : null;
  const view: "team" | "individual" = sp.view === "individual" ? "individual" : "team";
  const therapistFilter = view === "individual" ? sp.therapist ?? "" : "";

  const range = resolveDateRange(period, start, end);
  const prevRange = previousPeriod(range);
  const weeks = rangeInWeeks(range);

  const [allowedBranchIds, allBranches, therapists] = await Promise.all([
    getAllowedBranchIds(account),
    getPhysioRelevantBranches(),
    getPhysioTherapists(),
  ]);

  const branchOptions = (allowedBranchIds ? allBranches.filter((b) => allowedBranchIds.includes(b.id)) : allBranches).map(
    (b) => ({ id: b.id, label: b.label })
  );

  let rows: AssessmentRow[], prevRows: AssessmentRow[];
  let loadError: string | null = null;
  try {
    [rows, prevRows] = await Promise.all([
      fetchAssessments({ range, allowedBranchIds, branchFilter, therapistFilter: therapistFilter || null }),
      fetchAssessments({ range: prevRange, allowedBranchIds, branchFilter, therapistFilter: therapistFilter || null }),
    ]);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Failed to load dashboard data";
    rows = [];
    prevRows = [];
  }

  const totals = sumByType(rows);
  const prevTotals = sumByType(prevRows);
  const grandTotal = totalHours(totals);

  // Relabel with the disambiguated "LOCALE (CODE)" form where the branch
  // filter needed it (see getPhysioRelevantBranches) -- the raw join in
  // fetchAssessments only carries the plain locale, which is ambiguous when
  // multiple branches share one (e.g. the three Alma branches).
  const branchLabelById = new Map(allBranches.map((b) => [b.id, b.label]));
  const branchAgg = aggregateByBranch(rows).map((b) => ({ ...b, name: branchLabelById.get(Number(b.id)) ?? b.name }));
  const branchIdByLabel = new Map(rows.map((r) => [r.branch_label, r.branch_id] as const));
  const therapistAgg = aggregateByTherapist(rows).map((th) => ({
    ...th,
    branches: th.branches.map((label) => branchLabelById.get(branchIdByLabel.get(label) ?? -1) ?? label),
  }));
  const trendBuckets = bucketByPeriod(rows, range, period).map((b) => ({ label: b.label, totals: b.totals }));

  const share = (v: number) => (grandTotal > 0 ? (v / grandTotal) * 100 : 0);
  const typeLabels = {
    inpatient: t(PATIENT_TYPE_LABELS.inpatient),
    outpatient: t(PATIENT_TYPE_LABELS.outpatient),
    housecall: t(PATIENT_TYPE_LABELS.housecall),
  };

  const dateFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div>
      <PageTitle
        title={t("Physiotherapy")}
        description={`${t("Workload analytics")} · ${dateFmt(range.start)} – ${dateFmt(range.end)}`}
      />

      <PhysioModuleTabs />

      <DashboardFilters
        period={period}
        start={start}
        end={end}
        branch={branchFilter !== null ? String(branchFilter) : ""}
        view={view}
        therapist={therapistFilter}
        branches={branchOptions}
        therapists={therapists.map((th) => ({ id: String(th.id), label: th.label }))}
      />

      {loadError && <p className="mb-4 text-sm text-red-600">{loadError}</p>}

      {/* KPI row */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t("Total credit hours")}
          hours={grandTotal}
          share={null}
          deltaPct={percentChange(grandTotal, totalHours(prevTotals))}
          icon={Clock}
          tint="bg-gray-100 text-gray-700"
          t={t}
        />
        <StatTile
          label={typeLabels.inpatient}
          hours={totals.inpatient}
          share={share(totals.inpatient)}
          deltaPct={percentChange(totals.inpatient, prevTotals.inpatient)}
          icon={BedDouble}
          tint="bg-indigo-50 text-indigo-600"
          t={t}
        />
        <StatTile
          label={typeLabels.outpatient}
          hours={totals.outpatient}
          share={share(totals.outpatient)}
          deltaPct={percentChange(totals.outpatient, prevTotals.outpatient)}
          icon={DoorOpen}
          tint="bg-emerald-50 text-emerald-600"
          t={t}
        />
        <StatTile
          label={typeLabels.housecall}
          hours={totals.housecall}
          share={share(totals.housecall)}
          deltaPct={percentChange(totals.housecall, prevTotals.housecall)}
          icon={Home}
          tint="bg-amber-50 text-amber-600"
          t={t}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Trend */}
        <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-900">{t("Credit hours over time")}</h3>
            <TypeLegend labels={typeLabels} />
          </div>
          {grandTotal > 0 ? (
            <TrendChart buckets={trendBuckets} />
          ) : (
            <p className="py-10 text-center text-sm text-gray-500">{t("No assessments in this period.")}</p>
          )}
        </div>

        {/* Mix donut */}
        <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-gray-900">{t("Patient-type mix")}</h3>
          <DonutChart totals={totals} t={t} />
        </div>
      </div>

      {/* Branch breakdown */}
      <div className="mb-4 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-gray-900">{t("Credit hours by branch")}</h3>
          <TypeLegend labels={typeLabels} />
        </div>
        {branchAgg.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">{t("No assessments in this period.")}</p>
        ) : (
          <div className="space-y-3">
            {branchAgg.map((b) => (
              <StackedBar key={b.id} label={b.name} totals={b.totals} />
            ))}
          </div>
        )}
      </div>

      {/* Team vs individual workload */}
      <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-gray-900">
            {view === "team" ? t("Team workload by branch") : t("Therapist workload & strength")}
          </h3>
          <p className="text-xs text-gray-500">
            {t("Baseline")}: 45h/{t("week")} · {t("overtime is expected, not flagged")}
          </p>
        </div>

        {view === "team" ? (
          <TherapistTable
            therapists={branchAgg}
            weeks={weeks}
            emptyLabel={t("No assessments in this period.")}
            columnLabels={{
              therapist: t("Branch"),
              branches: "",
              mix: t("Patient-type mix"),
              workload: t("Team workload vs baseline"),
              total: t("Total hours"),
            }}
            t={t}
          />
        ) : (
          <TherapistTable
            therapists={therapistAgg}
            weeks={weeks}
            emptyLabel={t("No assessments in this period.")}
            columnLabels={{
              therapist: t("Therapist"),
              branches: t("Branches"),
              mix: t("Patient-type mix"),
              workload: t("Workload vs baseline"),
              total: t("Total hours"),
            }}
            t={t}
          />
        )}
      </div>
    </div>
  );
}
