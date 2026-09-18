import { Document } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, ReportTable, type ReportTableColumn, type ReportBranchInfo } from "../report-shell";
import { formatDateTime } from "@/lib/format-date";
import { pdfColors } from "../theme";
import {
  flagVital,
  flagSystolic,
  flagDiastolic,
  flagHeartRate,
  flagTemperature,
  flagSpo2,
  flagDxt,
} from "@/lib/vital-thresholds";

export type VitalSignRow = {
  id: number;
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
  reviewed_by_name: string | null;
};

function flagColor(severity: "critical" | "warning" | null | undefined): string | undefined {
  if (severity === "critical") return pdfColors.critical;
  if (severity === "warning") return pdfColors.warning;
  return undefined;
}

const columns: ReportTableColumn<VitalSignRow>[] = [
  { label: "Date/Time", width: "14%", render: (r) => formatDateTime(r.entry_timestamp) },
  {
    label: "Systolic\n(mmHg)",
    width: "9%",
    render: (r) => (r.systolic_bp ?? "--").toString(),
    color: (r) => flagColor(flagSystolic(r.systolic_bp)),
  },
  {
    label: "Diastolic\n(mmHg)",
    width: "9%",
    render: (r) => (r.diastolic_bp ?? "--").toString(),
    color: (r) => flagColor(flagDiastolic(r.diastolic_bp)),
  },
  {
    label: "Heart Rate\n(bpm)",
    width: "9%",
    render: (r) => (r.heart_rate ?? "--").toString(),
    color: (r) => flagColor(flagHeartRate(r.heart_rate)),
  },
  {
    label: "Temp\n(°C)",
    width: "8%",
    render: (r) => (r.temperature ?? "--").toString(),
    color: (r) => flagColor(flagTemperature(r.temperature)),
  },
  {
    label: "SpO2\n(%)",
    width: "9%",
    render: (r) => `${r.spo2 ?? "--"}${r.spo2_condition ? ` (${r.spo2_condition})` : ""}`,
    color: (r) => flagColor(flagSpo2(r.spo2)),
  },
  {
    label: "DXT",
    width: "8%",
    render: (r) => `${r.dxt ?? "--"}${r.dxt_remark ? ` (${r.dxt_remark})` : ""}`,
    color: (r) => flagColor(flagDxt(r.dxt)),
  },
  { label: "Insulin Adj.", width: "10%", render: (r) => r.insulin_adjustment || "--" },
  {
    label: "Advanced Obs.",
    width: "13%",
    render: (r) => {
      const parts = [r.respiration_rate !== null ? `RR${r.respiration_rate}` : null, r.gcs_label, r.avpu_label].filter(Boolean);
      return parts.length > 0 ? parts.join(" ") : "--";
    },
  },
  { label: "Reviewed By", width: "11%", render: (r) => r.reviewed_by_name || "--" },
];

export function VitalSignsDocument({
  residentName,
  icNumber,
  rangeLabel,
  rows,
  branch,
  logoSrc,
}: {
  residentName: string;
  icNumber: string | null;
  rangeLabel: string;
  rows: VitalSignRow[];
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  const criticalCount = rows.filter((r) => flagVital(r) === "critical").length;
  const warningCount = rows.filter((r) => flagVital(r) === "warning").length;

  return (
    <Document title={`Vital Sign Report - ${residentName}`}>
      <ReportPage title="Resident's Vital Sign Report" subtitle={rangeLabel} branch={branch} logoSrc={logoSrc}>
        <InfoGrid
          columns={4}
          items={[
            { label: "Resident's Name", value: residentName },
            { label: "IC Number", value: icNumber ?? "--" },
            { label: "Entries", value: String(rows.length) },
            { label: "Critical / Out-of-range", value: `${criticalCount} / ${warningCount}` },
          ]}
        />

        <ReportTable columns={columns} rows={rows} emptyLabel="No vital signs recorded for this period." />
      </ReportPage>
    </Document>
  );
}
