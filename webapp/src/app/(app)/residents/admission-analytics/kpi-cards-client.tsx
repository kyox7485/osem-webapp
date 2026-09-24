"use client";

import { useState } from "react";
import {
  Users,
  DoorOpen,
  BedDouble,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  BarChart3,
} from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import { KpiCard } from "./charts";
import { AnalyticsDetailsModal, type AnalyticsDetailType } from "./analytics-details-modal";
import type { ResidentRow } from "./data";

export type KpiCardClientProps = {
  admissions: number;
  discharges: number;
  currentOccupancy: number;
  netGrowth: number;
  avgLos: number | null;
  occupancyPercentage: number | null;
  totalBedCapacity: number;
  isCurrentPeriod: boolean;
  completedStays: number;
  allResidentsWithAdmission: number;
  residents: ResidentRow[];
  dateRange: { start: Date; end: Date };
  selectedBranches: Array<{ id: number; label: string; bed_capacity: number | null }>;
};

export function KpiCardsClient({
  admissions,
  discharges,
  currentOccupancy,
  netGrowth,
  avgLos,
  occupancyPercentage,
  totalBedCapacity,
  isCurrentPeriod,
  completedStays,
  allResidentsWithAdmission,
  residents,
  dateRange,
  selectedBranches,
}: KpiCardClientProps) {
  const t = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<AnalyticsDetailType | null>(null);
  const [modalData, setModalData] = useState<{
    residents: ResidentRow[];
    admissions?: number;
    discharges?: number;
  }>({ residents: [] });

  const openModal = (type: AnalyticsDetailType, data: any) => {
    setModalType(type);
    setModalData(data);
    setModalOpen(true);
  };

  const handleAdmissionsClick = () => {
    const admitted = residents.filter((r) => {
      if (!r.admission_date) return false;
      const d = new Date(r.admission_date);
      return d >= dateRange.start && d <= dateRange.end;
    });
    openModal("admissions", { residents: admitted });
  };

  const handleDischargesClick = () => {
    const discharged = residents.filter((r) => {
      if (!r.discharge_date) return false;
      const d = new Date(r.discharge_date);
      return d >= dateRange.start && d <= dateRange.end;
    });
    openModal("discharges", { residents: discharged });
  };

  const handleActiveClick = () => {
    const active = residents.filter((r) => r.status === "ACTIVE");
    openModal("active", { residents: active });
  };

  const handleNetChangeClick = () => {
    openModal("net-change", {
      residents: [],
      admissions,
      discharges,
    });
  };

  const handleLosClick = () => {
    const withAdmission = residents.filter((r) => r.admission_date);
    openModal("los", { residents: withAdmission });
  };

  const handleOccupancyClick = () => {
    // Calculate branch breakdown for occupancy detail
    const branchBreakdown = selectedBranches.map((b) => {
      const branchResidents = residents.filter((r) => r.branch_id === Number(b.id));
      const active = branchResidents.filter((r) => r.status === "ACTIVE").length;
      return {
        label: b.label,
        active,
        capacity: b.bed_capacity,
      };
    });

    openModal("occupancy", {
      residents: [],
      branchBreakdown,
    });
  };

  return (
    <>
      <div className={`mb-4 grid gap-3 ${isCurrentPeriod ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"}`}>
        <div onClick={handleAdmissionsClick} role="button" tabIndex={0}>
          <KpiCard
            label={t("Admissions")}
            value={admissions}
            sub={t("in selected period")}
            tint="bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400"
            icon={<Users className="h-4 w-4" strokeWidth={2} />}
            clickable
          />
        </div>

        <div onClick={handleDischargesClick} role="button" tabIndex={0}>
          <KpiCard
            label={t("Discharges")}
            value={discharges}
            sub={t("in selected period")}
            tint="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
            icon={<DoorOpen className="h-4 w-4" strokeWidth={2} />}
            clickable
          />
        </div>

        {isCurrentPeriod && (
          <div onClick={handleActiveClick} role="button" tabIndex={0}>
            <KpiCard
              label={t("Active Residents")}
              value={currentOccupancy}
              sub={t("current occupancy")}
              tint="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
              icon={<BedDouble className="h-4 w-4" strokeWidth={2} />}
              clickable
            />
          </div>
        )}

        <div onClick={handleNetChangeClick} role="button" tabIndex={0}>
          <KpiCard
            label={t("Net Bed Change")}
            value={
              <span className={netGrowth > 0 ? "text-emerald-700 dark:text-emerald-400" : netGrowth < 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}>
                {netGrowth > 0 ? "+" : ""}
                {netGrowth}
              </span>
            }
            sub={t("admissions − discharges")}
            tint={netGrowth > 0 ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" : netGrowth < 0 ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400" : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"}
            icon={
              netGrowth > 0 ? (
                <TrendingUp className="h-4 w-4" strokeWidth={2} />
              ) : netGrowth < 0 ? (
                <TrendingDown className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Minus className="h-4 w-4" strokeWidth={2} />
              )
            }
            clickable
          />
        </div>

        <div onClick={handleLosClick} role="button" tabIndex={0}>
          <KpiCard
            label={t("Avg Length of Stay")}
            value={avgLos !== null ? `${avgLos}d` : "–"}
            sub={`${allResidentsWithAdmission} ${t("residents")}`}
            tint="bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400"
            icon={<Clock className="h-4 w-4" strokeWidth={2} />}
            clickable
          />
        </div>

        {occupancyPercentage !== null && (
          <div onClick={handleOccupancyClick} role="button" tabIndex={0}>
            <KpiCard
              label={t("Occupancy %")}
              value={`${occupancyPercentage}%`}
              sub={`${currentOccupancy}/${totalBedCapacity} beds`}
              tint="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400"
              icon={<BarChart3 className="h-4 w-4" strokeWidth={2} />}
              clickable
            />
          </div>
        )}
      </div>

      {modalType && (
        <AnalyticsDetailsModal
          type={modalType}
          value={
            modalType === "admissions"
              ? admissions
              : modalType === "discharges"
                ? discharges
                : modalType === "active"
                  ? currentOccupancy
                  : modalType === "net-change"
                    ? `${netGrowth > 0 ? "+" : ""}${netGrowth}`
                    : modalType === "los"
                      ? `${avgLos ?? "–"}d`
                      : `${occupancyPercentage ?? "–"}%`
          }
          residents={modalData.residents}
          dateRange={dateRange}
          admissions={modalData.admissions ?? 0}
          discharges={modalData.discharges ?? 0}
          occupancyPercentage={occupancyPercentage}
          activeResidents={currentOccupancy}
          bedCapacity={totalBedCapacity}
          branchBreakdown={(modalData as any).branchBreakdown ?? []}
          open={modalOpen}
          onOpenChange={setModalOpen}
        />
      )}
    </>
  );
}
