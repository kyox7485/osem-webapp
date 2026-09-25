import { Document, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/stylesheet";
import { ReportPage, branding, type ReportBranchInfo } from "../report-shell";
import { pdfColors, pdfSpacing } from "../theme";
import { CJK_FONT } from "../cjk-font";

// Family Medication Reminder — bilingual (English / 中文) restock notice for
// family-supplied medicines. Chinese strings must be in Text nodes styled
// with CJK_FONT (Helvetica has no Chinese glyphs); the route calls
// registerCjkFont() before rendering.

export type FamilyReminderItem = {
  medicine: string;
  schedule: string;
  balance: string;
  status: string;
  statusZh: string;
  /** Second line under the status, e.g. "Last dose Tue 13/10/2026". */
  detail: string | null;
};

const green = "#047857";
const greenSoft = "#ecfdf5";

const s = StyleSheet.create({
  zh: { fontFamily: CJK_FONT },
  zhBold: { fontFamily: CJK_FONT, fontWeight: 700 },
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

  notice: {
    borderWidth: 1,
    borderColor: pdfColors.borderStrong,
    borderRadius: 4,
    backgroundColor: pdfColors.band,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: pdfSpacing.section + 4,
  },
  noticeTitle: { fontSize: 8.5, color: pdfColors.ink900, marginBottom: 3 },
  noticeLine: { fontSize: 8, color: pdfColors.ink700, lineHeight: 1.45 },
  noticeGap: { height: 6 },
  noticeContact: { fontSize: 8, color: pdfColors.ink900, lineHeight: 1.45 },

  blockTitle: {
    fontSize: 10,
    color: pdfColors.accent,
    marginBottom: 5,
    marginTop: 4,
  },
  sub: { borderWidth: 1, borderRadius: 4, marginBottom: pdfSpacing.section, overflow: "hidden" },
  subHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  subHeadText: { fontSize: 9 },
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
  { en: "Medicine", zh: "药物", width: "36%" },
  { en: "Dose & Frequency", zh: "剂量与频率", width: "24%" },
  { en: "Balance", zh: "库存", width: "14%" },
  { en: "Stock Status", zh: "库存状态", width: "26%" },
] as const;

type Tone = { border: string; headBg: string; headFg: string; statusFg: string };

const TONES: Record<"restock" | "sufficient" | "neutral", Tone> = {
  restock: { border: pdfColors.critical, headBg: pdfColors.critical, headFg: pdfColors.white, statusFg: pdfColors.critical },
  sufficient: { border: pdfColors.border, headBg: greenSoft, headFg: green, statusFg: green },
  neutral: { border: pdfColors.border, headBg: pdfColors.bandStrong, headFg: pdfColors.ink900, statusFg: pdfColors.ink900 },
};

function Bi({ en, zh, style, bold = true }: { en: string; zh: string; style: Style | Style[]; bold?: boolean }) {
  return (
    <Text style={style}>
      <Text style={bold ? s.bold : {}}>{en}</Text>
      <Text style={bold ? s.zhBold : s.zh}>{`  ${zh}`}</Text>
    </Text>
  );
}

function ItemTable({
  titleEn,
  titleZh,
  hintEn,
  hintZh,
  items,
  tone,
  emptyEn,
  emptyZh,
}: {
  titleEn: string;
  titleZh: string;
  hintEn?: string;
  hintZh?: string;
  items: FamilyReminderItem[];
  tone: Tone;
  emptyEn: string;
  emptyZh: string;
}) {
  return (
    <View style={[s.sub, { borderColor: tone.border, borderWidth: tone === TONES.restock ? 1.5 : 1 }]} wrap={items.length > 8}>
      <View style={[s.subHead, { backgroundColor: tone.headBg }]}>
        <Bi en={`${titleEn} (${items.length})`} zh={titleZh} style={[s.subHeadText, { color: tone.headFg }]} />
        {hintEn && hintZh && (
          <Text style={[s.subHeadHint, { color: tone.headFg }]}>
            <Text>{hintEn}</Text>
            <Text style={s.zh}>{`  ${hintZh}`}</Text>
          </Text>
        )}
      </View>
      {items.length === 0 ? (
        <Text style={s.empty}>
          <Text>{emptyEn}</Text>
          <Text style={s.zh}>{`  ${emptyZh}`}</Text>
        </Text>
      ) : (
        <>
          <View style={s.colHead}>
            {COLS.map((c) => (
              <Text key={c.en} style={[s.colHeadCell, { width: c.width }]}>
                <Text>{c.en.toUpperCase()}</Text>
                <Text style={s.zh}>{` ${c.zh}`}</Text>
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
                <Text style={[s.cellStrong, { color: tone.statusFg }]}>
                  <Text>{item.status}</Text>
                  <Text style={s.zhBold}>{`  ${item.statusZh}`}</Text>
                </Text>
                {item.detail && <Text style={s.cellMuted}>{item.detail}</Text>}
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

export function FamilyReminderDocument({
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
  restock: FamilyReminderItem[];
  sufficient: FamilyReminderItem[];
  uncountable: FamilyReminderItem[];
  lowStockDays: number;
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  return (
    <Document title={`Family Medication Reminder - ${residentName}`}>
      <ReportPage title="Family Medication Reminder" branch={branch} logoSrc={logoSrc}>
        <View style={s.identity}>
          {[
            { en: "Resident", zh: "住客", value: residentName, width: "70%" },
            { en: "Generated On", zh: "日期", value: generatedOn, width: "30%" },
          ].map((c, i) => (
            <View key={c.en} style={[s.identityCell, { width: c.width }, ...(i === 1 ? [{ borderRightWidth: 0 }] : [])]}>
              <Text style={s.identityLabel}>
                <Text>{c.en.toUpperCase()}</Text>
                <Text style={s.zh}>{`  ${c.zh}`}</Text>
              </Text>
              <Text style={s.identityValue}>{c.value}</Text>
            </View>
          ))}
        </View>

        <View style={s.notice} wrap={false}>
          <Text style={[s.noticeTitle, s.bold]}>Notice:</Text>
          <Text style={s.noticeLine}>
            1. For medications that can be counted (e.g. tablets, capsules), we will notify you when the remaining supply is estimated to be less than {lowStockDays} days.
          </Text>
          <Text style={s.noticeLine}>
            2. For medications that cannot be accurately counted (e.g. creams, liquids, eye drops, inhalers), we will provide the current available quantity for your reference.
          </Text>
          <Text style={s.noticeLine}>3. If you already have a scheduled prescription refill appointment, you may disregard this reminder.</Text>
          <Text style={s.noticeLine}>4. Please arrange your medication refill promptly to ensure uninterrupted treatment. Thank you for your cooperation.</Text>

          <View style={s.noticeGap} />
          <Text style={[s.noticeTitle, s.zhBold]}>提醒：</Text>
          <Text style={[s.noticeLine, s.zh]}>{`1. 对于可计算数量的药物（如药片、胶囊等），当预计剩余药量少于${lowStockDays}天时，我们将发出补药提醒。`}</Text>
          <Text style={[s.noticeLine, s.zh]}>2. 对于无法准确计算数量的药物（如药膏、药水、眼药水、吸入器等），我们将提供目前剩余数量供您参考。</Text>
          <Text style={[s.noticeLine, s.zh]}>3. 若您已安排好处方复诊或补药日期，请忽略此提醒。</Text>
          <Text style={[s.noticeLine, s.zh]}>4. 请及时安排补药，以确保治疗不中断。感谢您的配合。</Text>

          <View style={s.noticeGap} />
          <Text style={[s.noticeContact, s.bold]}>
            If you believe there is any discrepancy or error in our medication balance update, please feel free to contact us. We appreciate your feedback and will verify it promptly.
          </Text>
          <Text style={[s.noticeContact, s.zhBold]}>如您认为我们的药物库存更新有任何错误或疑问，欢迎随时与我们联系，我们将尽快为您核实。感谢您的反馈。</Text>
        </View>

        <Bi en="Countable Medicines" zh="可计算数量的药物" style={s.blockTitle} />
        <ItemTable
          titleEn="Restock Needed"
          titleZh="需要补药"
          hintEn={`Less than ${lowStockDays} days left`}
          hintZh={`剩余少于${lowStockDays}天`}
          items={restock}
          tone={TONES.restock}
          emptyEn="No countable medicine needs restocking."
          emptyZh="目前没有需要补充的药物。"
        />
        <ItemTable
          titleEn="Sufficient Supply"
          titleZh="药量充足"
          items={sufficient}
          tone={TONES.sufficient}
          emptyEn="None."
          emptyZh="无。"
        />

        <Bi en="Uncountable Medicines" zh="无法准确计算数量的药物" style={s.blockTitle} />
        <ItemTable
          titleEn="Current Quantity"
          titleZh="目前剩余数量"
          hintEn="For your reference"
          hintZh="供您参考"
          items={uncountable}
          tone={TONES.neutral}
          emptyEn="None."
          emptyZh="无。"
        />

        {lastStockDate && (
          <>
            <Text style={s.footnote}>
              {`Countable balances are estimated from the prescription since the last stock count on ${lastStockDate}, not a physical count.`}
            </Text>
            <Text style={[s.footnote, s.zh]}>{`可计算药物的库存是根据${lastStockDate}最后一次点算后的处方用量推算，并非实际点算数量。`}</Text>
          </>
        )}
      </ReportPage>
    </Document>
  );
}
