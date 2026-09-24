"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { NewHospitalReferralForm } from "./new-hospital-referral-form";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import type { ClinicalLookups } from "@/lib/lookups";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ListChecks, Plus } from "lucide-react";
import { PdfDownloadLink } from "@/components/pdf-download-link";

type HospitalReferral = {
  id: number;
  resident_id: number;
  referral_datetime: string;
  chief_complaints: string | null;
  vital_signs: string | null;
  mobility: string | null;
  feeding: string | null;
  hygiene: string | null;
  reviewed_by: string | null;
  reviewed_by_other: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  reviewer: { StaffID: string; staff_name: string } | null;
};

type Resident = {
  id: number;
  resident_name: string;
  branch_id: number;
};

type Props = {
  referrals: HospitalReferral[];
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  lookups: ClinicalLookups;
  feedingTypes: LookupOption[];
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

export function HospitalReferralModule({
  referrals,
  residents,
  allStaff,
  lookups,
  feedingTypes,
  currentResident,
  currentStart,
  currentEnd,
  error,
}: Props) {
  const router = useRouter();
  const push = useNavPush();
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [innerTab, setInnerTab] = useState<"review" | "new">("review");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function applyFilters(residentId: string, start: string, end: string) {
    const params = new URLSearchParams();
    params.set("tab", "hospital-referral");
    if (residentId) params.set("resident", residentId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    push(`/clinical?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <TabRow>
        <TabButton icon={ListChecks} size="sm" active={innerTab === "review"} onClick={() => guardedAction(() => setInnerTab("review"))}>
          {t("Review Referrals")}
        </TabButton>
        <TabButton icon={Plus} size="sm" active={innerTab === "new"} onClick={() => guardedAction(() => setInnerTab("new"))}>
          {t("New Referral")}
        </TabButton>
      </TabRow>

      {innerTab === "review" ? (
        <>
          <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="resident-filter" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("Resident")}
                </label>
                <select
                  id="resident-filter"
                  value={currentResident}
                  onChange={(e) => applyFilters(e.target.value, currentStart, currentEnd)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                <label htmlFor="start-date" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("Start date")}
                </label>
                <input
                  type="date"
                  id="start-date"
                  value={currentStart}
                  onChange={(e) => applyFilters(currentResident, e.target.value, currentEnd)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="end-date" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("End date")}
                </label>
                <input
                  type="date"
                  id="end-date"
                  value={currentEnd}
                  onChange={(e) => applyFilters(currentResident, currentStart, e.target.value)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="space-y-3">
            {referrals.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-400 dark:text-gray-500">
                {t("No hospital referrals yet.")}
              </div>
            ) : (
              referrals.map((referral) => {
                const isExpanded = expandedId === referral.id;
                return (
                  <div
                    key={referral.id}
                    onClick={() => setExpandedId(isExpanded ? null : referral.id)}
                    className="cursor-pointer rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm transition-colors hover:border-indigo-200"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-bold text-gray-900 dark:text-gray-100">{referral.tbl_residents?.resident_name}</span>
                      <span className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                        {formatDateTime(referral.referral_datetime)}
                        <PdfDownloadLink href={`/api/reports/hospital-referral?id=${referral.id}`} />
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          className={`text-gray-400 dark:text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        >
                          <path
                            d="M6 3.5L10.5 8L6 12.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </div>
                    {!isExpanded && (
                      <p className="truncate text-sm text-gray-700 dark:text-gray-300">
                        {referral.chief_complaints || <span className="text-gray-400 dark:text-gray-500">{t("Click to view")}</span>}
                      </p>
                    )}

                    {isExpanded && (
                      <div className="mt-3 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
                        {referral.chief_complaints && (
                          <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-500 dark:text-gray-400">{t("Chief complaints")}: </span>
                            {referral.chief_complaints}
                          </p>
                        )}
                        {referral.vital_signs && (
                          <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-500 dark:text-gray-400">{t("Vital signs")}: </span>
                            {referral.vital_signs}
                          </p>
                        )}
                        {referral.mobility && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-500 dark:text-gray-400">{t("Mobility")}: </span>
                            {t(referral.mobility)}
                          </p>
                        )}
                        {referral.feeding && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-500 dark:text-gray-400">{t("Feeding")}: </span>
                            {referral.feeding}
                          </p>
                        )}
                        {referral.hygiene && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-500 dark:text-gray-400">{t("Hygiene")}: </span>
                            {t(referral.hygiene)}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                      {t("Reported by")}: {referral.reviewer?.staff_name || referral.reviewed_by_other || "--"}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        <NewHospitalReferralForm
          residents={residents}
          allStaff={allStaff}
          lookups={lookups}
          feedingTypes={feedingTypes}
          presetResidentId={currentResident || undefined}
          onSaved={(id) => {
            window.open(`/api/reports/hospital-referral?id=${id}`, "_blank", "noopener,noreferrer");
            setInnerTab("review");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
