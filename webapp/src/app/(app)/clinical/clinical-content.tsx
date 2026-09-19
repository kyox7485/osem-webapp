"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { VitalsTable } from "./vitals-table";
import { ProgressNotesModule } from "./progress-notes-module";
import { NursingChartModule, type NursingChartEntry } from "./nursing-chart-module";
import { HospitalReferralModule } from "./hospital-referral-module";
import { WoundPhotoModule } from "./wound-photo-module";
import { ObservationChartModule } from "./observation-chart-module";
import { BehaviourChartModule } from "./behaviour-chart-module";
import type { WoundSession } from "./wound-photo-actions";
import type { WoundBodyPart } from "./wound-body-diagram";
import type { ObservationEntry } from "./observation-chart-actions";
import type { BehaviourEntry } from "./behaviour-chart-actions";
import { useNavPush } from "@/components/nav-loading";
import type { LookupOption } from "@/lib/types";
import type { ClinicalLookups } from "@/lib/lookups";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { ClipboardList, Activity, FileText, Ambulance, Camera, Eye, Brain } from "lucide-react";

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
  reviewed_by_other: string | null;
  created_by: string | null;
  created_by_other: string | null;
  tbl_residents: { id: number; resident_name: string; branch_id: number } | null;
  reviewer: { StaffID: string; staff_name: string } | null;
  author: { StaffID: string; staff_name: string } | null;
};

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
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  // Nursing Chart's "entered by" picker only -- restricted to Nursing/
  // Medical department staff, unlike the other tabs which use allStaff.
  nursingStaff: (LookupOption & { branch_id: number })[];
  vitals: Vital[];
  notes: ProgressNote[];
  nursingChartEntries: NursingChartEntry[];
  nursingChartLookups: ClinicalLookups;
  feedingTypes: LookupOption[];
  referrals: HospitalReferral[];
  woundSessions: WoundSession[];
  woundBodyParts: WoundBodyPart[];
  observationEntries: ObservationEntry[];
  behaviourEntries: BehaviourEntry[];
  currentResident: string;
  currentStart: string;
  currentEnd: string;
  error: string | null;
};

type TabKey = "vitals" | "wound-photo" | "progress-notes" | "nursing-chart" | "hospital-referral" | "observation-chart" | "behaviour-chart";

export function ClinicalContent({
  residents,
  allStaff,
  nursingStaff,
  vitals,
  notes,
  nursingChartEntries,
  nursingChartLookups,
  feedingTypes,
  referrals,
  woundSessions,
  woundBodyParts,
  observationEntries,
  behaviourEntries,
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
    if (tab === "vitals" || tab === "wound-photo" || tab === "progress-notes" || tab === "hospital-referral" || tab === "observation-chart" || tab === "behaviour-chart") {
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
      <TabRow className="mb-6">
        <TabButton icon={ClipboardList} active={activeTab === "nursing-chart"} onClick={() => switchTab("nursing-chart")}>
          {t("Nursing Chart")}
        </TabButton>
        <TabButton icon={Eye} active={activeTab === "observation-chart"} onClick={() => switchTab("observation-chart")}>
          {t("Observation Chart")}
        </TabButton>
        <TabButton icon={Brain} active={activeTab === "behaviour-chart"} onClick={() => switchTab("behaviour-chart")}>
          {t("Behaviour Chart")}
        </TabButton>
        <TabButton icon={Activity} active={activeTab === "vitals"} onClick={() => switchTab("vitals")}>
          {t("Vital Signs")}
        </TabButton>
        <TabButton icon={Camera} active={activeTab === "wound-photo"} onClick={() => switchTab("wound-photo")}>
          {t("Wound Photo")}
        </TabButton>
        <TabButton icon={FileText} active={activeTab === "progress-notes"} onClick={() => switchTab("progress-notes")}>
          {t("Medical Progress Notes")}
        </TabButton>
        <TabButton icon={Ambulance} active={activeTab === "hospital-referral"} onClick={() => switchTab("hospital-referral")}>
          {t("Hospital Referral")}
        </TabButton>
      </TabRow>

      <div className="mt-6">
        {activeTab === "nursing-chart" && (
          <NursingChartModule
            entries={nursingChartEntries}
            residents={residents}
            allStaff={nursingStaff}
            lookups={nursingChartLookups}
            currentResident={currentResident}
            currentStart={currentStart}
            currentEnd={currentEnd}
            error={error}
          />
        )}
        {activeTab === "observation-chart" && (
          <ObservationChartModule
            entries={observationEntries}
            residents={residents}
            allStaff={nursingStaff}
            currentResident={currentResident}
            currentStart={currentStart}
            currentEnd={currentEnd}
            error={error}
          />
        )}
        {activeTab === "behaviour-chart" && (
          <BehaviourChartModule
            entries={behaviourEntries}
            residents={residents}
            allStaff={allStaff}
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
        {activeTab === "wound-photo" && (
          <WoundPhotoModule
            sessions={woundSessions}
            residents={residents}
            allStaff={allStaff}
            bodyParts={woundBodyParts}
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
        {activeTab === "hospital-referral" && (
          <HospitalReferralModule
            referrals={referrals}
            residents={residents}
            allStaff={allStaff}
            lookups={nursingChartLookups}
            feedingTypes={feedingTypes}
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
