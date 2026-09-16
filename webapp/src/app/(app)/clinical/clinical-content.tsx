"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { VitalsTable } from "./vitals-table";
import { ProgressNotesModule } from "./progress-notes-module";
import type { LookupOption } from "@/lib/types";

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
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

export function ClinicalContent({
  residents,
  allStaff,
  vitals,
  notes,
  currentResident,
  currentStart,
  currentEnd,
  error,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"vitals" | "progress-notes">(
    (searchParams.get("tab") as "vitals" | "progress-notes") || "vitals"
  );

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "progress-notes") {
      setActiveTab("progress-notes");
    } else {
      setActiveTab("vitals");
    }
  }, [searchParams]);

  function switchTab(tab: "vitals" | "progress-notes") {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`/clinical?${params.toString()}`, { scroll: false });
  }

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        <TabButton active={activeTab === "vitals"} onClick={() => switchTab("vitals")}>
          Vital Signs
        </TabButton>
        <TabButton active={activeTab === "progress-notes"} onClick={() => switchTab("progress-notes")}>
          Medical Progress Notes
        </TabButton>
      </div>

      <div className="mt-6">
        {activeTab === "vitals" && (
          <VitalsTable
            vitals={vitals}
            residents={residents}
            allStaff={allStaff}
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
