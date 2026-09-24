import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBranchesWithCapacity, getDemoBranchIds } from "@/lib/lookups";
import { getServerTranslator } from "@/lib/i18n/server";
import { PageTitle } from "@/components/page-header";

import { ResidentsModuleTabs } from "../module-tabs";
import { AnalyticsFilters } from "./filters";
import {
  resolveDateRange,
  computeAdmissions,
  computeDischarges,
  computeCurrentOccupancy,
  computeOccupancyPercentage,
  computeAvgLOS,
  computeOccupancyTrend,
  computeAgeGender,
  computeCategories,
  computeLOSDistribution,
  type PeriodKey,
  type ResidentRow,
} from "./data";
import {
  OccupancyTrendChart,
  AgeGenderTable,
  CategoryBars,
  LOSBars,
} from "./charts";
import { KpiCardsClient } from "./kpi-cards-client";

export default async function AdmissionAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; branch?: string }>;
}) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  // ── Access control: Admission Analytics is NUR/HQ only ────────────────────
  if (account.branch_function && !["NUR", "HQ"].includes(account.branch_function)) {
    redirect("/residents");
  }

  const { t } = await getServerTranslator();
  const sp = await searchParams;

  const period = (["month", "last-month", "year", "last-year", "custom"].includes(sp.period ?? "")
    ? sp.period
    : "month") as PeriodKey;
  const from = sp.from ?? "";
  const to = sp.to ?? "";
  const branchFilter = sp.branch ? Number(sp.branch) : null;

  const range = resolveDateRange(period, from, to);

  // ── Branches (for filter dropdown) ─────────────────────────────────────────
  const admin = isAdmin(account);
  const [allNurBranches, demoBranchIds] = await Promise.all([
    getBranchesWithCapacity("NUR"),
    getDemoBranchIds(),
  ]);

  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  // Branches available in the filter dropdown (non-admin only sees their own)
  const branchOptions: { id: number; label: string }[] = admin
    ? allNurBranches
        .filter((b) => !excludedBranchIds.includes(Number(b.id)))
        .map((b) => ({ id: Number(b.id), label: b.label }))
    : [];

  // ── Resident data ──────────────────────────────────────────────────────────
  const supabase = await createClient();
  let query = supabase
    .from("tbl_residents")
    .select(
      "id, resident_name, branch_id, age, gender, status, admission_date, discharge_date, mobility, feeding_type_id, hygiene"
    );

  if (!admin) {
    // Non-admin sees only their own branch
    query = query.eq("branch_id", account.branch_id);
  } else {
    if (branchFilter) query = query.eq("branch_id", branchFilter);
    if (excludedBranchIds.length > 0)
      query = query.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
  }

  const { data: rawResidents, error: residentsError } = await query;
  const residents: ResidentRow[] = rawResidents ?? [];

  // ── Feeding type labels ────────────────────────────────────────────────────
  const { data: feedingTypesData } = await supabase
    .from("tbl_feeding_types")
    .select("id, name")
    .order("id");
  const feedingTypeMap = new Map<number, string>(
    (feedingTypesData ?? []).map((f) => [f.id as number, f.name as string])
  );

  // ── Computed analytics ─────────────────────────────────────────────────────
  const admissions = computeAdmissions(residents, range);
  const discharges = computeDischarges(residents, range);
  const currentOccupancy = computeCurrentOccupancy(residents);
  const netGrowth = admissions - discharges;
  const avgLos = computeAvgLOS(residents);
  const trendPoints = computeOccupancyTrend(residents, range);
  const ageGenderRows = computeAgeGender(residents);
  const mobilityRows = computeCategories(residents, (r) => r.mobility);
  const feedingRows = computeCategories(residents, (r) =>
    r.feeding_type_id !== null ? (feedingTypeMap.get(r.feeding_type_id) ?? `Type ${r.feeding_type_id}`) : null
  );
  const hygieneRows = computeCategories(residents, (r) => r.hygiene);
  const losDistrib = computeLOSDistribution(residents, range.end);

  // ── Bed capacity & occupancy percentage ──────────────────────────────────
  // Calculate total bed capacity from selected branches (aggregated for HQ view)
  let totalBedCapacity = 0;
  let selectedBranches = allNurBranches;

  if (branchFilter !== null) {
    selectedBranches = allNurBranches.filter((b) => Number(b.id) === branchFilter);
  }

  selectedBranches.forEach((b) => {
    if (b.bed_capacity && b.bed_capacity > 0) {
      totalBedCapacity += b.bed_capacity;
    }
  });

  const occupancyPercentage = computeOccupancyPercentage(currentOccupancy, totalBedCapacity || null);

  // ── Check if period is "current" (not a historical view) ──────────────────
  const today = new Date();
  const isCurrentPeriod = period === "month" ||
    (period === "year" && range.end.getFullYear() === today.getFullYear() && range.end.getMonth() === today.getMonth());

  const completedStays = residents.filter((r) => r.admission_date && r.discharge_date).length;
  const allResidentsWithAdmission = residents.filter((r) => r.admission_date).length;

  // ── Date range label ───────────────────────────────────────────────────────
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const rangeLabel = `${fmt(range.start)} – ${fmt(range.end)}`;

  return (
    <div>
      <PageTitle
        title={t("Residents")}
        description={`${t("Admission Analytics")} · ${rangeLabel}`}
      />

      <div className="mb-4">
        <ResidentsModuleTabs />
      </div>

      <AnalyticsFilters
        period={period}
        from={from}
        to={to}
        branch={branchFilter !== null ? String(branchFilter) : ""}
        branches={branchOptions}
      />

      {residentsError && (
        <div className="mb-4 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {residentsError.message}
        </div>
      )}

      {/* ── KPI row (client component for interactivity) ────────────────────── */}
      <KpiCardsClient
        admissions={admissions}
        discharges={discharges}
        currentOccupancy={currentOccupancy}
        netGrowth={netGrowth}
        avgLos={avgLos}
        occupancyPercentage={occupancyPercentage}
        totalBedCapacity={totalBedCapacity}
        isCurrentPeriod={isCurrentPeriod}
        completedStays={completedStays}
        allResidentsWithAdmission={allResidentsWithAdmission}
        residents={residents}
        dateRange={range}
        selectedBranches={selectedBranches.map((b) => ({ ...b, id: Number(b.id) }))}
      />

      {/* ── Occupancy trend ────────────────────────────────────────────────── */}
      <div className="mb-4 rounded-md border border-line bg-surface p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-fg">{t("Occupancy Trend")}</h3>
          <span className="text-xs text-fg-faint">{t("Residents occupying a bed at month-end")}</span>
        </div>
        <OccupancyTrendChart points={trendPoints} t={t} />
      </div>

      {/* ── Age × Gender + LOS side by side ────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Age × Gender */}
        <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-fg">{t("Age × Gender")}</h3>
            <p className="text-xs text-fg-faint">{t("Current active residents")}</p>
          </div>
          {currentOccupancy === 0 ? (
            <p className="py-6 text-center text-sm text-fg-faint">{t("No active residents.")}</p>
          ) : (
            <AgeGenderTable rows={ageGenderRows} t={t} />
          )}
          {/* Unknown-age note */}
          {(() => {
            const active = residents.filter((r) => r.status === "ACTIVE");
            const unknownAge = active.filter((r) => r.age === null).length;
            if (unknownAge === 0) return null;
            return (
              <p className="mt-2 text-[11px] text-fg-faint">
                {unknownAge} {t("resident(s) with unknown age not shown.")}
              </p>
            );
          })()}
        </div>

        {/* Length of Stay */}
        <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-fg">{t("Length of Stay")}</h3>
            <p className="text-xs text-fg-faint">{t("All residents (completed + active)")}</p>
          </div>
          {allResidentsWithAdmission === 0 ? (
            <p className="py-6 text-center text-sm text-fg-faint">
              {t("No residents with admission date.")}
            </p>
          ) : (
            <LOSBars buckets={losDistrib} avgDays={avgLos} t={t} />
          )}
        </div>
      </div>

      {/* ── Care Dependency ─────────────────────────────────────────────────── */}
      <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
        <div className="mb-4">
          <h3 className="text-sm font-bold text-fg">{t("Care Dependency")}</h3>
          <p className="text-xs text-fg-faint">{t("Current active residents")}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Mobility */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {t("Mobility")}
            </h4>
            {mobilityRows.length === 0 ? (
              <p className="text-sm text-fg-faint">{t("No data.")}</p>
            ) : (
              <CategoryBars rows={mobilityRows} t={t} />
            )}
          </div>

          {/* Feeding */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {t("Feeding")}
            </h4>
            {feedingRows.length === 0 ? (
              <p className="text-sm text-fg-faint">{t("No data.")}</p>
            ) : (
              <CategoryBars rows={feedingRows} t={t} />
            )}
          </div>

          {/* Hygiene / Toileting */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {t("Hygiene / Toileting")}
            </h4>
            {hygieneRows.length === 0 ? (
              <p className="text-sm text-fg-faint">{t("No data.")}</p>
            ) : (
              <CategoryBars rows={hygieneRows} t={t} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
