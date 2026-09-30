import { Document, View, Text, StyleSheet, type Styles } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, branding, type ReportBranchInfo } from "../report-shell";
import { pdfColors, pdfSpacing } from "../theme";
import { formatCell, type ReportColumn, type ReportResult } from "@/lib/inventory/reports/types";

// One generic table document for every Inventory report (Phase 7): title,
// branch, filter summary, who/when generated, the table with an optional
// totals row, notes and, when the export was cut short, a truncation notice.
// Every label and enum cell arrives already translated by the loader.

const LANDSCAPE_FROM_COLUMNS = 8;
const MIN_WEIGHT = 6;
const MAX_WEIGHT = 30;
const SAMPLE_ROWS = 200;

const s = StyleSheet.create({
  table: { borderWidth: 1, borderColor: pdfColors.border, borderRadius: 4 },
  head: { flexDirection: "row", backgroundColor: pdfColors.bandStrong, borderBottomWidth: 1, borderBottomColor: pdfColors.borderStrong },
  headCell: { fontSize: 7, fontFamily: branding.fontFamilyBold, color: pdfColors.ink700, paddingVertical: 5, paddingHorizontal: 4 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: pdfColors.border },
  groupRow: { flexDirection: "row", backgroundColor: pdfColors.bandStrong, borderBottomWidth: 1, borderBottomColor: pdfColors.borderStrong },
  groupCell: { fontSize: 7.5, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900, paddingVertical: 4, paddingHorizontal: 4 },
  cell: { fontSize: 7.5, color: pdfColors.ink700, paddingVertical: 4, paddingHorizontal: 4 },
  negative: { color: pdfColors.critical },
  totalRow: { flexDirection: "row", backgroundColor: pdfColors.band, borderTopWidth: 1, borderTopColor: pdfColors.borderStrong },
  totalCell: { fontSize: 7.5, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900, paddingVertical: 5, paddingHorizontal: 4 },
  empty: { fontSize: 8, color: pdfColors.ink400, padding: 8 },
  note: { fontSize: 7, color: pdfColors.ink500, lineHeight: 1.4, marginTop: 4 },
  warning: { fontSize: 8, color: pdfColors.warning, backgroundColor: pdfColors.warningSoft, padding: 6, borderRadius: 3, marginTop: 8 },
});

/**
 * The built-in PDF fonts only cover Latin-1 and a few punctuation marks.
 * Anything else (arrows, CJK in a product name) would render as garbage, so it
 * becomes "?" and the double arrow becomes a slash.
 */
export function pdfSafe(text: string): string {
  return text.replace(/↔/g, "/").replace(/[^ -ÿ–—‘’“”•…]/g, "?");
}

/** Column widths (as %) proportional to the longest label or cell, within sane bounds. */
export function columnWidths(report: ReportResult): string[] {
  const weights = report.columns.map((c) => {
    const sample = report.rows.slice(0, SAMPLE_ROWS).reduce((max, r) => Math.max(max, formatCell(c.kind, r[c.key] ?? null).length), c.label.length);
    return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, sample));
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => `${((w / sum) * 100).toFixed(2)}%`);
}

type PdfStyle = Styles[string];
const NUMERIC = new Set(["int", "qty", "money", "money4"]);

function cellStyle(column: ReportColumn, value: string | number | null, base: PdfStyle): PdfStyle[] {
  const numeric = NUMERIC.has(column.kind);
  return [base, numeric ? { textAlign: "right" as const } : {}, numeric && typeof value === "number" && value < 0 ? s.negative : {}];
}

export function InventoryReportDocument({
  report,
  branch,
  logoSrc,
  generatedBy,
  generatedAt,
  labels,
  truncationNote,
}: {
  report: ReportResult;
  branch: ReportBranchInfo;
  logoSrc: string;
  generatedBy: string;
  generatedAt: string;
  labels: { generatedBy: string; generatedAt: string; noRows: string };
  truncationNote: string | null;
}) {
  const widths = columnWidths(report);
  const info = [...report.filters, { label: labels.generatedBy, value: generatedBy }, { label: labels.generatedAt, value: generatedAt }];
  const landscape = report.columns.length >= LANDSCAPE_FROM_COLUMNS;
  // Some exports are named differently from the on-screen heading; `pdfTitle`
  // overrides it for the PDF alone.
  const title = pdfSafe(report.pdfTitle ?? report.title);
  return (
    <Document title={title}>
      <ReportPage title={title} branch={branch} logoSrc={logoSrc} landscape={landscape}>
        <InfoGrid items={info.map((i) => ({ label: pdfSafe(i.label), value: pdfSafe(i.value) }))} columns={Math.min(4, info.length)} />
        <View style={s.table}>
          <View style={s.head} fixed>
            {report.columns.map((c, i) => (
              <Text key={c.key} style={[s.headCell, { width: widths[i] }, NUMERIC.has(c.kind) ? { textAlign: "right" } : {}]}>
                {pdfSafe(c.label)}
              </Text>
            ))}
          </View>
          {report.rows.length === 0 && <Text style={s.empty}>{pdfSafe(labels.noRows)}</Text>}
          {report.rows.map((row, r) => {
            // Category band above the first row of each group, mirroring the
            // on-screen table. A report whose rows carry no hidden `_group`
            // field renders exactly as before.
            const group = row._group != null ? pdfSafe(String(row._group)) : null;
            const previousGroup = report.rows[r - 1]?._group != null ? String(report.rows[r - 1]._group) : null;
            return (
              <View key={r}>
                {group !== null && group !== previousGroup && (
                  <View style={s.groupRow} wrap={false}>
                    <Text style={s.groupCell}>{group}</Text>
                  </View>
                )}
                <View style={s.row} wrap={false}>
                  {report.columns.map((c, i) => (
                    <Text key={c.key} style={[...cellStyle(c, row[c.key] ?? null, s.cell), { width: widths[i] }]}>
                      {pdfSafe(formatCell(c.kind, row[c.key] ?? null))}
                    </Text>
                  ))}
                </View>
              </View>
            );
          })}
          {report.totals && (
            <View style={s.totalRow} wrap={false}>
              {report.columns.map((c, i) => (
                <Text key={c.key} style={[...cellStyle(c, report.totals?.[c.key] ?? null, s.totalCell), { width: widths[i] }]}>
                  {pdfSafe(formatCell(c.kind, report.totals?.[c.key] ?? null))}
                </Text>
              ))}
            </View>
          )}
        </View>
        {report.notes.map((n, i) => (
          <Text key={i} style={s.note}>
            {pdfSafe(n)}
          </Text>
        ))}
        {truncationNote && <Text style={[s.warning, { marginBottom: pdfSpacing.section }]}>{pdfSafe(truncationNote)}</Text>}
      </ReportPage>
    </Document>
  );
}
