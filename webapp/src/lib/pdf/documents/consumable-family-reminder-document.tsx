import { Document, View, Text, StyleSheet } from "@react-pdf/renderer";
import { ReportPage, branding, type ReportBranchInfo } from "../report-shell";
import { pdfColors, pdfSpacing } from "../theme";
import { CJK_FONT } from "../cjk-font";
import { fmtQty, type RestockRow } from "@/lib/consumables";
import { formatDate } from "@/lib/format-date";

// Family Consumable Restock Reminder — bilingual (English / 中文), one
// resident, family-supplied items only. Two blocks: items with a MaxStock
// ("Please Bring" a top-up quantity, red) and items without one (milk powder,
// lotion, Other — a non-urgent balance update, grey, no quantity: usage
// varies too much to forecast, so the family decides). Chinese strings must be in Text
// nodes styled with CJK_FONT; the route calls registerCjkFont() first.

const s = StyleSheet.create({
  zh: { fontFamily: CJK_FONT },
  zhBold: { fontFamily: CJK_FONT, fontWeight: 700 },
  bold: { fontFamily: branding.fontFamilyBold },

  identity: { flexDirection: "row", borderWidth: 1, borderColor: pdfColors.border, borderRadius: 4, marginBottom: pdfSpacing.section },
  identityCell: { paddingVertical: 7, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: pdfColors.border },
  identityLabel: { fontSize: 7, color: pdfColors.ink500, marginBottom: 2 },
  identityValue: { fontSize: 10, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },

  notice: {
    borderWidth: 1,
    borderColor: pdfColors.borderStrong,
    borderRadius: 4,
    backgroundColor: pdfColors.band,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: pdfSpacing.section + 4,
  },
  noticeLine: { fontSize: 8, color: pdfColors.ink700, lineHeight: 1.45 },
  noticeGap: { height: 5 },

  blockTitle: { fontSize: 9, color: pdfColors.ink900, marginBottom: 4 },
  blockGap: { height: pdfSpacing.section },
  table: { borderWidth: 1.5, borderColor: pdfColors.critical, borderRadius: 4, overflow: "hidden" },
  head: { flexDirection: "row", backgroundColor: pdfColors.critical },
  headCell: { fontSize: 7.5, color: pdfColors.white, paddingVertical: 5, paddingHorizontal: 6 },
  row: { flexDirection: "row", borderTopWidth: 1, borderTopColor: pdfColors.border },
  cell: { fontSize: 9, color: pdfColors.ink700, paddingVertical: 6, paddingHorizontal: 6 },
  cellStrong: { fontSize: 9, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },
  qty: { fontSize: 10, fontFamily: branding.fontFamilyBold, color: pdfColors.critical },

  infoTable: { borderWidth: 1, borderColor: pdfColors.borderStrong, borderRadius: 4, overflow: "hidden" },
  infoHead: { flexDirection: "row", backgroundColor: pdfColors.bandStrong },
  infoHeadCell: { fontSize: 7.5, color: pdfColors.ink700, paddingVertical: 5, paddingHorizontal: 6 },
  infoNote: { fontSize: 8, color: pdfColors.ink500, lineHeight: 1.45, marginBottom: 5 },
  balance: { fontSize: 10, fontFamily: branding.fontFamilyBold, color: pdfColors.ink900 },
});

const COLS = [
  { en: "Item", zh: "物品", width: "38%" },
  { en: "In Stock", zh: "现有数量", width: "20%" },
  { en: "Last Counted", zh: "点算日期", width: "18%" },
  { en: "Please Bring", zh: "请补充", width: "24%" },
] as const;

const INFO_COLS = [
  { en: "Item", zh: "物品", width: "44%" },
  { en: "Current Balance", zh: "现有存量", width: "30%" },
  { en: "Last Counted", zh: "点算日期", width: "26%" },
] as const;

function BlockTitle({ en, zh }: { en: string; zh: string }) {
  return (
    <Text style={s.blockTitle} minPresenceAhead={40}>
      <Text style={s.bold}>{en}</Text>
      <Text style={s.zhBold}>{`  ${zh}`}</Text>
    </Text>
  );
}

/** Non-urgent block: balance only, no quantity requested. */
function BalanceTable({ rows }: { rows: RestockRow[] }) {
  return (
    <View style={s.infoTable}>
      <View style={s.infoHead} fixed>
        {INFO_COLS.map((c) => (
          <Text key={c.en} style={[s.infoHeadCell, { width: c.width }]}>
            <Text style={s.bold}>{c.en.toUpperCase()}</Text>
            <Text style={s.zhBold}>{` ${c.zh}`}</Text>
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.row} wrap={false}>
          <Text style={[s.cell, s.cellStrong, { width: INFO_COLS[0].width }]}>{r.item}</Text>
          <Text style={[s.cell, s.balance, { width: INFO_COLS[1].width }]}>
            {r.currentStock === null ? "—" : `${fmtQty(r.currentStock)} ${r.unit}`}
          </Text>
          <Text style={[s.cell, { width: INFO_COLS[2].width }]}>{r.lastCount ? formatDate(r.lastCount) : "—"}</Text>
        </View>
      ))}
    </View>
  );
}

function RowsTable({ rows }: { rows: RestockRow[] }) {
  return (
    <View style={s.table}>
      <View style={s.head} fixed>
        {COLS.map((c) => (
          <Text key={c.en} style={[s.headCell, { width: c.width }]}>
            <Text style={s.bold}>{c.en.toUpperCase()}</Text>
            <Text style={s.zhBold}>{` ${c.zh}`}</Text>
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.row} wrap={false}>
          <Text style={[s.cell, s.cellStrong, { width: COLS[0].width }]}>{r.item}</Text>
          <Text style={[s.cell, { width: COLS[1].width }]}>
            {r.currentStock === null ? "—" : `${fmtQty(r.currentStock)} ${r.unit}`}
          </Text>
          <Text style={[s.cell, { width: COLS[2].width }]}>{r.lastCount ? formatDate(r.lastCount) : "—"}</Text>
          <Text style={[s.cell, s.qty, { width: COLS[3].width }]}>{`${fmtQty(r.suggestedQty)} ${r.unit}`}</Text>
        </View>
      ))}
    </View>
  );
}

export function ConsumableFamilyReminderDocument({
  residentName,
  rows,
  generatedOn,
  preparedBy,
  branch,
  logoSrc,
}: {
  residentName: string;
  rows: RestockRow[];
  generatedOn: string;
  preparedBy: string;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  const topUp = rows.filter((r) => r.hasMaxStock);
  const balance = rows.filter((r) => !r.hasMaxStock);
  // Balance-only reminders are an update, not a restock request.
  const title = topUp.length > 0 ? "Consumable Restock Reminder" : "Consumable Stock Update";
  return (
    <Document title={`${title} - ${residentName}`}>
      <ReportPage title={title} branch={branch} logoSrc={logoSrc}>
        <View style={s.identity}>
          {[
            { en: "Resident", zh: "住客", value: residentName, width: "50%" },
            { en: "Generated On", zh: "日期", value: generatedOn, width: "22%" },
            { en: "Prepared By", zh: "负责人", value: preparedBy, width: "28%" },
          ].map((c, i, all) => (
            <View key={c.en} style={[s.identityCell, { width: c.width }, ...(i === all.length - 1 ? [{ borderRightWidth: 0 }] : [])]}>
              <Text style={s.identityLabel}>
                <Text>{c.en.toUpperCase()}</Text>
                <Text style={s.zh}>{`  ${c.zh}`}</Text>
              </Text>
              <Text style={s.identityValue}>{c.value}</Text>
            </View>
          ))}
        </View>

        {topUp.length > 0 && (
          <>
            <View style={s.notice} wrap={false}>
              <Text style={s.noticeLine}>
                The items below, supplied by the family, are running low based on our latest weekly count. Kindly bring the suggested quantity on your next visit. If you have already arranged a restock, please disregard this reminder. Thank you for your cooperation.
              </Text>
              <View style={s.noticeGap} />
              <Text style={[s.noticeLine, s.zh]}>
                根据我们最近一次的每周点算，以下由家属提供的物品存量偏低。请于下次探访时带来建议数量。若您已安排补充，请忽略此提醒。感谢您的配合。
              </Text>
            </View>
            <BlockTitle en="Top up to maximum stock" zh="补充至最高存量" />
            <RowsTable rows={topUp} />
          </>
        )}

        {balance.length > 0 && (
          <View>
            {topUp.length > 0 && <View style={s.blockGap} />}
            <BlockTitle en="Stock Balance Update" zh="存量更新" />
            <View wrap={false}>
              <Text style={s.infoNote}>
                For your reference, these items are currently in stock. As usage may vary from resident to resident, we have not suggested a top-up quantity. Please feel free to replenish them when you feel it is needed.
              </Text>
              <Text style={[s.infoNote, s.zh]}>
                仅供参考，目前这些物品仍有存量。由于每位住客的使用量不同，我们没有建议具体的补充数量。如有需要，您可根据目前的存量自行安排补充。
              </Text>
            </View>
            <BalanceTable rows={balance} />
          </View>
        )}
      </ReportPage>
    </Document>
  );
}
