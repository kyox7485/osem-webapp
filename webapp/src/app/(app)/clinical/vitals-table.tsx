"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewVitalForm } from "./new-vital-form";
import { useNavPush } from "@/components/nav-loading";
import {
  flagVital,
  vitalFlagClass,
  vitalRowClass,
  flagSystolic,
  flagDiastolic,
  flagHeartRate,
  flagTemperature,
  flagSpo2,
  flagDxt,
} from "@/lib/vital-thresholds";
import type { LookupOption } from "@/lib/types";
import type { ClinicalLookups } from "@/lib/lookups";
import { useTranslation } from "@/components/language-provider";

type Vital = {
  id: number;
  resident_id: number;
  entry_timestamp: string;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  spo2_condition: string | null;
  dxt: number | null;
  dxt_remark: string | null;
  insulin_adjustment: string | null;
  respiration_rate: number | null;
  gcs_label: string | null;
  avpu_label: string | null;
  reviewed_by: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  tbl_staff: { StaffID: string; staff_name: string } | null;
};

type Resident = {
  id: number;
  resident_name: string;
  branch_id: number;
};

type Props = {
  vitals: Vital[];
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  lookups: ClinicalLookups;
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

export function VitalsTable({ vitals, residents, allStaff, lookups, currentResident, currentStart, currentEnd, error }: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const [showForm, setShowForm] = useState(false);

  function applyFilters(residentId: string, start: string, end: string) {
    const params = new URLSearchParams();
    params.set("tab", "vitals");
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm print-hidden">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="resident-filter" className="mb-1 block text-sm font-medium text-gray-700">
              {t("Resident")}
            </label>
            <select
              id="resident-filter"
              value={currentResident}
              onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">{t("All residents")}</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.resident_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="start-date" className="mb-1 block text-sm font-medium text-gray-700">
              {t("Start date")}
            </label>
            <input
              type="date"
              id="start-date"
              value={currentStart}
              onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="end-date" className="mb-1 block text-sm font-medium text-gray-700">
              {t("End date")}
            </label>
            <input
              type="date"
              id="end-date"
              value={currentEnd}
              onChange={(e) => applyFilters(currentResident, currentStart, e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              {t("Add Entry")}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              {t("Print")}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-4 text-xs text-gray-500 print-hidden">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-red-100" /> {t("Critical reading")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-100" /> {t("Out of normal range")}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-900"></th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("Date/Time")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("Resident")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("Systolic BP")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("Diastolic BP")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("Heart Rate")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("Temp (°C)")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("SpO2")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("DXT")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("Insulin Adj.")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("Advanced Obs.")}</th>
                <th className="px-4 py-3 font-medium text-gray-900">{t("Reviewed By")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vitals.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-gray-400">
                    {t("No vital signs recorded yet.")}
                  </td>
                </tr>
              ) : (
                vitals.map((v) => {
                  const rowSeverity = flagVital(v);
                  return (
                    <tr key={v.id} className={vitalRowClass(rowSeverity)}>
                      <td className="px-2 py-3 text-center" title={rowSeverity ?? undefined}>
                        {rowSeverity === "critical" && <span aria-label="critical">🔴</span>}
                        {rowSeverity === "warning" && <span aria-label="warning">🟠</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{formatDateTime(v.entry_timestamp)}</td>
                      <td className="px-4 py-3 text-gray-900">{v.tbl_residents?.resident_name || "--"}</td>
                      <td className={`px-4 py-3 ${vitalFlagClass(flagSystolic(v.systolic_bp))}`}>
                        {v.systolic_bp ?? "--"}
                      </td>
                      <td className={`px-4 py-3 ${vitalFlagClass(flagDiastolic(v.diastolic_bp))}`}>
                        {v.diastolic_bp ?? "--"}
                      </td>
                      <td className={`px-4 py-3 ${vitalFlagClass(flagHeartRate(v.heart_rate))}`}>
                        {v.heart_rate ?? "--"}
                      </td>
                      <td className={`px-4 py-3 ${vitalFlagClass(flagTemperature(v.temperature))}`}>
                        {v.temperature ?? "--"}
                      </td>
                      <td className={`px-4 py-3 ${vitalFlagClass(flagSpo2(v.spo2))}`}>
                        {v.spo2 ?? "--"}
                        {v.spo2_condition && (
                          <span className="ml-1 text-xs text-gray-500">({v.spo2_condition})</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 ${vitalFlagClass(flagDxt(v.dxt))}`}>
                        {v.dxt ?? "--"}
                        {v.dxt_remark && <span className="ml-1 text-xs text-gray-500">({v.dxt_remark})</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-800">{v.insulin_adjustment || "--"}</td>
                      <td className="px-4 py-3 text-gray-800">
                        {v.respiration_rate !== null && <span className="mr-1">RR{v.respiration_rate}</span>}
                        {v.gcs_label && <span className="mr-1">{v.gcs_label}</span>}
                        {v.avpu_label && <span>{v.avpu_label}</span>}
                        {v.respiration_rate === null && !v.gcs_label && !v.avpu_label && "--"}
                      </td>
                      <td className="px-4 py-3 text-gray-800">{v.tbl_staff?.staff_name || "--"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <NewVitalForm
          residents={residents}
          allStaff={allStaff}
          lookups={lookups}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            router.refresh();
          }}
        />
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            body {
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }
            .print-hidden {
              display: none !important;
            }
          }
        `
      }} />
    </div>
  );
}
