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
import { AdminRecordControls, useIsHqAdmin } from "@/components/admin-record-controls";
import { ResultNotice } from "./result-notice";
import { ResidentCombobox } from "@/components/resident-combobox";

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
  reviewed_by_other: string | null;
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
  /** Branch dropdown options -- HQ ADMIN only, so empty for every other login. */
  branches: LookupOption[];
  /** Currently selected branch id as a string, or "" for "All branches". */
  currentBranch: string;
  allStaff: (LookupOption & { branch_id: number; branch_function: string })[];
  lookups: ClinicalLookups;
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
  /** The server hit its row cap -- the list below is the most recent N, not all. */
  truncated?: boolean;
  /** False blocks entry creation for plain-STAFF logins in the other
   * department (see canCreateClinicalEntry in lib/current-user.ts). View
   * access to existing entries is never affected. */
  canCreateEntry?: boolean;
};

export function VitalsTable({ vitals, residents, branches, currentBranch, allStaff, lookups, currentResident, currentStart, currentEnd, error, truncated, canCreateEntry = true }: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const isHqAdmin = useIsHqAdmin();
  const [showForm, setShowForm] = useState(false);

  function applyFilters(residentId: string, start: string, end: string, branchId: string) {
    const params = new URLSearchParams();
    params.set("tab", "vitals");
    if (branchId) params.set("branch", branchId);
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  const pdfParams = new URLSearchParams();
  if (currentResident) pdfParams.set("resident", currentResident);
  if (currentStart) pdfParams.set("start", currentStart);
  if (currentEnd) pdfParams.set("end", currentEnd);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
        {/*
          sm:grid-cols-4 spread the three fields and the action buttons over
          the full width, which on a wide monitor left each control a lonely
          ~380px column. Below lg the fields stack 2-up and the actions stay
          one column; at lg they become 7 tracks and the actions take the
          last two, so the controls sit in a readable band on the left and
          the buttons stay together on the right. Track count tracks the
          number of rendered fields: HQ ADMIN gets the extra Branch column,
          everyone else renders one fewer field and keeps the buttons in the
          same two tracks.
        */}
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${isHqAdmin ? "lg:grid-cols-7" : "lg:grid-cols-6"}`}>
          {/*
            Branch filter, HQ ADMIN only. The server narrows both the
            resident list and the readings to this branch, so switching it
            repopulates the Resident dropdown rather than leaving a stale
            cross-branch selection behind.
          */}
          {isHqAdmin && (
            <div>
              <label htmlFor="branch-filter" className="mb-1 block text-sm font-medium text-fg-secondary">
                {t("Branch")}
              </label>
              <select
                id="branch-filter"
                value={currentBranch}
                onChange={(e) => applyFilters("", currentStart, currentEnd, e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">{t("All branches")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <ResidentCombobox
            id="resident-filter"
            residents={residents}
            value={currentResident}
            onChange={(id) => applyFilters(id, currentStart, currentEnd, currentBranch)}
            filterPlaceholder={t("All residents")}
          />

          <div>
            <label htmlFor="start-date" className="mb-1 block text-sm font-medium text-fg-secondary">
              {t("Start date")}
            </label>
            <input
              type="date"
              id="start-date"
              value={currentStart}
              onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd, currentBranch)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="end-date" className="mb-1 block text-sm font-medium text-fg-secondary">
              {t("End date")}
            </label>
            <input
              type="date"
              id="end-date"
              value={currentEnd}
              onChange={(e) => applyFilters(currentResident, currentStart, e.target.value, currentBranch)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-2 lg:flex-row lg:items-end">
            {canCreateEntry && (
              <button
              type="button"
              onClick={() => setShowForm(true)}
              className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              {t("Add Entry")}
            </button>
            )}
            {currentResident ? (
              <a
                href={`/api/reports/vital-signs?${pdfParams.toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-700 dark:hover:text-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                {t("Download PDF")}
              </a>
            ) : (
              <span
                title={t("Select a resident to download the PDF report")}
                className="flex w-full cursor-not-allowed items-center justify-center rounded-md border border-line bg-surface-muted px-4 py-2 text-sm font-medium text-fg-faint"
              >
                {t("Download PDF")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      <ResultNotice error={error} truncated={truncated} />

      <div className="flex items-center gap-4 text-xs text-fg-subtle">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-red-100 dark:bg-red-950/40" /> {t("Critical reading")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-100 dark:bg-amber-950/40" /> {t("Out of normal range")}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
        {/*
          table-fixed + explicit column widths: the 13 columns used to
          size to their content, so a long resident name or a "Reviewing
          Nurse" in the remarks forced the whole table wider than the
          container and produced a horizontal scrollbar on desktop. Proportions
          below sum to 100% so the row always fills the container exactly.
          min-w-[900px] keeps every column readable on a phone and lets
          overflow-x-auto do the scrolling there, which is the existing
          narrow-screen behaviour.
        */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed text-left text-sm">
            {/*
              Percentages, not pixels, so the row always fills whatever the
              container is. The two lists (HQ ADMIN sees Actions, everyone
              else does not) each sum to 100% on their own -- a short colgroup
              would leave the last column short of the table's right edge.
            */}
            <colgroup>
              {isHqAdmin ? (
                <>
                  <col className="w-[3%]" />
                  <col className="w-[10%]" />
                  <col className="w-[14%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[6%]" />
                </>
              ) : (
                <>
                  <col className="w-[3%]" />
                  <col className="w-[11%]" />
                  <col className="w-[15%]" />
                  <col className="w-[7%]" />
                  <col className="w-[7%]" />
                  <col className="w-[7%]" />
                  <col className="w-[7%]" />
                  <col className="w-[8%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[7%]" />
                </>
              )}
            </colgroup>
            <thead className="border-b border-line bg-surface-muted">
              <tr>
                <th className="px-2 py-3 font-medium text-fg"></th>
                <th className="px-2 py-3 font-medium text-fg">{t("Date/Time")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("Resident")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("Systolic BP")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("Diastolic BP")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("Heart Rate")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("Temp (°C)")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("SpO2")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("DXT")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("Insulin Adj.")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("Advanced Obs.")}</th>
                <th className="px-2 py-3 font-medium text-fg">{t("Reviewed By")}</th>
                {isHqAdmin && <th className="px-2 py-3 font-medium text-fg">{t("Actions")}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {vitals.length === 0 ? (
                <tr>
                  <td colSpan={isHqAdmin ? 13 : 12} className="px-4 py-8 text-center text-fg-faint">
                    {/* Distinguish "no readings at all" from "your filters
                        excluded everything" -- a bare "no records" line on a
                        filtered view is indistinguishable from data loss. */}
                    {currentStart || currentEnd || currentResident ? (
                      <span>
                        {t("No vital signs match these filters.")}{" "}
                        {t("Clear the date range and resident to see all readings.")}
                      </span>
                    ) : (
                      t("No vital signs recorded yet.")
                    )}
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
                      <td className="break-words px-2 py-3 text-fg">{formatDateTime(v.entry_timestamp)}</td>
                      <td className="break-words px-2 py-3 text-fg">{v.tbl_residents?.resident_name || "--"}</td>
                      <td className={`px-2 py-3 ${vitalFlagClass(flagSystolic(v.systolic_bp))}`}>
                        {v.systolic_bp ?? "--"}
                      </td>
                      <td className={`px-2 py-3 ${vitalFlagClass(flagDiastolic(v.diastolic_bp))}`}>
                        {v.diastolic_bp ?? "--"}
                      </td>
                      <td className={`px-2 py-3 ${vitalFlagClass(flagHeartRate(v.heart_rate))}`}>
                        {v.heart_rate ?? "--"}
                      </td>
                      <td className={`px-2 py-3 ${vitalFlagClass(flagTemperature(v.temperature))}`}>
                        {v.temperature ?? "--"}
                      </td>
                      <td className={`px-2 py-3 ${vitalFlagClass(flagSpo2(v.spo2))}`}>
                        {v.spo2 ?? "--"}
                        {v.spo2_condition && (
                          <span className="ml-1 text-xs text-fg-subtle">({v.spo2_condition})</span>
                        )}
                      </td>
                      <td className={`px-2 py-3 ${vitalFlagClass(flagDxt(v.dxt))}`}>
                        {v.dxt ?? "--"}
                        {v.dxt_remark && <span className="ml-1 text-xs text-fg-subtle">({v.dxt_remark})</span>}
                      </td>
                      <td className="break-words px-2 py-3 text-fg">{v.insulin_adjustment || "--"}</td>
                      <td className="break-words px-2 py-3 text-fg">
                        {v.respiration_rate !== null && <span className="mr-1">RR{v.respiration_rate}</span>}
                        {v.gcs_label && <span className="mr-1">{v.gcs_label}</span>}
                        {v.avpu_label && <span>{v.avpu_label}</span>}
                        {v.respiration_rate === null && !v.gcs_label && !v.avpu_label && "--"}
                      </td>
                      <td className="break-words px-2 py-3 text-fg">{v.tbl_staff?.staff_name || v.reviewed_by_other || "--"}</td>
                      {isHqAdmin && (
                        <td className="px-2 py-2">
                          <AdminRecordControls kind="vital" id={v.id} compact />
                        </td>
                      )}
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
    </div>
  );
}
