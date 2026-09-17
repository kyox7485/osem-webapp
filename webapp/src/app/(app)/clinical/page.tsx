import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { getAllStaffWithBranch, getClinicalLookups } from "@/lib/lookups";
import { redirect } from "next/navigation";
import { ClinicalContent } from "./clinical-content";
import type { NursingChartEntry } from "./nursing-chart-module";

export default async function ClinicalPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    resident?: string;
    start?: string;
    end?: string;
  }>;
}) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const params = await searchParams;
  const currentTab = params.tab || "nursing-chart";
  const residentFilter = params.resident || "";
  const startDate = params.start || "";
  const endDate = params.end || "";

  const supabase = await createClient();

  // Fetch residents for both tabs
  let residentQuery = supabase
    .from("tbl_residents")
    .select("id, resident_name, branch_id")
    .eq("status", "ACTIVE")
    .order("resident_name");

  if (account.rights !== "ADMIN") {
    residentQuery = residentQuery.eq("branch_id", account.branch_id);
  }

  const [{ data: residents }, allStaff, nursingChartLookups] = await Promise.all([
    residentQuery,
    getAllStaffWithBranch(),
    getClinicalLookups(),
  ]);

  // Fetch data based on active tab
  let vitals = [];
  let notes = [];
  let nursingChartEntries: NursingChartEntry[] = [];
  let error = null;

  if (currentTab === "vitals") {
    // Fetch vitals
    let vitalsQuery = supabase
      .from("tbl_vital")
      .select(
        `
        id,
        resident_id,
        entry_timestamp,
        systolic_bp,
        diastolic_bp,
        heart_rate,
        temperature,
        spo2,
        spo2_condition,
        dxt,
        dxt_remark,
        insulin_adjustment,
        respiration_rate,
        gcs_eye_id,
        gcs_verbal_id,
        gcs_motor_id,
        avpu_id,
        reviewed_by,
        tbl_residents!resident_id(id, resident_name, branch_id),
        tbl_staff!reviewed_by(StaffID, staff_name)
      `
      )
      .order("entry_timestamp", { ascending: false });

    if (account.rights !== "ADMIN") {
      vitalsQuery = vitalsQuery.eq("branch_id", account.branch_id);
    }

    if (residentFilter) vitalsQuery = vitalsQuery.eq("resident_id", parseInt(residentFilter));
    if (startDate) vitalsQuery = vitalsQuery.gte("entry_timestamp", `${startDate}T00:00:00`);
    if (endDate) vitalsQuery = vitalsQuery.lte("entry_timestamp", `${endDate}T23:59:59`);

    const { data: rawVitals, error: vitalsError } = await vitalsQuery;

    const gcsEyeById = new Map(nursingChartLookups.gcsEyeResponses.map((o) => [Number(o.id), o.label]));
    const gcsVerbalById = new Map(nursingChartLookups.gcsVerbalResponses.map((o) => [Number(o.id), o.label]));
    const gcsMotorById = new Map(nursingChartLookups.gcsMotorResponses.map((o) => [Number(o.id), o.label]));
    const avpuById = new Map(nursingChartLookups.avpuOptions.map((o) => [Number(o.id), o.label]));

    vitals = (rawVitals || []).map((v: any) => {
      const gcsParts = [
        v.gcs_eye_id ? `E${gcsEyeById.get(v.gcs_eye_id)?.split(" - ")[0]}` : null,
        v.gcs_verbal_id ? `V${gcsVerbalById.get(v.gcs_verbal_id)?.split(" - ")[0]}` : null,
        v.gcs_motor_id ? `M${gcsMotorById.get(v.gcs_motor_id)?.split(" - ")[0]}` : null,
      ].filter(Boolean);

      return {
        ...v,
        gcs_label: gcsParts.length > 0 ? gcsParts.join(" ") : null,
        avpu_label: v.avpu_id ? avpuById.get(v.avpu_id) ?? null : null,
        tbl_residents: Array.isArray(v.tbl_residents) ? v.tbl_residents[0] : v.tbl_residents,
        tbl_staff: Array.isArray(v.tbl_staff) ? v.tbl_staff[0] : v.tbl_staff,
      };
    });

    error = vitalsError?.message || null;
  } else if (currentTab === "progress-notes") {
    // Fetch progress notes
    let notesQuery = supabase
      .from("tbl_progress_notes")
      .select(
        `
        id,
        resident_id,
        entry_timestamp,
        progress_note,
        physical_examination,
        medical_plan,
        nursing_plan,
        feeding_plan,
        monitoring_plan,
        dressing_plan,
        physio_plan,
        reviewed_by,
        created_by,
        tbl_residents!resident_id(id, resident_name, branch_id),
        reviewer:tbl_staff!reviewed_by(StaffID, staff_name),
        author:tbl_staff!created_by(StaffID, staff_name)
      `
      )
      .order("entry_timestamp", { ascending: false });

    if (account.rights !== "ADMIN") {
      notesQuery = notesQuery.eq("branch_id", account.branch_id);
    }

    if (residentFilter) notesQuery = notesQuery.eq("resident_id", parseInt(residentFilter));
    if (startDate) notesQuery = notesQuery.gte("entry_timestamp", `${startDate}T00:00:00`);
    if (endDate) notesQuery = notesQuery.lte("entry_timestamp", `${endDate}T23:59:59`);

    const { data: rawNotes, error: notesError } = await notesQuery;

    notes = (rawNotes || []).map((n: any) => ({
      ...n,
      tbl_residents: Array.isArray(n.tbl_residents) ? n.tbl_residents[0] : n.tbl_residents,
      reviewer: Array.isArray(n.reviewer) ? n.reviewer[0] : n.reviewer,
      author: Array.isArray(n.author) ? n.author[0] : n.author,
    }));

    error = notesError?.message || null;
  } else if (currentTab === "nursing-chart") {
    let chartQuery = supabase
      .from("tbl_nursing_chart_entries")
      .select(
        `
        id,
        resident_id,
        entry_timestamp,
        tube_feeding,
        bowel_output_ids,
        pass_urine_ids,
        fluid_input,
        fluid_output,
        cbd_drainage,
        activity_ids,
        disturbance_level_ids,
        psycho_social_behaviour_ids,
        active_complaint_ids,
        intervention,
        doctors_plan,
        created_by,
        tbl_residents!resident_id(id, resident_name, branch_id),
        author:tbl_staff!created_by(StaffID, staff_name)
      `
      )
      .order("entry_timestamp", { ascending: false });

    if (account.rights !== "ADMIN") {
      chartQuery = chartQuery.eq("branch_id", account.branch_id);
    }

    if (residentFilter) chartQuery = chartQuery.eq("resident_id", parseInt(residentFilter));
    if (startDate) chartQuery = chartQuery.gte("entry_timestamp", `${startDate}T00:00:00`);
    if (endDate) chartQuery = chartQuery.lte("entry_timestamp", `${endDate}T23:59:59`);

    const { data: rawEntries, error: chartError } = await chartQuery;
    error = chartError?.message || null;

    const entryIds = (rawEntries ?? []).map((e: any) => e.id);
    const [{ data: mealsRaw }, { data: hygieneRaw }] =
      entryIds.length > 0
        ? await Promise.all([
            supabase
              .from("tbl_nursing_chart_meals")
              .select("chart_entry_id, meal_type_id, meal_portion_id, feeding_time_id")
              .in("chart_entry_id", entryIds),
            supabase
              .from("tbl_nursing_chart_hygiene_episodes")
              .select("chart_entry_id, assistance_level, activity_ids")
              .in("chart_entry_id", entryIds),
          ])
        : [{ data: [] }, { data: [] }];

    const byId = (list: { id: number | string; label: string }[]) => new Map(list.map((o) => [Number(o.id), o.label]));
    const bowelById = byId(nursingChartLookups.bowelOutputTypes);
    const urineById = byId(nursingChartLookups.passUrineTypes);
    const activityById = byId(nursingChartLookups.activities);
    const disturbanceById = byId(nursingChartLookups.disturbanceLevels);
    const psychoById = byId(nursingChartLookups.psychoSocialBehaviours);
    const complaintById = byId(nursingChartLookups.activeComplaints);
    const hygieneActivityById = byId(nursingChartLookups.hygieneCareActivities);
    const mealTypeById = byId(nursingChartLookups.mealTypes);
    const mealPortionById = byId(nursingChartLookups.mealPortions);
    const feedingTimeById = byId(nursingChartLookups.feedingTimes);

    const mealsByEntry = new Map<number, string[]>();
    (mealsRaw ?? []).forEach((m: any) => {
      const parts = [mealTypeById.get(m.meal_type_id), mealPortionById.get(m.meal_portion_id), feedingTimeById.get(m.feeding_time_id)].filter(
        Boolean
      );
      const list = mealsByEntry.get(m.chart_entry_id) ?? [];
      list.push(parts.join(" - "));
      mealsByEntry.set(m.chart_entry_id, list);
    });

    const hygieneByEntry = new Map<number, string[]>();
    (hygieneRaw ?? []).forEach((h: any) => {
      const activities = (h.activity_ids ?? []).map((id: number) => hygieneActivityById.get(id)).filter(Boolean);
      if (activities.length === 0) return;
      const list = hygieneByEntry.get(h.chart_entry_id) ?? [];
      list.push(`${h.assistance_level}: ${activities.join(", ")}`);
      hygieneByEntry.set(h.chart_entry_id, list);
    });

    const mapIds = (ids: number[] | null, table: Map<number, string>) => (ids ?? []).map((id) => table.get(id)).filter((v): v is string => !!v);

    nursingChartEntries = (rawEntries ?? []).map((e: any) => {
      const resident = Array.isArray(e.tbl_residents) ? e.tbl_residents[0] : e.tbl_residents;
      const author = Array.isArray(e.author) ? e.author[0] : e.author;

      return {
        id: e.id,
        resident_id: e.resident_id,
        entry_timestamp: e.entry_timestamp,
        tube_feeding: e.tube_feeding,
        fluid_input: e.fluid_input,
        fluid_output: e.fluid_output,
        cbd_drainage: e.cbd_drainage,
        intervention: e.intervention,
        doctors_plan: e.doctors_plan,
        bowel_output_labels: mapIds(e.bowel_output_ids, bowelById),
        pass_urine_labels: mapIds(e.pass_urine_ids, urineById),
        activity_labels: mapIds(e.activity_ids, activityById),
        disturbance_level_labels: mapIds(e.disturbance_level_ids, disturbanceById),
        psycho_social_labels: mapIds(e.psycho_social_behaviour_ids, psychoById),
        active_complaint_labels: mapIds(e.active_complaint_ids, complaintById),
        meal_labels: mealsByEntry.get(e.id) ?? [],
        hygiene_labels: hygieneByEntry.get(e.id) ?? [],
        resident_name: resident?.resident_name ?? "--",
        entered_by_name: author?.staff_name ?? "--",
      };
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Clinical</h1>
      </div>

      <ClinicalContent
        residents={residents || []}
        allStaff={allStaff}
        vitals={vitals}
        notes={notes}
        nursingChartEntries={nursingChartEntries}
        nursingChartLookups={nursingChartLookups}
        currentResident={residentFilter}
        currentStart={startDate}
        currentEnd={endDate}
        error={error}
      />
    </div>
  );
}
