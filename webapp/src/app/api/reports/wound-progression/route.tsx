import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getWoundProgressionData, type WoundProgressionFrequency } from "@/lib/wound-progression-data";
import { readWoundPhotoFromDrive } from "@/lib/google-drive";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import {
  WoundProgressionDocument,
  type WoundProgressionPdfSeries,
  type WoundProgressionPdfBucket,
  type WoundProgressionPdfPhoto,
} from "@/lib/pdf/documents/wound-progression-document";

export const runtime = "nodejs";

// Same photos already shown in the dashboard's bucket cards (max 4 each) --
// keeps a report spanning several months from turning into dozens of Drive
// fetches and a huge PDF.
const MAX_PHOTOS_PER_BUCKET = 4;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const residentId = params.get("resident");
  const start = params.get("start") || "";
  const end = params.get("end") || "";
  const frequency = (params.get("frequency") || "monthly") as WoundProgressionFrequency;
  const bodyPartLabel = params.get("bodyPart") || undefined;

  if (!residentId) return NextResponse.json({ error: "Missing resident" }, { status: 400 });

  const result = await getWoundProgressionData({
    residentId: Number(residentId),
    start,
    end,
    frequency,
    bodyPartLabel,
  });

  if (result.error || !result.data) {
    return NextResponse.json({ error: result.error ?? "No data" }, { status: result.error === "Access denied" ? 403 : 400 });
  }

  const data = result.data;

  // Resolve every embedded photo's bytes up front, in parallel -- a failed
  // single fetch renders as a placeholder (see the document component)
  // rather than failing the whole report.
  const series: WoundProgressionPdfSeries[] = await Promise.all(
    data.series.map(async (s): Promise<WoundProgressionPdfSeries> => {
      const buckets: WoundProgressionPdfBucket[] = await Promise.all(
        s.buckets.map(async (bucket): Promise<WoundProgressionPdfBucket> => {
          const toEmbed = bucket.photos.slice(0, MAX_PHOTOS_PER_BUCKET);
          const photos: WoundProgressionPdfPhoto[] = await Promise.all(
            toEmbed.map(async (photo): Promise<WoundProgressionPdfPhoto> => {
              try {
                const { buffer } = await readWoundPhotoFromDrive(photo.driveFileId);
                return { id: photo.id, description: photo.description, imageBuffer: buffer };
              } catch (err) {
                console.error(`Wound progression PDF: failed to fetch photo ${photo.id} from Drive:`, err);
                return { id: photo.id, description: photo.description, imageBuffer: null };
              }
            })
          );

          return {
            label: bucket.label,
            photos,
            descriptions: bucket.photos.filter((p) => p.description).map((p) => p.description as string),
            totalPhotoCount: bucket.photos.length,
            dressingPlanText: bucket.dressingPlan?.text ?? null,
          };
        })
      );
      return { bodyPartLabel: s.bodyPartLabel, buckets };
    })
  );

  const branch = await getReportBranchInfo(data.branchId);
  const buffer = await renderToBuffer(
    <WoundProgressionDocument
      residentName={data.residentName}
      icNumber={data.icNumber}
      frequency={data.frequency}
      start={data.start}
      end={data.end}
      bodyPartFilter={data.bodyPartFilter}
      series={series}
      branch={branch}
      logoSrc={getLogoPath()}
    />
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="wound-progression-${residentId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
