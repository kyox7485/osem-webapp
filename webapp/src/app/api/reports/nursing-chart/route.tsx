import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getClinicalLookups } from "@/lib/lookups";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import { NursingChartDocument, type NursingChartReportData } from "@/lib/pdf/documents/nursing-chart-document";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = await createClient();
  const { data: entry, error } = await supabase
    .from("tbl_nursing_chart_entries")
    .select(
      `
      id,
      branch_id,
      entry_timestamp,
      tube_feeding,
      fluid_input,
      fluid_output,
      cbd_drainage,
      activity_ids,
      activity_other,
      disturbance_level_ids,
      psycho_social_behaviour_ids,
      psycho_social_other,
      active_complaint_ids,
      active_complaint_other,
      intervention,
      doctors_plan,
      tbl_residents!resident_id(resident_name, ic_number),
      author:tbl_staff!created_by(staff_name)
    `
    )
    .eq("id", id)
    .single();

  if (error || !entry) return NextResponse.json({ error: "Nursing chart entry not found" }, { status: 404 });

  if (!canAccessAllBranches(account) && entry.branch_id !== account.branch_id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const resident = Array.isArray(entry.tbl_residents) ? entry.tbl_residents[0] : entry.tbl_residents;
  const author = Array.isArray(entry.author) ? entry.author[0] : entry.author;

  const [{ data: mealsRaw }, { data: hygieneRaw }, { data: eliminationRaw }, lookups] = await Promise.all([
    supabase
      .from("tbl_nursing_chart_meals")
      .select("meal_type_id, meal_type_other, meal_portion_id, meal_portion_other, feeding_time_id, feeding_volume, aspirate_amount")
      .eq("chart_entry_id", id),
    supabase.from("tbl_nursing_chart_hygiene_episodes").select("assistance_level, activity_ids").eq("chart_entry_id", id),
    supabase.from("tbl_nursing_chart_elimination_episodes").select("bowel_output_ids, pass_urine_id").eq("chart_entry_id", id),
    getClinicalLookups(),
  ]);

  const byId = (list: { id: number | string; label: string }[]) => new Map(list.map((o) => [Number(o.id), o.label]));
  const bowelById = byId(lookups.bowelOutputTypes);
  const urineById = byId(lookups.passUrineTypes);
  const activityById = byId(lookups.activities);
  const disturbanceById = byId(lookups.disturbanceLevels);
  const psychoById = byId(lookups.psychoSocialBehaviours);
  const complaintById = byId(lookups.activeComplaints);
  const hygieneActivityById = byId(lookups.hygieneCareActivities);
  const mealTypeById = byId(lookups.mealTypes);
  const mealPortionById = byId(lookups.mealPortions);
  const feedingTimeById = byId(lookups.feedingTimes);

  const mapIds = (ids: number[] | null, table: Map<number, string>) => (ids ?? []).map((i) => table.get(i)).filter((v): v is string => !!v);
  const withoutOthers = (labels: string[]) => labels.filter((l) => !l.trim().toLowerCase().startsWith("others"));

  const mealLabels = (mealsRaw ?? []).map((m) =>
    [
      m.meal_type_other || mealTypeById.get(m.meal_type_id),
      m.meal_portion_other || mealPortionById.get(m.meal_portion_id),
      feedingTimeById.get(m.feeding_time_id),
      m.feeding_volume,
    ]
      .filter(Boolean)
      .join(" - ")
  );

  // Tube Feeding meals get a dedicated Time / Feeding Regime / Aspirate (mL)
  // table -- Oral Feed meals have no per-meal time, so they stay as the
  // joined meal_labels text above.
  const mealRows = (mealsRaw ?? []).map((m) => ({
    time: feedingTimeById.get(m.feeding_time_id) ?? "--",
    regime: m.feeding_volume || "--",
    aspirate: m.aspirate_amount !== null && m.aspirate_amount !== undefined ? String(m.aspirate_amount) : "--",
  }));

  const hygieneLabels = (hygieneRaw ?? [])
    .map((h) => {
      const activities = (h.activity_ids ?? []).map((i: number) => hygieneActivityById.get(i)).filter(Boolean);
      return activities.length > 0 ? `${h.assistance_level}: ${activities.join(", ")}` : null;
    })
    .filter((v): v is string => !!v);

  const eliminationLabels = (eliminationRaw ?? [])
    .map((ep) => [...(ep.bowel_output_ids ?? []).map((i: number) => bowelById.get(i)), urineById.get(ep.pass_urine_id)].filter(Boolean).join(", "))
    .filter((v) => v.length > 0);

  const reportData: NursingChartReportData = {
    entry_timestamp: entry.entry_timestamp,
    resident_name: resident?.resident_name ?? "--",
    ic_number: resident?.ic_number ?? null,
    tube_feeding: entry.tube_feeding,
    fluid_input: entry.fluid_input,
    fluid_output: entry.fluid_output,
    cbd_drainage: entry.cbd_drainage,
    elimination_labels: eliminationLabels,
    activity_labels: [...withoutOthers(mapIds(entry.activity_ids, activityById)), ...(entry.activity_other ? [`Others: ${entry.activity_other}`] : [])],
    disturbance_level_labels: mapIds(entry.disturbance_level_ids, disturbanceById),
    psycho_social_labels: [
      ...withoutOthers(mapIds(entry.psycho_social_behaviour_ids, psychoById)),
      ...(entry.psycho_social_other ? [`Others: ${entry.psycho_social_other}`] : []),
    ],
    active_complaint_labels: [
      ...withoutOthers(mapIds(entry.active_complaint_ids, complaintById)),
      ...(entry.active_complaint_other ? [`Others: ${entry.active_complaint_other}`] : []),
    ],
    meal_labels: mealLabels,
    meal_rows: entry.tube_feeding === "Tube Feeding" ? mealRows : [],
    hygiene_labels: hygieneLabels,
    intervention: entry.intervention,
    doctors_plan: entry.doctors_plan,
    entered_by_name: author?.staff_name ?? "--",
  };

  const branch = await getReportBranchInfo(entry.branch_id);
  const buffer = await renderToBuffer(<NursingChartDocument entry={reportData} branch={branch} logoSrc={getLogoPath()} />);

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="nursing-chart-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
