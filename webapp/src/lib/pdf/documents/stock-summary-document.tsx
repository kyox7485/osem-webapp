import { Document, View, Text, StyleSheet } from "@react-pdf/renderer";
import { ReportPage, branding, type ReportBranchInfo } from "../report-shell";
import { pdfColors, pdfSpacing } from "../theme";
import type { StockSummaryRow } from "@/lib/medication-stock-report";

// Medication Stock Summary — every active order for one resident, any
// supplier, in one table mirroring the Stock screen. Days Remaining is
// colour-banded with the same thresholds as the screen's badge; the text
// itself ("Out of stock", "9 days left") carries the meaning too, so a
// black-and-white print still reads correctly.

const green = "#047857";
const greenSoft = "#ecfdf5";

const TONE: Record<StockSummaryRow["tone"], { bg: string; fg: string }> = {
  out: { bg: pdfColors.criticalSoft, fg: pdfColors.critical },
  low: { bg: pdfColors.warningSoft, fg: pdfColors.warning },
  ok: { bg: greenSoft, fg: green },
  none: { bg: pdfColors.white, fg: pdfColors.ink500 },
};

const COLS = [
  { label: "Medicine", width: "31%" },
  { label: "Balance", width: "11%" },
  { label: "Daily Usage", width: "11%" },
  { label: "Days Remaining", width: "20%" },
  { label: "Supplied By", width: "12%" },
  { label: "Last Count", width: "15%" },
] as const;

const s = StyleSheet.create({
  identity: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: 4,
    marginBottom: pdfSpacing.section,
  },
  identityCell: { paddingVertical: 7, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: pdfColors.border },
  identityLabel: { fontSize: 7, color: pdfColors.ink500, marginBottom: 2 },
  identityValue: { fontSize: 10, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },

  table: { borderWidth: 1, borderColor: pdfColors.border, borderRadius: 4 },
  head: { flexDirection: "row", backgroundColor: pdfColors.bandStrong, borderBottomWidth: 1, borderBottomColor: pdfColors.borderStrong },
  headCell: { fontSize: 7, fontFamily: branding.fontFamilyBold, color: pdfColors.ink700, paddingVertical: 5, paddingHorizontal: 5 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: pdfColors.border },
  cell: { fontSize: 8, color: pdfColors.ink700, paddingVertical: 5, paddingHorizontal: 5 },
  strong: { fontSize: 8, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },
  muted: { fontSize: 7, color: pdfColors.ink500, marginTop: 1.5 },
  empty: { fontSize: 8, color: pdfColors.ink400, padding: 8 },

  legend: { flexDirection: "row", flexWrap: "wrap", marginTop: 6, gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  legendSwatch: { width: 8, height: 8, borderRadius: 1.5, borderWidth: 0.75 },
  legendText: { fontSize: 7, color: pdfColors.ink500 },
  footnote: { fontSize: 7, color: pdfColors.ink500, lineHeight: 1.4, marginTop: 4 },
});

export function StockSummaryDocument({
  residentName,
  generatedOn,
  rows,
  lowStockDays,
  branch,
  logoSrc,
}: {
  residentName: string;
  generatedOn: string;
  rows: StockSummaryRow[];
  lowStockDays: number;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  return (
    <Document title={`Medication Stock Summary - ${residentName}`}>
      <ReportPage title="Medication Stock Summary" branch={branch} logoSrc={logoSrc}>
        <View style={s.identity}>
          {[
            { label: "Resident", value: residentName, width: "55%" },
            { label: "Active Medicines", value: String(rows.length), width: "20%" },
            { label: "Generated On", value: generatedOn, width: "25%" },
          ].map((c, i, all) => (
            <View key={c.label} style={[s.identityCell, { width: c.width }, ...(i === all.length - 1 ? [{ borderRightWidth: 0 }] : [])]}>
              <Text style={s.identityLabel}>{c.label.toUpperCase()}</Text>
              <Text style={s.identityValue}>{c.value}</Text>
            </View>
          ))}
        </View>

        <View style={s.table}>
          <View style={s.head} fixed>
            {COLS.map((c) => (
              <Text key={c.label} style={[s.headCell, { width: c.width }]}>
                {c.label.toUpperCase()}
              </Text>
            ))}
          </View>
          {rows.length === 0 ? (
            <Text style={s.empty}>No active medication orders.</Text>
          ) : (
            rows.map((r, i) => {
              const tone = TONE[r.tone];
              return (
                <View key={i} style={[s.row, ...(i === rows.length - 1 ? [{ borderBottomWidth: 0 }] : [])]} wrap={false}>
                  <View style={[s.cell, { width: COLS[0].width }]}>
                    <Text style={s.strong}>{r.medicine}</Text>
                    {r.schedule && <Text style={s.muted}>{r.schedule}</Text>}
                  </View>
                  <Text style={[s.cell, { width: COLS[1].width }]}>{r.balance}</Text>
                  <Text style={[s.cell, { width: COLS[2].width }]}>{r.dailyUsage}</Text>
                  <View style={[s.cell, { width: COLS[3].width, backgroundColor: tone.bg }]}>
                    <Text style={[s.strong, { color: tone.fg }]}>{r.days}</Text>
                    {r.daysDetail && <Text style={s.muted}>{r.daysDetail}</Text>}
                  </View>
                  <Text style={[s.cell, { width: COLS[4].width }]}>{r.suppliedBy}</Text>
                  <Text style={[s.cell, { width: COLS[5].width }, ...(r.lastCount ? [] : [{ color: pdfColors.ink400 }])]}>
                    {r.lastCount ?? "Never counted"}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        <View style={s.legend} wrap={false}>
          {[
            { tone: TONE.out, label: "Out of stock" },
            { tone: TONE.low, label: `Less than ${lowStockDays} days left` },
            { tone: TONE.ok, label: `${lowStockDays}+ days, or enough until order ends` },
          ].map((l) => (
            <View key={l.label} style={s.legendItem}>
              <View style={[s.legendSwatch, { backgroundColor: l.tone.bg, borderColor: l.tone.fg }]} />
              <Text style={s.legendText}>{l.label}</Text>
            </View>
          ))}
        </View>
        <Text style={s.footnote}>
          Countable balances are forecast from the prescription since each medicine&apos;s latest stock entry, not a physical
          count. Last Count is the latest Stock Count entry.
        </Text>
      </ReportPage>
    </Document>
  );
}
