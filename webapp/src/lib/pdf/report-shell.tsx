import { Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import { pdfColors, pdfSpacing } from "./theme";

// Deliberately no Font.register(): these reports are rendered on-demand,
// server-side, per request (see the /api/reports/* routes) -- pulling a
// webfont over the network on every single generation would add latency and
// a hard failure mode if that fetch ever times out. @react-pdf/renderer's
// built-in Helvetica family needs no network and is always available.
const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";

// Branch addresses are all-caps and can run long ("TAMAN LEMBAH PERMAI") --
// react-pdf's default hyphenation breaks mid-word to fit the column, which
// reads poorly on a formal document. Wrapping on word boundaries only looks
// far cleaner even if a line runs a little short.
Font.registerHyphenationCallback((word) => [word]);

export const branding = {
  fontFamily: FONT,
  fontFamilyBold: FONT_BOLD,
};

export type ReportBranchInfo = {
  branchName: string;
  branchLocale: string;
  branchAddress: string | null;
  branchContact: string | null;
};

// A4 page width in points (@react-pdf/renderer's "A4" size constant), used
// below to give the header's title column a *definite* width instead of
// leaving it to flexGrow/flexShrink -- react-pdf/Yoga only reliably wraps
// Text within an ancestor that has a definite width (this is why the
// branch address on the right, under headerRight's fixed width:230,
// already wraps correctly; the title column previously had no such anchor
// and would overflow into the branch column for longer report titles).
const PAGE_WIDTH = 595.28;
const HEADER_RIGHT_WIDTH = 230;
// headerBand's own content width = page width minus its own horizontal
// padding (pdfSpacing.page on both sides); whatever's left after the fixed
// right column belongs to the title column.
const HEADER_LEFT_WIDTH = PAGE_WIDTH - pdfSpacing.page * 2 - HEADER_RIGHT_WIDTH;

const styles = StyleSheet.create({
  page: {
    // paddingTop reserves space for the header block so the flowing body
    // content starts below it on every page. Sized for the worst case: a
    // long report title wrapping to 2 lines within its column (~53pt) is
    // taller than the branch block's 4-line worst case (name + 2-line
    // address + tel, ~49pt), so: accentBar(5) + headerBand(paddingTop 16 +
    // ~53 + paddingBottom 14 = 83) = 88, plus ~16pt breathing room = 104.
    // The header itself is position:absolute (see headerFixed below), so
    // it is NOT pushed down by this padding -- it stays pinned to the true
    // top edge of each page, same technique already used for the footer's
    // position:absolute+bottom:0.
    paddingTop: 104,
    paddingBottom: 56,
    paddingHorizontal: 0,
    fontFamily: FONT,
    fontSize: 9.5,
    color: pdfColors.ink700,
  },
  headerFixed: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  accentBar: {
    height: 5,
    backgroundColor: pdfColors.accent,
  },
  headerBand: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    backgroundColor: pdfColors.band,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.borderStrong,
    paddingHorizontal: pdfSpacing.page,
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    // Definite width (not flexGrow) -- see HEADER_LEFT_WIDTH comment above.
    width: HEADER_LEFT_WIDTH,
    paddingRight: 14,
  },
  logo: {
    width: 46,
    height: 28,
    objectFit: "contain",
  },
  titleBlock: {
    flexDirection: "column",
    flexShrink: 1,
    // Hard ceiling so the title always wraps within its own column instead
    // of overflowing into the branch info on the right (logo 46 + gap 10 +
    // paddingRight 14 subtracted from headerLeft's width).
    maxWidth: HEADER_LEFT_WIDTH - 46 - 10 - 14,
  },
  reportTitle: {
    fontFamily: FONT_BOLD,
    fontSize: 17,
    color: pdfColors.ink900,
    letterSpacing: 0.2,
  },
  reportSubtitle: {
    fontSize: 8,
    color: pdfColors.ink500,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: "column",
    alignItems: "flex-end",
    width: HEADER_RIGHT_WIDTH,
    flexShrink: 0,
  },
  branchName: {
    fontFamily: FONT_BOLD,
    fontSize: 10,
    color: pdfColors.ink900,
    textAlign: "right",
  },
  branchLine: {
    fontSize: 8,
    color: pdfColors.ink500,
    textAlign: "right",
    marginTop: 2,
    lineHeight: 1.35,
  },
  body: {
    paddingHorizontal: pdfSpacing.page,
    // paddingTop removed -- page.paddingTop already reserves the header gap
    // on every page, so this was only adding extra space on page 1.
    paddingTop: 0,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: pdfSpacing.page,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: pdfColors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerText: {
    fontSize: 7.5,
    color: pdfColors.ink400,
  },
});

export function ReportPage({
  title,
  subtitle,
  branch,
  logoSrc,
  children,
}: {
  title: string;
  subtitle: string;
  branch: ReportBranchInfo;
  logoSrc: string;
  children: React.ReactNode;
}) {
  const generatedOn = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Page size="A4" style={styles.page} wrap>
      <View style={styles.headerFixed} fixed>
        <View style={styles.accentBar} />
        <View style={styles.headerBand}>
          <View style={styles.headerLeft}>
            <Image src={logoSrc} style={styles.logo} />
            <View style={styles.titleBlock}>
              <Text style={styles.reportTitle}>{title}</Text>
              <Text style={styles.reportSubtitle}>{subtitle}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.branchName}>{branch.branchName}</Text>
            {branch.branchAddress && <Text style={styles.branchLine}>{branch.branchAddress}</Text>}
            {branch.branchContact && <Text style={styles.branchLine}>Tel: {branch.branchContact}</Text>}
          </View>
        </View>
      </View>

      <View style={styles.body}>{children}</View>

      <View style={styles.footer} fixed>
        <Text style={styles.footerText}>OSEM Nursing • Rehabilitation • Physiotherapy — Confidential Medical Record</Text>
        <Text style={styles.footerText}>Generated {generatedOn}</Text>
        <Text
          style={styles.footerText}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
    </Page>
  );
}

const infoStyles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: 4,
    marginBottom: pdfSpacing.section,
    overflow: "hidden",
  },
  cell: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderRightColor: pdfColors.border,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
  },
  label: {
    fontSize: 7,
    color: pdfColors.ink500,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  value: {
    fontSize: 9.5,
    fontFamily: FONT_BOLD,
    color: pdfColors.ink900,
  },
});

// A compact identity strip (Resident, IC, Date, Reviewed by, etc.) laid out
// as a bordered grid -- the modern equivalent of the legacy Access reports'
// stacked Date/RID/Name/IC boxes, but scannable at a glance instead of eating
// a third of the page.
export function InfoGrid({ items, columns = 4 }: { items: { label: string; value: string }[]; columns?: number }) {
  const widthPct = 100 / columns;
  return (
    <View style={infoStyles.grid}>
      {items.map((item, i) => {
        const isLastInRow = (i + 1) % columns === 0 || i === items.length - 1;
        return (
          <View
            key={i}
            style={[
              infoStyles.cell,
              { width: `${widthPct}%` },
              isLastInRow ? { borderRightWidth: 0 } : {},
            ]}
          >
            <Text style={infoStyles.label}>{item.label}</Text>
            <Text style={infoStyles.value}>{item.value || "--"}</Text>
          </View>
        );
      })}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrap: {
    marginBottom: pdfSpacing.section,
  },
  label: {
    fontSize: 8,
    fontFamily: FONT_BOLD,
    color: pdfColors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  box: {
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: pdfColors.white,
  },
  text: {
    fontSize: 9.5,
    color: pdfColors.ink700,
    lineHeight: 1.5,
  },
  empty: {
    fontSize: 9.5,
    color: pdfColors.ink400,
    fontStyle: "italic",
  },
});

// One labelled free-text block (Progress Note, Physical Examination, Medical
// Plan, ...). Renders a placeholder dash rather than collapsing to nothing,
// so a report with an unfilled field still reads as complete, not broken.
//
// allowPageBreak lets a section that can run very long (e.g. an extensive
// past medical history) split across pages instead of staying an atomic
// block -- the default (false) keeps shorter sections from being awkwardly
// orphaned at a page boundary.
export function ReportSection({
  label,
  value,
  minLines = 3,
  allowPageBreak = false,
}: {
  label: string;
  value: string | null | undefined;
  minLines?: number;
  allowPageBreak?: boolean;
}) {
  return (
    <View style={sectionStyles.wrap} wrap={allowPageBreak}>
      <Text style={sectionStyles.label}>{label}</Text>
      <View style={[sectionStyles.box, { minHeight: minLines * 12 + 16 }]}>
        {value ? <Text style={sectionStyles.text}>{value}</Text> : <Text style={sectionStyles.empty}>Not recorded</Text>}
      </View>
    </View>
  );
}

const tableStyles = StyleSheet.create({
  table: {
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: 4,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    backgroundColor: pdfColors.bandStrong,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.borderStrong,
  },
  headerCell: {
    fontFamily: FONT_BOLD,
    fontSize: 7.5,
    color: pdfColors.ink700,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
  },
  rowAlt: {
    backgroundColor: "#fafbfc",
  },
  cell: {
    fontSize: 8.5,
    color: pdfColors.ink700,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
});

export type ReportTableColumn<T> = {
  label: string;
  width: string; // e.g. "18%"
  render: (row: T) => string;
  // Cell text color override, e.g. to flag a critical/out-of-range reading.
  color?: (row: T) => string | undefined;
};

export function ReportTable<T>({ columns, rows, emptyLabel }: { columns: ReportTableColumn<T>[]; rows: T[]; emptyLabel: string }) {
  return (
    <View style={tableStyles.table}>
      <View style={tableStyles.headerRow} fixed>
        {columns.map((col, i) => (
          <Text key={i} style={[tableStyles.headerCell, { width: col.width }]}>
            {col.label}
          </Text>
        ))}
      </View>
      {rows.length === 0 ? (
        <View style={tableStyles.row}>
          <Text style={[tableStyles.cell, { width: "100%", textAlign: "center", color: pdfColors.ink400, paddingVertical: 14 }]}>
            {emptyLabel}
          </Text>
        </View>
      ) : (
        rows.map((row, i) => (
          <View key={i} style={[tableStyles.row, ...(i % 2 === 1 ? [tableStyles.rowAlt] : [])]} wrap={false}>
            {columns.map((col, j) => (
              <Text key={j} style={[tableStyles.cell, { width: col.width, color: col.color?.(row) ?? tableStyles.cell.color }]}>
                {col.render(row)}
              </Text>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

// Re-exported so document files only need to import from this one module.
export { Font };
