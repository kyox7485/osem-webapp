"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { VitalsTable } from "./vitals-table";
import { ProgressNotesModule } from "./progress-notes-module";
import { NursingChartModule, type NursingChartEntry } from "./nursing-chart-module";
import { useNavPush } from "@/components/nav-loading";
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

type ProgressNote = {
  id: number;
  resident_id: number;
  entry_timestamp: string;
  progress_note: string | null;
  physical_examination: string | null;
  medical_plan: string | null;
  nursing_plan: string | null;
  feeding_plan: string | null;
  monitoring_plan: string | null;
  dressing_plan: string | null;
  physio_plan: string | null;
  reviewed_by: string | null;
  created_by: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  reviewer: { StaffID: string; staff_name: string } | null;
  author: { StaffID: string; staff_name: string } | null;
};

type Resident = {
  id: number;
  resident_name: string;
  branch_id: number;
};

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  vitals: Vital[];
  notes: ProgressNote[];
  nursingChartEntries: NursingChartEntry[];
  nursingChartLookups: ClinicalLookups;
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

type TabKey = "vitals" | "progress-notes" | "nursing-chart";

export function ClinicalContent({
  residents,
  allStaff,
  vitals,
  notes,
  nursingChartEntries,
  nursingChartLookups,
  currentResident,
  currentStart,
  currentEnd,
  error,
}: Props) {
  const push = useNavPush();
  const t = useTranslation();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>((searchParams.get("tab") as TabKey) || "nursing-chart");

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "vitals" || tab === "progress-notes") {
      setActiveTab(tab);
    } else {
      setActiveTab("nursing-chart");
    }
  }, [searchParams]);

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    push(`/clinical?${params.toString()}`);
  }

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        <TabButton active={activeTab === "nursing-chart"} onClick={() => switchTab("nursing-chart")}>
          {t("Nursing Chart")}
        </TabButton>
        <TabButton active={activeTab === "vitals"} onClick={() => switchTab("vitals")}>
          {t("Vital Signs")}
        </TabButton>
        <TabButton active={activeTab === "progress-notes"} onClick={() => switchTab("progress-notes")}>
          {t("Medical Progress Notes")}
        </TabButton>
      </div>

      <div className="mt-6">
        {activeTab === "nursing-chart" && (
          <NursingChartModule
            entries={nursingChartEntries}
            residents={residents}
            allStaff={allStaff}
            lookups={nursingChartLookups}
            currentResident={currentResident}
            currentStart={currentStart}
            currentEnd={currentEnd}
            error={error}
          />
        )}
        {activeTab === "vitals" && (
          <VitalsTable
            vitals={vitals}
            residents={residents}
            allStaff={allStaff}
            lookups={nursingChartLookups}
            currentResident={currentResident}
            currentStart={currentStart}
            currentEnd={currentEnd}
            error={error}
          />
        )}
        {activeTab === "progress-notes" && (
          <ProgressNotesModule
            notes={notes}
            residents={residents}
            allStaff={allStaff}
            currentResident={currentResident}
            currentStart={currentStart}
            currentEnd={currentEnd}
            error={error}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800"
      }`}
    >
      {children}
    </button>
  );
}
