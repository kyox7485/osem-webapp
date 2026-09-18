import { NextRequest, NextResponse } from "next/server";
import { getWoundProgressionData, type WoundProgressionFrequency } from "@/lib/wound-progression-data";

// Backs the wound progression dashboard's own filter controls (resident,
// date range, frequency, body part) -- a plain client-side fetch rather
// than the rest of this app's usual "URL params -> server component"
// convention, because the dashboard needs to re-query on every filter
// tweak without a full page navigation. The photo upload flow already
// established this same client-fetch pattern for this module (see
// /api/wound-photos), so it isn't a new idiom here.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const residentId = params.get("resident");
  const start = params.get("start") || "";
  const end = params.get("end") || "";
  const frequency = (params.get("frequency") || "monthly") as WoundProgressionFrequency;
  const bodyPartLabel = params.get("bodyPart") || undefined;

  if (!residentId) return NextResponse.json({ data: null, error: "Please select a resident" }, { status: 400 });
  if (!["daily", "weekly", "monthly"].includes(frequency)) {
    return NextResponse.json({ data: null, error: "Invalid frequency" }, { status: 400 });
  }

  const result = await getWoundProgressionData({
    residentId: Number(residentId),
    start,
    end,
    frequency,
    bodyPartLabel,
  });

  if (result.error) return NextResponse.json(result, { status: result.error === "Access denied" ? 403 : 400 });
  return NextResponse.json(result);
}
