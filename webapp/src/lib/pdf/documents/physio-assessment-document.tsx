import { Document, View, Text, StyleSheet } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, ReportSection, ReportTable, type ReportTableColumn, type ReportBranchInfo } from "../report-shell";
import { pdfColors } from "../theme";
import { formatDateTime } from "@/lib/format-date";
import { EXAM_STRUCTURE, type ExamLimb, type ExamRow } from "@/lib/physio-scoring";

export type PhysioAssessmentReportData = {
  entry_timestamp: string;
  patient_name: string;
  ic_number: string | null;
  gender: string | null;
  age: number | null;
  care_setting: "IP" | "OP";
  treatment_type: string | null;
  total_score: number | null;
  chief_complaint: string | null;
  current_history: string | null;
  past_medical_history: string | null;
  social_history: string | null;
  impression: string | null;
  plan_intervention: string | null;
  evaluation: string | null;
  treatment_compliance: string | null;
  documented_by_name: string;
  examRows: ExamRow[];
  bodyChart: { region: string; side: string | null; comment: string }[];
  functional: Record<string, number | null>;
  balance: Record<string, number | null>;
  coordination: Record<string, number | null>;
};

const styles = StyleSheet.create({
  subHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: pdfColors.ink900,
    marginTop: 6,
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  scoreBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  list: {
    fontSize: 8.5,
    color: pdfColors.ink700,
    lineHeight: 1.5,
  },
});

const examColumns: ReportTableColumn<ExamRow>[] = [
  { label: "Region", width: "26%", render: (r) => r.region },
  { label: "Movement", width: "30%", render: (r) => r.movement },
  { label: "Side", width: "10%", render: (r) => r.side },
  { label: "Power", width: "8.5%", render: (r) => String(r.power ?? "--") },
  { label: "Tone", width: "8.5%", render: (r) => String(r.tone ?? "--") },
  { label: "ROM", width: "8.5%", render: (r) => String(r.rom ?? "--") },
  { label: "Reflexes", width: "8.5%", render: (r) => String(r.reflexes ?? "--") },
];

function scoreLine(scores: Record<string, number | null>): string {
  const parts = Object.entries(scores)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${humanize(k)}: ${v}`);
  return parts.length > 0 ? parts.join("   ") : "";
}

function humanize(key: string): string {
  return key
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function PhysioAssessmentDocument({
  data,
  branch,
  logoSrc,
}: {
  data: PhysioAssessmentReportData;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  const functionalLine = scoreLine(data.functional);
  const balanceLine = scoreLine(data.balance);
  const coordinationLine = scoreLine(data.coordination);

  return (
    <Document title={`Physiotherapy Assessment - ${data.patient_name}`}>
      <ReportPage
        title="Physiotherapy Assessment Note"
        subtitle={data.care_setting === "OP" ? "Outpatient Department" : "Inpatient Department"}
        branch={branch}
        logoSrc={logoSrc}
      >
        <InfoGrid
          columns={4}
          items={[
            { label: "Date/Time", value: formatDateTime(data.entry_timestamp) },
            { label: "Patient's Name", value: data.patient_name },
            { label: "IC Number", value: data.ic_number ?? "--" },
            { label: "Treatment Type", value: data.treatment_type ?? "--" },
          ]}
        />

        <InfoGrid
          columns={4}
          items={[
            { label: "Gender", value: data.gender ?? "--" },
            { label: "Age", value: data.age !== null ? String(data.age) : "--" },
            { label: "Total Score", value: data.total_score !== null ? String(data.total_score) : "--" },
            { label: "Documented By", value: data.documented_by_name },
          ]}
        />

        <ReportSection label="Chief Complaint" value={data.chief_complaint} minLines={2} />
        <ReportSection label="Current History" value={data.current_history} minLines={2} />
        <ReportSection label="Past Medical History" value={data.past_medical_history} minLines={2} />
        <ReportSection label="Social History" value={data.social_history} minLines={1} />

        {data.bodyChart.length > 0 && (
          <View style={{ marginBottom: 10 }} wrap={false}>
            <Text style={styles.subHeading}>Body Chart Findings</Text>
            <View style={{ borderWidth: 1, borderColor: pdfColors.border, borderRadius: 4, padding: 8 }}>
              {data.bodyChart.map((f, i) => (
                <Text key={i} style={styles.list}>
                  • {f.region}
                  {f.side ? ` (${f.side})` : ""}: {f.comment}
                </Text>
              ))}
            </View>
          </View>
        )}

        {data.examRows.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.subHeading}>Physical Examination</Text>
            {(Object.keys(EXAM_STRUCTURE) as ExamLimb[]).map((limb) => {
              const rows = data.examRows.filter((r) => r.limb === limb);
              if (rows.length === 0) return null;
              return (
                <View key={limb} style={{ marginBottom: 6 }}>
                  <Text style={{ fontSize: 8, color: pdfColors.ink500, marginBottom: 3 }}>{EXAM_STRUCTURE[limb].label}</Text>
                  <ReportTable columns={examColumns} rows={rows} emptyLabel="" />
                </View>
              );
            })}
          </View>
        )}

        {(functionalLine || balanceLine || coordinationLine) && (
          <View style={{ marginBottom: 10 }} wrap={false}>
            <Text style={styles.subHeading}>Functional / Balance / Coordination Scores</Text>
            <View style={{ borderWidth: 1, borderColor: pdfColors.border, borderRadius: 4, padding: 8, gap: 3 }}>
              {functionalLine && <Text style={styles.list}>Functional — {functionalLine}</Text>}
              {balanceLine && <Text style={styles.list}>Balance — {balanceLine}</Text>}
              {coordinationLine && <Text style={styles.list}>Coordination — {coordinationLine}</Text>}
            </View>
          </View>
        )}

        <ReportSection label="Impression / Analysis" value={data.impression} minLines={2} />
        <ReportSection label="Plan & Intervention" value={data.plan_intervention} minLines={3} />
        <ReportSection label="Evaluation" value={data.evaluation} minLines={2} />
        <ReportSection label="Treatment Compliance" value={data.treatment_compliance} minLines={1} />
      </ReportPage>
    </Document>
  );
}
