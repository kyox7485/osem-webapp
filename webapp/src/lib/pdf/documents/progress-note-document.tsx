import { Document } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, ReportSection, type ReportBranchInfo } from "../report-shell";
import { formatDateTime } from "@/lib/format-date";

export type ProgressNoteReportData = {
  entry_timestamp: string;
  resident_name: string;
  ic_number: string | null;
  past_medical_condition: string | null;
  progress_note: string | null;
  physical_examination: string | null;
  medical_plan: string | null;
  monitoring_plan: string | null;
  feeding_plan: string | null;
  dressing_plan: string | null;
  nursing_plan: string | null;
  physio_plan: string | null;
  current_medication_list: string | null;
  author_name: string;
  reviewer_name: string;
};

export function ProgressNoteDocument({
  note,
  branch,
  logoSrc,
}: {
  note: ProgressNoteReportData;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  return (
    <Document title={`Medical Progress Note - ${note.resident_name}`}>
      <ReportPage title="Medical Progress Note" subtitle="Physician / Clinical Documentation" branch={branch} logoSrc={logoSrc}>
        <InfoGrid
          columns={4}
          items={[
            { label: "Date/Time", value: formatDateTime(note.entry_timestamp) },
            { label: "Resident's Name", value: note.resident_name },
            { label: "IC Number", value: note.ic_number ?? "--" },
            { label: "Documented By", value: note.author_name },
          ]}
        />

        <ReportSection label="Past Medical / Surgical History" value={note.past_medical_condition} minLines={2} />
        <ReportSection label="Progress Note" value={note.progress_note} minLines={4} />
        {/* feeding_plan/monitoring_plan kept the same box size as
            physical_examination/medical_plan -- both are long-text fields,
            same convention as the entry forms and table views. */}
        <ReportSection label="Physical Examination" value={note.physical_examination} minLines={3} />
        <ReportSection label="Medical Plan" value={note.medical_plan} minLines={3} />
        <ReportSection label="Feeding Plan" value={note.feeding_plan} minLines={3} />
        <ReportSection label="Monitoring Plan" value={note.monitoring_plan} minLines={3} />
        <ReportSection label="Nursing Plan" value={note.nursing_plan} minLines={2} />
        <ReportSection label="Dressing Plan" value={note.dressing_plan} minLines={2} />
        <ReportSection label="Physio Plan" value={note.physio_plan} minLines={2} />
        <ReportSection label="Current Medication List" value={note.current_medication_list} minLines={3} />

        <InfoGrid columns={2} items={[{ label: "Reviewed By", value: note.reviewer_name }, { label: "Author", value: note.author_name }]} />
      </ReportPage>
    </Document>
  );
}
