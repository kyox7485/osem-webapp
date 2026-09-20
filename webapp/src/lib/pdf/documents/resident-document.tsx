import { Document } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, ReportSection, type ReportBranchInfo } from "../report-shell";

export type ResidentReportData = {
  ResidentID: string | null;
  resident_name: string;
  ic_number: string | null;
  age: number | null;
  gender: string | null;
  marital_status: string | null;
  nationality: string | null;
  status: string;
  care_type: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  transfer_from: string | null;
  accompanied_by: string | null;
  emergency_contact: string | null;
  mobility: string | null;
  hygiene: string | null;
  diet_type: string | null;
  feeding_type: string | null;
  allergy: string | null;
  diagnoses: string | null;
  assessment_and_summary: string | null;
  tca_notes: string | null;
  reviewed_by: string | null;
};

export function ResidentDocument({
  resident,
  branch,
  logoSrc,
}: {
  resident: ResidentReportData;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  return (
    <Document title={`Resident Record - ${resident.resident_name}`}>
      <ReportPage title="Resident Record" subtitle="Admission & Clinical Summary" branch={branch} logoSrc={logoSrc}>
        <InfoGrid
          columns={4}
          items={[
            { label: "Resident ID", value: resident.ResidentID ?? "--" },
            { label: "Name", value: resident.resident_name },
            { label: "IC / Passport", value: resident.ic_number ?? "--" },
            { label: "Age", value: resident.age != null ? String(resident.age) : "--" },
            { label: "Gender", value: resident.gender ?? "--" },
            { label: "Marital Status", value: resident.marital_status ?? "--" },
            { label: "Nationality", value: resident.nationality ?? "--" },
            { label: "Status", value: resident.status ?? "--" },
          ]}
        />

        <InfoGrid
          columns={4}
          items={[
            { label: "Care Type", value: resident.care_type ?? "--" },
            { label: "Admission Date", value: resident.admission_date ?? "--" },
            { label: "Discharge Date", value: resident.discharge_date ?? "--" },
            { label: "Transfer From", value: resident.transfer_from ?? "--" },
            { label: "Accompanied By", value: resident.accompanied_by ?? "--" },
          ]}
        />

        <ReportSection label="Emergency Contact" value={resident.emergency_contact} minLines={2} />

        <InfoGrid
          columns={3}
          items={[
            { label: "Mobility", value: resident.mobility ?? "--" },
            { label: "Hygiene", value: resident.hygiene ?? "--" },
            { label: "Diet Type", value: resident.diet_type ?? "--" },
            { label: "Feeding Type", value: resident.feeding_type ?? "--" },
          ]}
        />

        <ReportSection label="Allergy" value={resident.allergy} minLines={2} />
        <ReportSection label="Known Medical / Surgical History" value={resident.diagnoses} minLines={2} />
        <ReportSection label="Assessment and Summary" value={resident.assessment_and_summary} minLines={4} />
        <ReportSection label="TCA Notes" value={resident.tca_notes} minLines={2} />

        <InfoGrid
          columns={2}
          items={[{ label: "Reviewed By", value: resident.reviewed_by ?? "--" }, { label: "", value: "" }]}
        />
      </ReportPage>
    </Document>
  );
}
