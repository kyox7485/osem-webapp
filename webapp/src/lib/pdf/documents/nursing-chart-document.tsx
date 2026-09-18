import { Document } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, ReportSection, type ReportBranchInfo } from "../report-shell";
import { formatDateTime } from "@/lib/format-date";

export type NursingChartReportData = {
  entry_timestamp: string;
  resident_name: string;
  ic_number: string | null;
  tube_feeding: string | null;
  fluid_input: number | null;
  fluid_output: number | null;
  cbd_drainage: string | null;
  elimination_labels: string[];
  activity_labels: string[];
  disturbance_level_labels: string[];
  psycho_social_labels: string[];
  active_complaint_labels: string[];
  meal_labels: string[];
  hygiene_labels: string[];
  intervention: string | null;
  doctors_plan: string | null;
  entered_by_name: string;
};

function joinOrNull(items: string[], sep = ", "): string | null {
  return items.length > 0 ? items.join(sep) : null;
}

export function NursingChartDocument({
  entry,
  branch,
  logoSrc,
}: {
  entry: NursingChartReportData;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  const fluidIo =
    entry.fluid_input !== null || entry.fluid_output !== null
      ? `In: ${entry.fluid_input ?? "--"} ml   /   Out: ${entry.fluid_output ?? "--"} ml`
      : null;

  return (
    <Document title={`Nursing Chart - ${entry.resident_name}`}>
      <ReportPage title="Nursing Chart" subtitle="Shift Documentation" branch={branch} logoSrc={logoSrc}>
        <InfoGrid
          columns={4}
          items={[
            { label: "Date/Time", value: formatDateTime(entry.entry_timestamp) },
            { label: "Resident's Name", value: entry.resident_name },
            { label: "IC Number", value: entry.ic_number ?? "--" },
            { label: "Entered By", value: entry.entered_by_name },
          ]}
        />

        <InfoGrid
          columns={3}
          items={[
            { label: "Feeding", value: entry.tube_feeding ?? "--" },
            { label: "Fluid I/O", value: fluidIo ?? "--" },
            { label: "CBD Drainage", value: entry.cbd_drainage ?? "--" },
          ]}
        />

        <ReportSection label="Diaper / Elimination Checks" value={joinOrNull(entry.elimination_labels, " | ")} minLines={2} />
        <ReportSection label="Meals" value={joinOrNull(entry.meal_labels, " | ")} minLines={2} />
        <ReportSection label="Hygiene Care" value={joinOrNull(entry.hygiene_labels, " | ")} minLines={2} />
        <ReportSection label="Activity" value={joinOrNull(entry.activity_labels)} minLines={2} />
        <ReportSection label="Disturbance Level" value={joinOrNull(entry.disturbance_level_labels)} minLines={1} />
        <ReportSection label="Psycho-Social Behaviour" value={joinOrNull(entry.psycho_social_labels)} minLines={2} />
        <ReportSection label="Active Complaint" value={joinOrNull(entry.active_complaint_labels)} minLines={2} />
        <ReportSection label="Intervention" value={entry.intervention} minLines={3} />
        <ReportSection label="Doctor's Plan" value={entry.doctors_plan} minLines={3} />
      </ReportPage>
    </Document>
  );
}
