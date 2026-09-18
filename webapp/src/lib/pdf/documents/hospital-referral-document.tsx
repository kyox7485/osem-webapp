import { Document, View, Text, StyleSheet } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, ReportSection, type ReportBranchInfo } from "../report-shell";
import { pdfColors, pdfSpacing } from "../theme";
import { formatDateTime } from "@/lib/format-date";

export type HospitalReferralReportData = {
  referral_datetime: string;
  resident_name: string;
  ic_number: string | null;
  admission_date: string | null;
  emergency_contact: string | null;
  allergy: string | null;
  past_medical_condition: string | null;
  current_medication_list: string | null;
  chief_complaints: string | null;
  vital_signs: string | null;
  mobility: string | null;
  feeding: string | null;
  hygiene: string | null;
  reviewer_name: string;
};

const mixedRowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: 4,
    marginBottom: pdfSpacing.section,
    overflow: "hidden",
  },
  compactCell: {
    width: "35%",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderRightColor: pdfColors.border,
  },
  // No fixed/min height beyond the label -- grows with however many lines
  // the emergency contact block actually needs (it's free text, can run to
  // more than one line, e.g. two separate next-of-kin entries).
  expandCell: {
    width: "65%",
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  label: {
    fontSize: 7,
    color: pdfColors.ink500,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  compactValue: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: pdfColors.ink900,
  },
  expandValue: {
    fontSize: 9.5,
    color: pdfColors.ink700,
    lineHeight: 1.4,
  },
});

// Admission date paired with emergency contact in one row -- the date is a
// short fixed-width value, but emergency contact is free text that can run
// to more than one line (e.g. two next-of-kin entries), so it gets a plain
// growing cell instead of InfoGrid's single-line-oriented layout.
function AdmissionAndContactRow({ admissionDate, emergencyContact }: { admissionDate: string | null; emergencyContact: string | null }) {
  return (
    <View style={mixedRowStyles.row} wrap={false}>
      <View style={mixedRowStyles.compactCell}>
        <Text style={mixedRowStyles.label}>Date of Nursing Home Admission</Text>
        <Text style={mixedRowStyles.compactValue}>{admissionDate ? new Date(admissionDate).toLocaleDateString("en-GB") : "--"}</Text>
      </View>
      <View style={mixedRowStyles.expandCell}>
        <Text style={mixedRowStyles.label}>Emergency Contact</Text>
        <Text style={mixedRowStyles.expandValue}>{emergencyContact || "--"}</Text>
      </View>
    </View>
  );
}

export function HospitalReferralDocument({
  referral,
  branch,
  logoSrc,
}: {
  referral: HospitalReferralReportData;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  return (
    <Document title={`Hospital Referral Note - ${referral.resident_name}`}>
      <ReportPage title="Hospital Referral Note" subtitle="Emergency / Hospital Admission Summary" branch={branch} logoSrc={logoSrc}>
        <InfoGrid
          columns={4}
          items={[
            { label: "Date/Time", value: formatDateTime(referral.referral_datetime) },
            { label: "Resident's Name", value: referral.resident_name },
            { label: "IC No. / Passport No", value: referral.ic_number ?? "--" },
            { label: "Reported By", value: referral.reviewer_name },
          ]}
        />

        <ReportSection label="Chief Complaints" value={referral.chief_complaints} minLines={3} />
        <ReportSection label="Vital Signs" value={referral.vital_signs} minLines={3} />

        <AdmissionAndContactRow admissionDate={referral.admission_date} emergencyContact={referral.emergency_contact} />
        <InfoGrid
          columns={3}
          items={[
            { label: "Mobility", value: referral.mobility ?? "--" },
            { label: "Feeding", value: referral.feeding ?? "--" },
            { label: "Hygiene", value: referral.hygiene ?? "--" },
          ]}
        />

        <ReportSection label="Allergy History" value={referral.allergy} minLines={2} />
        <ReportSection label="Past Medical / Surgical History" value={referral.past_medical_condition} minLines={3} allowPageBreak />
        <ReportSection label="Current Medication List" value={referral.current_medication_list} minLines={3} allowPageBreak />
      </ReportPage>
    </Document>
  );
}
