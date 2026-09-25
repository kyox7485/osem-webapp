import { Document, View, Text, StyleSheet } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, branding, type ReportBranchInfo } from "../report-shell";
import { pdfColors } from "../theme";
import type { PurchaseListGroup } from "@/lib/medication-purchase";

// Medication Purchase List — internal, branch-wide order sheet: every OSEM
// medicine that needs restocking across the branch, grouped by resident, one
// line per medicine, with a branch-wide total. English-only (no CJK font) so
// the PDF stays small, per the other internal report precedent.

const s = StyleSheet.create({
  table: { borderWidth: 1, borderColor: pdfColors.border, borderRadius: 4, overflow: "hidden" },
  headerRow: {
    flexDirection: "row",
    backgroundColor: pdfColors.bandStrong,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.borderStrong,
  },
  headerCell: {
    fontFamily: branding.fontFamilyBold,
    fontSize: 7,
    color: pdfColors.ink500,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },

  // One of these per resident, so a long branch sheet stays scannable.
  groupRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: pdfColors.accentSoft,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  groupName: { fontFamily: branding.fontFamilyBold, fontSize: 9, color: pdfColors.accent },
  groupMeta: { fontSize: 7.5, color: pdfColors.ink500 },

  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: pdfColors.border },
  rowAlt: { backgroundColor: "#fafbfc" },
  cell: { fontSize: 8.5, color: pdfColors.ink700, paddingVertical: 5, paddingHorizontal: 6 },
  cellStrong: { fontSize: 8.5, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },
  cellMuted: { fontSize: 7.5, color: pdfColors.ink500, marginTop: 1 },
  cellQty: { fontSize: 9.5, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: pdfColors.bandStrong,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  totalText: { fontSize: 9, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },

  empty: { fontSize: 8.5, color: pdfColors.ink400, paddingVertical: 10, paddingHorizontal: 6 },
});

const COLS = [
  { label: "Medicine", width: "32%" },
  { label: "Dosing & Frequency", width: "24%" },
  { label: "Balance", width: "13%" },
  { label: "Days Left", width: "15%" },
  { label: "Qty to Order", width: "16%" },
] as const;

function GroupHeading({ group }: { group: PurchaseListGroup }) {
  return (
    <View style={s.groupRow} wrap={false}>
      <Text style={s.groupName}>{group.residentTextId ? `${group.residentName} (${group.residentTextId})` : group.residentName}</Text>
      <Text style={s.groupMeta}>{`${group.rows.length} item${group.rows.length === 1 ? "" : "s"}`}</Text>
    </View>
  );
}

export function PurchaseListDocument({
  groups,
  totalItems,
  residentCount,
  lowStockDays,
  generatedOn,
  preparedBy,
  branch,
  logoSrc,
}: {
  groups: PurchaseListGroup[];
  totalItems: number;
  residentCount: number;
  lowStockDays: number;
  generatedOn: string;
  /** Staff member who prepared/verified the list. */
  preparedBy: string | null;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  return (
    <Document title="Medication Purchase List">
      <ReportPage title="Medication Purchase List" branch={branch} logoSrc={logoSrc}>
        <InfoGrid
          columns={4}
          items={[
            { label: "Branch", value: branch.branchName },
            { label: "Generated On", value: generatedOn },
            { label: "Prepared By", value: preparedBy ?? "--" },
            { label: "Residents", value: String(residentCount) },
          ]}
        />

        <View style={s.table}>
          <View style={s.headerRow} fixed>
            {COLS.map((c) => (
              <Text key={c.label} style={[s.headerCell, { width: c.width }]}>
                {c.label.toUpperCase()}
              </Text>
            ))}
          </View>

          {groups.length === 0 ? (
            <Text style={s.empty}>No medicine needs restocking at this branch.</Text>
          ) : (
            groups.map((group) => (
              <View key={group.residentId}>
                <GroupHeading group={group} />
                {group.rows.map((row, i) => (
                  <View key={row.key} style={[s.row, ...(i % 2 === 1 ? [s.rowAlt] : [])]} wrap={false}>
                    <View style={[s.cell, { width: COLS[0].width }]}>
                      <Text style={s.cellStrong}>{row.medicine}</Text>
                      {row.addedManually && <Text style={s.cellMuted}>Added manually</Text>}
                    </View>
                    <View style={[s.cell, { width: COLS[1].width }]}>
                      <Text>{row.schedule || "—"}</Text>
                      <Text style={s.cellMuted}>{row.unit}</Text>
                    </View>
                    <Text style={[s.cell, { width: COLS[2].width }]}>
                      {row.balance === null ? "—" : `${row.balance} ${row.unit}`}
                    </Text>
                    <View style={[s.cell, { width: COLS[3].width }]}>
                      {row.countable ? (
                        <Text
                          style={[
                            s.cellStrong,
                            {
                              color:
                                (row.daysRemaining ?? 0) < lowStockDays ? pdfColors.critical : pdfColors.ink900,
                            },
                          ]}
                        >
                          {row.daysRemaining === 0 ? "Out of stock" : `${row.daysRemaining} days`}
                        </Text>
                      ) : (
                        <Text style={s.cellMuted}>Not forecast</Text>
                      )}
                      <Text style={s.cellMuted}>{row.reason}</Text>
                    </View>
                    <Text style={[s.cell, s.cellQty, { width: COLS[4].width }]}>
                      {`${row.suggestedQty} ${row.unit}`}
                    </Text>
                  </View>
                ))}
              </View>
            ))
          )}

          {groups.length > 0 && (
            <View style={s.totalRow} wrap={false}>
              <Text style={s.totalText}>
                {`TOTAL — ${totalItems} item${totalItems === 1 ? "" : "s"} across ${residentCount} resident${residentCount === 1 ? "" : "s"}`}
              </Text>
            </View>
          )}
        </View>
      </ReportPage>
    </Document>
  );
}
