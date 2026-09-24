"use client";

import { useEffect } from "react";
import { useTranslation } from "@/components/language-provider";
import { X } from "lucide-react";
import type { ResidentRow } from "./data";

export type AnalyticsDetailType = "admissions" | "discharges" | "active" | "net-change" | "los" | "occupancy";

type Props = {
  type: AnalyticsDetailType;
  value: number | string;
  residents?: ResidentRow[];
  dateRange: { start: Date; end: Date };
  admissions?: number;
  discharges?: number;
  occupancyPercentage?: number | null;
  activeResidents?: number;
  bedCapacity?: number | null;
  branchBreakdown?: Array<{ label: string; active: number; capacity: number | null }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function AnalyticsDetailsModal({
  type,
  value,
  residents = [],
  dateRange,
  admissions = 0,
  discharges = 0,
  occupancyPercentage,
  activeResidents = 0,
  bedCapacity,
  branchBreakdown = [],
  open,
  onOpenChange,
}: Props) {
  const t = useTranslation();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const getTitle = () => {
    switch (type) {
      case "admissions":
        return t("Admissions");
      case "discharges":
        return t("Discharges");
      case "active":
        return t("Active Residents");
      case "net-change":
        return t("Net Bed Change");
      case "los":
        return t("Length of Stay");
      case "occupancy":
        return t("Occupancy");
      default:
        return t("Details");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="analytics-details-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-elevated shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface p-4 sm:p-6">
          <h2 id="analytics-details-title" className="text-lg font-bold text-fg">
            {getTitle()}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-fg-faint hover:text-fg-muted"
            aria-label={t("Close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          {/* Header with main value */}
          <div className="rounded-lg bg-surface-muted p-4">
            <div className="text-3xl font-bold text-fg tabular-nums">{value}</div>
            <div className="mt-1 text-sm text-fg-muted">
              {formatDate(dateRange.start)} – {formatDate(dateRange.end)}
            </div>
          </div>

          {/* Type-specific content */}
          {type === "admissions" && residents.length > 0 && (
            <div>
              <h3 className="font-semibold text-fg mb-3">{t("Admitted Residents")}</h3>
              <ResidentListTable residents={residents} />
            </div>
          )}

          {type === "discharges" && residents.length > 0 && (
            <div>
              <h3 className="font-semibold text-fg mb-3">{t("Discharged Residents")}</h3>
              <ResidentListTable residents={residents} showDischargeDate />
            </div>
          )}

          {type === "active" && residents.length > 0 && (
            <div>
              <h3 className="font-semibold text-fg mb-3">{t("Currently Active Residents")}</h3>
              <ResidentListTable residents={residents} showLOS />
            </div>
          )}

          {type === "net-change" && (
            <div>
              <h3 className="font-semibold text-fg mb-3">{t("Calculation")}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center py-1 border-b border-line">
                  <span className="text-fg-muted">{t("Admissions")}</span>
                  <span className="font-semibold text-fg">{admissions}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-fg-muted">− {t("Discharges")}</span>
                  <span className="font-semibold text-fg">−{discharges}</span>
                </div>
                <div className="flex justify-between items-center py-2 text-base font-semibold border-t-2 border-line-strong">
                  <span className="text-fg">{t("Net Change")}</span>
                  <span className={admissions - discharges > 0 ? "text-emerald-600 dark:text-emerald-400" : admissions - discharges < 0 ? "text-red-600 dark:text-red-400" : "text-fg"}>
                    {admissions - discharges > 0 ? "+" : ""}{admissions - discharges}
                  </span>
                </div>
              </div>
            </div>
          )}

          {type === "occupancy" && (
            <div>
              <h3 className="font-semibold text-fg mb-3">{t("Calculation")}</h3>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between items-center py-1 border-b border-line">
                  <span className="text-fg-muted">{t("Active Residents")}</span>
                  <span className="font-semibold text-fg">{activeResidents}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-fg-muted">÷ {t("Total Bed Capacity")}</span>
                  <span className="font-semibold text-fg">{bedCapacity ?? "–"}</span>
                </div>
                <div className="flex justify-between items-center py-2 text-base font-semibold border-t-2 border-line-strong">
                  <span className="text-fg">{t("Occupancy")}</span>
                  <span className="text-indigo-600 dark:text-indigo-400">{occupancyPercentage ?? "–"}%</span>
                </div>
              </div>

              {branchBreakdown && branchBreakdown.length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <h4 className="font-semibold text-fg-secondary mb-3">{t("By Branch")}</h4>
                  <div className="space-y-3">
                    {branchBreakdown.map((b) => {
                      const pct =
                        b.capacity && b.capacity > 0
                          ? Math.round((b.active / b.capacity) * 100)
                          : null;
                      return (
                        <div key={b.label} className="rounded-lg bg-surface-muted p-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-fg">{b.label}</span>
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                              {pct !== null ? `${pct}%` : "–"}
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-fg-muted">
                            {b.active} / {b.capacity ?? "–"} beds
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {type === "los" && residents.length > 0 && (
            <div>
              <h3 className="font-semibold text-fg mb-3">{t("Length of Stay Details")}</h3>
              <ResidentListTable residents={residents} showLOS />
            </div>
          )}

          {residents.length === 0 && type !== "occupancy" && type !== "net-change" && (
            <div className="rounded-lg bg-surface-muted p-4 text-center text-sm text-fg-muted">
              {t("No residents to display.")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResidentListTable({
  residents,
  showDischargeDate = false,
  showLOS = false,
}: {
  residents: ResidentRow[];
  showDischargeDate?: boolean;
  showLOS?: boolean;
}) {
  const t = useTranslation();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-muted">
            <th className="px-3 py-2 text-left text-xs font-semibold text-fg-secondary">
              {t("Name")}
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-fg-secondary">
              {t("ID")}
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-fg-secondary">
              {t("Status")}
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-fg-secondary">
              {t("Admission Date")}
            </th>
            {showDischargeDate && (
              <th className="px-3 py-2 text-left text-xs font-semibold text-fg-secondary">
                {t("Discharge Date")}
              </th>
            )}
            {showLOS && (
              <th className="px-3 py-2 text-right text-xs font-semibold text-fg-secondary">
                {t("LOS (days)")}
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {residents.map((r) => (
            <tr key={r.id} className="hover:bg-hover">
              <td className="px-3 py-2 text-sm text-fg font-semibold">{r.resident_name}</td>
              <td className="px-3 py-2 text-sm text-fg-muted">{r.id}</td>
              <td className="px-3 py-2 text-sm text-fg-muted">{r.status}</td>
              <td className="px-3 py-2 text-sm text-fg-muted">
                {r.admission_date ? formatDate(new Date(r.admission_date)) : "–"}
              </td>
              {showDischargeDate && (
                <td className="px-3 py-2 text-sm text-fg-muted">
                  {r.discharge_date ? formatDate(new Date(r.discharge_date)) : "–"}
                </td>
              )}
              {showLOS && (
                <td className="px-3 py-2 text-right text-sm font-medium text-fg">
                  {r.admission_date ? calculateDays(r.admission_date, r.discharge_date) : "–"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function calculateDays(admissionDate: string, dischargeDate: string | null): number {
  const start = new Date(admissionDate);
  const end = dischargeDate ? new Date(dischargeDate) : new Date();
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
