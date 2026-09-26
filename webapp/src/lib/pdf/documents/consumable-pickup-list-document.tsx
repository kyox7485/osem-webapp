import { Document, View, Text, StyleSheet } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, branding, type ReportBranchInfo } from "../report-shell";
import { pdfColors, pdfSpacing } from "../theme";
import { LOW_STOCK_THRESHOLD, fmtQty, type RestockGroup, type RestockRow } from "@/lib/consumables";
import { formatDate } from "@/lib/format-date";

// Consumable Pick-up List — internal. OSEM-supplied items to take out of the
// store, grouped by resident, to be charged to that resident. English-only
// (no CJK font), per the other internal reports. The Taken box and the
// signature lines are for pen on paper.

const s = StyleSheet.create({
  table: { borderWidth: 1, borderColor: pdfColors.border, borderRadius: 4, overflow: "hidden" },
  headerRow: { flexDirection: "row", backgroundColor: pdfColors.bandStrong, borderBottomWidth: 1, borderBottomColor: pdfColors.borderStrong },
  headerCell: {
    fontFamily: branding.fontFamilyBold,
    fontSize: 7,
    color: pdfColors.ink500,
    letterSpacing: 0.3,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  groupRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: pdfColors.accentSoft,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  groupName: { fontFamily: branding.fontFamilyBold, fontSize: 9, color: pdfColors.accent },
  groupMeta: { fontSize: 7.5, color: pdfColors.ink500 },
  blockRow: { backgroundColor: pdfColors.band, borderBottomWidth: 1, borderBottomColor: pdfColors.border, paddingVertical: 3, paddingHorizontal: 6 },
  blockLabel: { fontFamily: branding.fontFamilyBold, fontSize: 7, color: pdfColors.ink500, letterSpacing: 0.3 },
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: pdfColors.border },
  cell: { fontSize: 8.5, color: pdfColors.ink700, paddingVertical: 5, paddingHorizontal: 6 },
  cellStrong: { fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },
  cellMuted: { fontSize: 7, color: pdfColors.ink500 },
  qty: { fontSize: 10, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },
  box: { width: 11, height: 11, borderWidth: 1, borderColor: pdfColors.ink500, marginLeft: 6 },
  totalRow: { backgroundColor: pdfColors.bandStrong, paddingVertical: 6, paddingHorizontal: 6 },
  totalText: { fontSize: 9, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },
  note: { fontSize: 7.5, color: pdfColors.ink500, marginTop: 6 },
  signatures: { flexDirection: "row", marginTop: pdfSpacing.section + 10, gap: 24 },
  sigBlock: { flex: 1 },
  sigLine: { borderBottomWidth: 1, borderBottomColor: pdfColors.ink500, height: 22 },
  sigLabel: { fontSize: 7.5, color: pdfColors.ink500, marginTop: 3 },
});

const COLS = [
  { label: "ITEM", width: "40%" },
  { label: "IN STOCK", width: "18%" },
  { label: "LAST COUNTED", width: "16%" },
  { label: "QTY TO TAKE", width: "16%" },
  { label: "TAKEN", width: "10%" },
] as const;

// Items with a MaxStock (top-up) and items without one (listed only when less
// than 1 is left) are printed as separate blocks under each resident.
function blocksOf(rows: RestockRow[]): { label: string; rows: RestockRow[] }[] {
  return [
    { label: "TOP UP TO MAXIMUM STOCK", rows: rows.filter((r) => r.hasMaxStock) },
    { label: `NO MAXIMUM STOCK — LESS THAN ${LOW_STOCK_THRESHOLD} LEFT`, rows: rows.filter((r) => !r.hasMaxStock) },
  ].filter((b) => b.rows.length > 0);
}

export function ConsumablePickupListDocument({
  groups,
  generatedOn,
  preparedBy,
  branch,
  logoSrc,
}: {
  groups: RestockGroup[];
  generatedOn: string;
  preparedBy: string;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  const totalItems = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <Document title="Consumable Pick-up List">
      <ReportPage title="Consumable Pick-up List" branch={branch} logoSrc={logoSrc}>
        <InfoGrid
          columns={4}
          items={[
            { label: "Branch", value: branch.branchName },
            { label: "Generated On", value: generatedOn },
            { label: "Prepared By", value: preparedBy },
            { label: "Residents", value: String(groups.length) },
          ]}
        />

        <View style={s.table}>
          <View style={s.headerRow} fixed>
            {COLS.map((c) => (
              <Text key={c.label} style={[s.headerCell, { width: c.width }]}>{c.label}</Text>
            ))}
          </View>
          {groups.map((g) => (
            <View key={g.residentId}>
              <View style={s.groupRow} wrap={false}>
                <Text style={s.groupName}>{g.residentTextId ? `${g.residentName} (${g.residentTextId})` : g.residentName}</Text>
                <Text style={s.groupMeta}>{`Charge to resident · ${g.rows.length} item${g.rows.length === 1 ? "" : "s"}`}</Text>
              </View>
              {blocksOf(g.rows).map((b) => (
                <View key={b.label}>
                  <View style={s.blockRow} wrap={false}>
                    <Text style={s.blockLabel}>{b.label}</Text>
                  </View>
                  {b.rows.map((r, i) => (
                    <View key={i} style={s.row} wrap={false}>
                      <View style={[s.cell, { width: COLS[0].width }]}>
                        <Text style={s.cellStrong}>{r.item}</Text>
                        {r.addedManually && <Text style={s.cellMuted}>Added manually</Text>}
                      </View>
                      <Text style={[s.cell, { width: COLS[1].width }]}>
                        {r.currentStock === null ? "—" : `${fmtQty(r.currentStock)} ${r.unit}`}
                      </Text>
                      <Text style={[s.cell, { width: COLS[2].width }]}>{r.lastCount ? formatDate(r.lastCount) : "—"}</Text>
                      <Text style={[s.cell, s.qty, { width: COLS[3].width }]}>{`${fmtQty(r.suggestedQty)} ${r.unit}`}</Text>
                      <View style={[s.cell, { width: COLS[4].width }]}>
                        <View style={s.box} />
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ))}
          <View style={s.totalRow} wrap={false}>
            <Text style={s.totalText}>
              {`TOTAL — ${totalItems} item${totalItems === 1 ? "" : "s"} across ${groups.length} resident${groups.length === 1 ? "" : "s"}`}
            </Text>
          </View>
        </View>

        <Text style={s.note}>Tick each item as it is taken from the store. Every item is charged to the resident it is listed under.</Text>

        <View style={s.signatures} wrap={false}>
          {["Taken By (name & signature)", "Date", "Checked By (name & signature)"].map((label) => (
            <View key={label} style={s.sigBlock}>
              <View style={s.sigLine} />
              <Text style={s.sigLabel}>{label}</Text>
            </View>
          ))}
        </View>
      </ReportPage>
    </Document>
  );
}
