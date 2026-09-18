import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { getWoundBodyParts } from "@/lib/lookups";

// Same convention as format-date.ts -- pinned so bucketing/labels never
// drift with the server's ambient timezone.
const TIME_ZONE = "Asia/Kuala_Lumpur";

export type WoundProgressionFrequency = "daily" | "weekly" | "monthly";

export type WoundProgressionPhoto = {
  id: number;
  description: string | null;
  uploadedAt: string;
  // Carried through only so the PDF route can fetch the actual image bytes
  // from Drive without a second round-trip query -- the dashboard itself
  // still loads thumbnails via the existing /api/wound-photos/:id proxy,
  // which re-checks access on its own.
  driveFileId: string;
};

export type WoundProgressionDressingPlan = {
  text: string;
  notedAt: string;
};

export type WoundProgressionBucket = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  photos: WoundProgressionPhoto[];
  dressingPlan: WoundProgressionDressingPlan | null;
};

export type WoundProgressionSeries = {
  bodyPartLabel: string;
  buckets: WoundProgressionBucket[];
};

export type WoundProgressionData = {
  residentId: number;
  residentName: string;
  icNumber: string | null;
  branchId: number;
  frequency: WoundProgressionFrequency;
  start: string;
  end: string;
  bodyPartFilter: string | null;
  series: WoundProgressionSeries[];
};

function klDateParts(iso: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

// A calendar date has no timezone of its own once we've pulled it out of the
// KL wall-clock reading above -- represented as UTC midnight purely so
// Date's day-arithmetic (getUTCDay, setUTCDate) works predictably, and
// re-formatted with timeZone "UTC" below so nothing shifts it again.
function utcMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
}

// Returns the bucket a timestamp falls into: its stable sort/group key, the
// human label shown on the dashboard/PDF, and the calendar period it spans
// (used only for display, e.g. "Week of 15 Sep - 21 Sep 2026").
function resolveBucket(iso: string, frequency: WoundProgressionFrequency): { key: string; label: string; periodStart: string; periodEnd: string } {
  const { y, m, d } = klDateParts(iso);
  const day = utcMidnight(y, m, d);

  if (frequency === "daily") {
    return { key: isoDate(day), label: formatDayLabel(day), periodStart: isoDate(day), periodEnd: isoDate(day) };
  }

  if (frequency === "weekly") {
    // ISO week: Monday start. getUTCDay() is 0=Sun..6=Sat; offset counts
    // days since the most recent Monday.
    const offset = (day.getUTCDay() + 6) % 7;
    const weekStart = addDays(day, -offset);
    const weekEnd = addDays(weekStart, 6);
    return {
      key: isoDate(weekStart),
      label: `Week of ${formatDayLabel(weekStart)} - ${formatDayLabel(weekEnd)}`,
      periodStart: isoDate(weekStart),
      periodEnd: isoDate(weekEnd),
    };
  }

  const monthStart = utcMidnight(y, m, 1);
  const monthEnd = addDays(utcMidnight(y, m + 1, 1), -1);
  return {
    key: `${y}-${String(m).padStart(2, "0")}`,
    label: formatMonthLabel(monthStart),
    periodStart: isoDate(monthStart),
    periodEnd: isoDate(monthEnd),
  };
}

// The dressing plan in force "at" a given moment is the most recent
// progress note on or before it that actually recorded one -- plans persist
// until superseded by a newer note, they aren't re-stated every entry.
function findApplicablePlan(
  sortedPlans: { entry_timestamp: string; dressing_plan: string }[],
  atIso: string
): WoundProgressionDressingPlan | null {
  let applicable: { entry_timestamp: string; dressing_plan: string } | null = null;
  for (const plan of sortedPlans) {
    if (plan.entry_timestamp > atIso) break;
    applicable = plan;
  }
  return applicable ? { text: applicable.dressing_plan, notedAt: applicable.entry_timestamp } : null;
}

export async function getWoundProgressionData(params: {
  residentId: number;
  start: string;
  end: string;
  frequency: WoundProgressionFrequency;
  bodyPartLabel?: string;
}): Promise<{ data: WoundProgressionData | null; error: string | null }> {
  const account = await getCurrentUser();
  if (!account) return { data: null, error: "Not authenticated" };
  if (!params.start || !params.end) return { data: null, error: "Please choose a start and end date" };

  const supabase = await createClient();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("id, resident_name, ic_number, branch_id")
    .eq("id", params.residentId)
    .single();

  if (!resident) return { data: null, error: "Resident not found" };
  if (account.rights !== "ADMIN" && resident.branch_id !== account.branch_id) {
    return { data: null, error: "Access denied" };
  }

  const rangeStartIso = `${params.start}T00:00:00`;
  const rangeEndIso = `${params.end}T23:59:59`;

  let photosQuery = supabase
    .from("tbl_wound_photos")
    .select("id, body_part_label, description, uploaded_at, drive_file_id")
    .eq("resident_id", params.residentId)
    .gte("uploaded_at", rangeStartIso)
    .lte("uploaded_at", rangeEndIso)
    .order("uploaded_at", { ascending: true });

  if (params.bodyPartLabel) photosQuery = photosQuery.eq("body_part_label", params.bodyPartLabel);

  // Dressing plans: everything written inside the window, plus the single
  // most recent one from before it -- a bucket at the very start of the
  // range still needs to know "what plan was already in force", not just
  // plans newly written after the range began.
  const [{ data: photosRaw, error: photosError }, { data: plansInRange }, { data: priorPlanRaw }, woundBodyParts] = await Promise.all([
    photosQuery,
    supabase
      .from("tbl_progress_notes")
      .select("entry_timestamp, dressing_plan")
      .eq("resident_id", params.residentId)
      .not("dressing_plan", "is", null)
      .gte("entry_timestamp", rangeStartIso)
      .lte("entry_timestamp", rangeEndIso)
      .order("entry_timestamp", { ascending: true }),
    supabase
      .from("tbl_progress_notes")
      .select("entry_timestamp, dressing_plan")
      .eq("resident_id", params.residentId)
      .not("dressing_plan", "is", null)
      .lt("entry_timestamp", rangeStartIso)
      .order("entry_timestamp", { ascending: false })
      .limit(1),
    getWoundBodyParts(),
  ]);

  if (photosError) return { data: null, error: photosError.message };

  const priorPlan = (priorPlanRaw ?? []) as { entry_timestamp: string; dressing_plan: string }[];
  const sortedPlans = [...priorPlan, ...((plansInRange ?? []) as { entry_timestamp: string; dressing_plan: string }[])];

  const bodyPartOrder = new Map(woundBodyParts.map((p, i) => [p.label, i]));

  const seriesByBodyPart = new Map<string, Map<string, WoundProgressionBucket>>();

  for (const photo of photosRaw ?? []) {
    const bucketInfo = resolveBucket(photo.uploaded_at, params.frequency);
    let buckets = seriesByBodyPart.get(photo.body_part_label);
    if (!buckets) {
      buckets = new Map();
      seriesByBodyPart.set(photo.body_part_label, buckets);
    }
    let bucket = buckets.get(bucketInfo.key);
    if (!bucket) {
      bucket = { ...bucketInfo, photos: [], dressingPlan: null };
      buckets.set(bucketInfo.key, bucket);
    }
    bucket.photos.push({ id: photo.id, description: photo.description, uploadedAt: photo.uploaded_at, driveFileId: photo.drive_file_id });
  }

  const series: WoundProgressionSeries[] = Array.from(seriesByBodyPart.entries())
    .map(([bodyPartLabel, bucketMap]) => {
      const buckets = Array.from(bucketMap.values())
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((bucket) => {
          // The plan "at" this bucket is resolved against its latest photo
          // -- the most recent look at the wound within that period, which
          // is what a plan written partway through the period should be
          // compared against.
          const latestPhotoAt = bucket.photos[bucket.photos.length - 1].uploadedAt;
          return { ...bucket, dressingPlan: findApplicablePlan(sortedPlans, latestPhotoAt) };
        });
      return { bodyPartLabel, buckets };
    })
    .sort((a, b) => {
      const orderA = bodyPartOrder.get(a.bodyPartLabel) ?? Number.MAX_SAFE_INTEGER;
      const orderB = bodyPartOrder.get(b.bodyPartLabel) ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.bodyPartLabel.localeCompare(b.bodyPartLabel);
    });

  return {
    data: {
      residentId: resident.id,
      residentName: resident.resident_name,
      icNumber: resident.ic_number,
      branchId: resident.branch_id,
      frequency: params.frequency,
      start: params.start,
      end: params.end,
      bodyPartFilter: params.bodyPartLabel ?? null,
      series,
    },
    error: null,
  };
}
