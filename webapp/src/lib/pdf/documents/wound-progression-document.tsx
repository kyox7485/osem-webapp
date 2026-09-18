import { Document, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { ReportPage, InfoGrid, type ReportBranchInfo } from "../report-shell";
import { pdfColors } from "../theme";
import type { WoundProgressionFrequency } from "@/lib/wound-progression-data";

export type WoundProgressionPdfPhoto = {
  id: number;
  description: string | null;
  // Pre-fetched server-side (readWoundPhotoFromDrive) -- null means the
  // fetch failed, rendered as a placeholder rather than dropping the whole
  // report.
  imageBuffer: Buffer | null;
};

export type WoundProgressionPdfBucket = {
  label: string;
  photos: WoundProgressionPdfPhoto[];
  // Every description in the bucket, independent of how many photos are
  // actually embedded (photos is capped -- see MAX_PHOTOS_PER_BUCKET in the
  // route -- but a caption written on photo #5 is still worth printing).
  descriptions: string[];
  totalPhotoCount: number;
  dressingPlanText: string | null;
};

export type WoundProgressionPdfSeries = {
  bodyPartLabel: string;
  buckets: WoundProgressionPdfBucket[];
};

const FREQUENCY_LABEL: Record<WoundProgressionFrequency, string> = {
  daily: "Daily Comparison",
  weekly: "Weekly Comparison",
  monthly: "Monthly Comparison",
};

const styles = StyleSheet.create({
  bodyPartHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: pdfColors.ink900,
    marginBottom: 6,
    marginTop: 4,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.borderStrong,
  },
  bucketGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  bucketCard: {
    width: 165,
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: 4,
    padding: 6,
  },
  bucketLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: pdfColors.accent,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  photoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
    marginBottom: 4,
  },
  photo: {
    width: 76,
    height: 62,
    objectFit: "cover",
    borderRadius: 3,
    borderWidth: 1,
    borderColor: pdfColors.border,
  },
  photoPlaceholder: {
    width: 76,
    height: 62,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: pdfColors.border,
    backgroundColor: pdfColors.band,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontSize: 6,
    color: pdfColors.ink400,
  },
  description: {
    fontSize: 7,
    color: pdfColors.ink700,
    marginBottom: 1,
    lineHeight: 1.3,
  },
  planBox: {
    marginTop: 3,
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: 3,
    backgroundColor: pdfColors.band,
    padding: 4,
  },
  planLabel: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    color: pdfColors.ink500,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  planText: {
    fontSize: 7,
    color: pdfColors.ink700,
    lineHeight: 1.3,
  },
});

export function WoundProgressionDocument({
  residentName,
  icNumber,
  frequency,
  start,
  end,
  bodyPartFilter,
  series,
  branch,
  logoSrc,
}: {
  residentName: string;
  icNumber: string | null;
  frequency: WoundProgressionFrequency;
  start: string;
  end: string;
  bodyPartFilter: string | null;
  series: WoundProgressionPdfSeries[];
  branch: ReportBranchInfo;
  logoSrc: string;
}) {
  return (
    <Document title={`Wound Progression Report - ${residentName}`}>
      <ReportPage title="Wound Progression Report" subtitle={`${FREQUENCY_LABEL[frequency]} • ${start} to ${end}`} branch={branch} logoSrc={logoSrc}>
        <InfoGrid
          columns={4}
          items={[
            { label: "Resident's Name", value: residentName },
            { label: "IC Number", value: icNumber ?? "--" },
            { label: "Comparison Basis", value: FREQUENCY_LABEL[frequency] },
            { label: "Body Part", value: bodyPartFilter ?? "All body parts" },
          ]}
        />

        {series.length === 0 && (
          <Text style={{ fontSize: 9.5, color: pdfColors.ink400, fontStyle: "italic", marginTop: 8 }}>
            No wound photos recorded for this resident in the selected period.
          </Text>
        )}

        {series.map((s) => (
          <View key={s.bodyPartLabel} wrap={false}>
            <Text style={styles.bodyPartHeading}>{s.bodyPartLabel}</Text>
            <View style={styles.bucketGrid}>
              {s.buckets.map((bucket, i) => (
                <View key={i} style={styles.bucketCard} wrap={false}>
                  <Text style={styles.bucketLabel}>{bucket.label}</Text>
                  <View style={styles.photoRow}>
                    {bucket.photos.map((photo) =>
                      photo.imageBuffer ? (
                        <Image key={photo.id} src={photo.imageBuffer} style={styles.photo} />
                      ) : (
                        <View key={photo.id} style={styles.photoPlaceholder}>
                          <Text style={styles.placeholderText}>No image</Text>
                        </View>
                      )
                    )}
                  </View>
                  {bucket.totalPhotoCount > bucket.photos.length && (
                    <Text style={{ fontSize: 6, color: pdfColors.ink400, marginBottom: 2 }}>
                      +{bucket.totalPhotoCount - bucket.photos.length} more photo(s)
                    </Text>
                  )}
                  {bucket.descriptions.map((desc, i) => (
                    <Text key={i} style={styles.description}>
                      {desc}
                    </Text>
                  ))}
                  <View style={styles.planBox}>
                    <Text style={styles.planLabel}>Dressing Plan</Text>
                    <Text style={styles.planText}>{bucket.dressingPlanText || "No active plan on record"}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ReportPage>
    </Document>
  );
}
