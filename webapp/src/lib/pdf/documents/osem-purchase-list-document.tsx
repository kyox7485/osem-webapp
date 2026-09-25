import { Document, View, Text, StyleSheet } from "@react-pdf/renderer";
import { ReportPage, branding, type ReportBranchInfo } from "../report-shell";
import { pdfColors, pdfSpacing } from "../theme";
import type { StockReportItem } from "@/lib/medication-stock-report";

// Medication Purchase List — internal (English-only) stock status of the
// medicines OSEM supplies for one resident: what to buy now vs. what is
// still sufficient. Same grouping as the Family Medicine Reminder, minus the
// family notice.

const green = "#047857";
const greenSoft = "#ecfdf5";

const s = StyleSheet.create({
  bold: { fontFamily: branding.fontFamilyBold },

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

  blockTitle: { fontSize: 10, fontFamily: branding.fontFamilyBold, color: pdfColors.accent, marginBottom: 5, marginTop: 4 },
  sub: { borderWidth: 1, borderRadius: 4, marginBottom: pdfSpacing.section, overflow: "hidden" },
  subHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  subHeadText: { fontSize: 9, fontFamily: branding.fontFamilyBold },
  subHeadHint: { fontSize: 7.5 },

  colHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
    backgroundColor: pdfColors.white,
  },
  colHeadCell: { fontSize: 7, color: pdfColors.ink500, paddingVertical: 4, paddingHorizontal: 6 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: pdfColors.border },
  cell: { fontSize: 8.5, color: pdfColors.ink700, paddingVertical: 5, paddingHorizontal: 6 },
  cellStrong: { fontSize: 8.5, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },
  cellMuted: { fontSize: 7.5, color: pdfColors.ink500, marginTop: 1 },
  empty: { fontSize: 8, color: pdfColors.ink400, paddingVertical: 8, paddingHorizontal: 8 },

  footnote: { fontSize: 7.5, color: pdfColors.ink500, lineHeight: 1.4, marginTop: 2 },
});

const COLS = [
  { label: "Medicine", width: "36%" },
  { label: "Dose & Frequency", width: "24%" },
  { label: "Balance", width: "14%" },
  { label: "Stock Status", width: "26%" },
] as const;

type Tone = { border: string; headBg: string; headFg: string; statusFg: string; strong?: boolean };

const TONES: Record<"restock" | "sufficient" | "neutral", Tone> = {
  restock: { border: pdfColors.critical, headBg: pdfColors.critical, headFg: pdfColors.white, statusFg: pdfColors.critical, strong: true },
  sufficient: { border: pdfColors.border, headBg: greenSoft, headFg: green, statusFg: green },
  neutral: { border: pdfColors.border, headBg: pdfColors.bandStrong, headFg: pdfColors.ink900, statusFg: pdfColors.ink900 },
};

function ItemTable({ title, hint, items, tone, empty }: { title: string; hint?: string; items: StockReportItem[]; tone: Tone; empty: string }) {
  return (
    <View style={[s.sub, { borderColor: tone.border, borderWidth: tone.strong ? 1.5 : 1 }]} wrap={items.length > 8}>
      <View style={[s.subHead, { backgroundColor: tone.headBg }]}>
        <Text style={[s.subHeadText, { color: tone.headFg }]}>{`${title} (${items.length})`}</Text>
        {hint && <Text style={[s.subHeadHint, { color: tone.headFg }]}>{hint}</Text>}
      </View>
      {items.length === 0 ? (
        <Text style={s.empty}>{empty}</Text>
      ) : (
        <>
          <View style={s.colHead}>
            {COLS.map((c) => (
              <Text key={c.label} style={[s.colHeadCell, { width: c.width }]}>
                {c.label.toUpperCase()}
              </Text>
            ))}
          </View>
          {items.map((item, i) => (
            <View key={i} style={[s.row, ...(i === items.length - 1 ? [{ borderBottomWidth: 0 }] : [])]} wrap={false}>
              <View style={[s.cell, { width: COLS[0].width }]}>
                <Text style={s.cellStrong}>{item.medicine}</Text>
              </View>
              <Text style={[s.cell, { width: COLS[1].width }]}>{item.schedule}</Text>
              <Text style={[s.cell, { width: COLS[2].width }]}>{item.balance}</Text>
              <View style={[s.cell, { width: COLS[3].width }]}>
                <Text style={[s.cellStrong, { color: tone.statusFg }]}>{item.status}</Text>
                {item.detail && <Text style={s.cellMuted}>{item.detail}</Text>}
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

export function OsemPurchaseListDocument({
  residentName,
  generatedOn,
  lastStockDate,
  restock,
  sufficient,
  uncountable,
  lowStockDays,
  branch,
  logoSrc,
}: {
  residentName: string;
  generatedOn: string;
  /** DD/MM/YYYY of the newest stock entry behind the countable balances; null = none. */
  lastStockDate: string | null;
  restock: StockReportItem[];
  sufficient: StockReportItem[];
  uncountable: StockReportItem[];
  lowStockDays: number;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  return (
    <Document title={`Medication Purchase List - ${residentName}`}>
      <ReportPage title="Medication Purchase List" branch={branch} logoSrc={logoSrc}>
        <View style={s.identity}>
          {[
            { label: "Resident", value: residentName, width: "70%" },
            { label: "Generated On", value: generatedOn, width: "30%" },
          ].map((c, i) => (
            <View key={c.label} style={[s.identityCell, { width: c.width }, ...(i === 1 ? [{ borderRightWidth: 0 }] : [])]}>
              <Text style={s.identityLabel}>{c.label.toUpperCase()}</Text>
              <Text style={s.identityValue}>{c.value}</Text>
            </View>
          ))}
        </View>

        <Text style={s.blockTitle}>Countable Medicines</Text>
        <ItemTable
          title="Restock Needed"
          hint={`Less than ${lowStockDays} days left`}
          items={restock}
          tone={TONES.restock}
          empty="No countable medicine needs restocking."
        />
        <ItemTable title="Sufficient Supply" items={sufficient} tone={TONES.sufficient} empty="None." />

        <Text style={s.blockTitle}>Uncountable Medicines</Text>
        <ItemTable title="Current Quantity" items={uncountable} tone={TONES.neutral} empty="None." />

        {lastStockDate && (
          <Text style={s.footnote}>
            {`Countable balances are estimated from the prescription since the last stock count on ${lastStockDate}, not a physical count.`}
          </Text>
        )}
      </ReportPage>
    </Document>
  );
}
