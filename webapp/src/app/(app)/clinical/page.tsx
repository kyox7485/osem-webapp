import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches, isHqAdmin } from "@/lib/current-user";
import { getAllStaffWithBranch, getNursingStaff, getClinicalLookups, getFeedingTypes, getWoundBodyParts, getDemoBranchIds, getBranches } from "@/lib/lookups";
import { getObservationChartsForResidents } from "./observation-chart-actions";
import type { ObservationEntry } from "./observation-chart-actions";
import { getActiveObservationStatuses, getCompletedObservationEpisodes } from "./observation-status-actions";
import type { ObservationStatusRow } from "./observation-status-actions";
import { getBehaviourCharts, getBehaviourEpisodes } from "./behaviour-chart-actions";
import type { BehaviourEntry, BehaviourEpisode } from "./behaviour-chart-actions";
import { redirect } from "next/navigation";
import { ClinicalContent } from "./clinical-content";
import { getWoundSessionHistory } from "./wound-photo-actions";
import type { NursingChartEntry } from "./nursing-chart-module";
import { PageTitle } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";

// The AMN clinical migration committed ~85k nursing chart entries (and ~37k
// vital readings) on 2026-09-26, so an unbounded all-branches read now exceeds
// the statement timeout. Every report query in this file is capped at
// REPORT_LIMIT and bounded by a default date window; the module shows a notice
// when a cap is hit, so a truncated list is never mistaken for the full one.
const REPORT_LIMIT = 500;

// Default window, in days, when the user hasn't set a range. Nursing chart and
// vitals chart several times a day, so 7; observation chart already defaults
// to 3. Wound photos and progress notes are low-volume -- see the per-tab
// comments where those deliberately keep the full range.
const DEFAULT_WINDOW_DAYS = 7;

// Last N days ending today, in Asia/Kuala_Lumpur, as {start, end} YYYY-MM-DD.
function defaultWindow(days: number): { start: string; end: string } {
  const nowMYT = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  const end = nowMYT.toLocaleDateString("en-CA");
  const startDate = new Date(nowMYT);
  startDate.setDate(startDate.getDate() - (days - 1));
  return { start: startDate.toLocaleDateString("en-CA"), end };
}

// Splits `start`/`end` (either may be empty) into the window a query should
// actually use, falling back to `days` when neither is set. A user who sets
// only one end keeps exactly that end -- we don't silently invent the other.
function resolveWindow(start: string, end: string, days: number | null): { start: string; end: string } {
  if (!days || start || end) return { start, end };
  return defaultWindow(days);
}

export default async function ClinicalPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    resident?: string;
    start?: string;
    end?: string;
    prev?: string;
    branch?: string;
  }>;
}) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const { t } = await getServerTranslator();

  const params = await searchParams;
  const currentTab = params.tab || "nursing-chart";
  const residentFilter = params.resident || "";
  const startDate = params.start || "";
  const endDate = params.end || "";
  const prevParam = params.prev || "";

  const supabase = await createClient();

  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  // Branch dropdown for HQ ADMIN. They can see every non-demo branch, so
  // they need a way to narrow the resident list (and the readings that hang
  // off it) to one branch -- the same reason the Staff page has one. Gated on
  // isHqAdmin(), not canAccessAllBranches(): a MODERATOR at an HQ/PHY branch
  // also spans branches, but this is the HQ ADMIN browsing aid, and
  // isHqAdmin() is the same gate the Edit/Delete controls use.
  const hqAdmin = isHqAdmin(account);
  // Read the param but only honour it for an HQ ADMIN: a hand-edited URL
  // must not widen anyone else's view, and everyone else is already pinned
  // to their own branch by the .eq() below.
  const branchFilter = hqAdmin ? Number(params.branch) || null : null;

  // Fetch residents for both tabs
  let residentQuery = supabase
    .from("tbl_residents")
    .select("id, resident_name, branch_id")
    .eq("status", "ACTIVE")
    .order("resident_name");

  if (!canAccessAllBranches(account)) {
    residentQuery = residentQuery.eq("branch_id", account.branch_id);
  } else if (excludedBranchIds.length > 0) {
    residentQuery = residentQuery.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
  }

  // Applied AFTER the access filters above, so it can only narrow what this
  // user is already allowed to see -- it can never widen it.
  if (branchFilter) residentQuery = residentQuery.eq("branch_id", branchFilter);

  const [
    { data: residents },
    allStaff,
    nursingStaff,
    nursingChartLookups,
    feedingTypes,
    woundBodyParts,
    allBranches,
  ] = await Promise.all([
    residentQuery,
    getAllStaffWithBranch(),
    getNursingStaff(),
    getClinicalLookups(),
    getFeedingTypes(),
    getWoundBodyParts(),
    // Only fetched when the dropdown will actually render.
    hqAdmin ? getBranches() : Promise.resolve([]),
  ]);

  // The dropdown never offers the DEMO branch, and `excludedBranchIds` is
  // empty for the demo account itself -- so the demo branch is added back for
  // that one login rather than showing it an empty list. (The demo account is
  // HQ ADMIN but pinned to a NUR branch, so it can only ever see this branch.)
  const branches = hqAdmin
    ? allBranches.filter((b) => isDemoUser || !excludedBranchIds.includes(Number(b.id)))
    : [];

  // Fetch data based on active tab
  let vitals = [];
  let notes = [];
  let nursingChartEntries: NursingChartEntry[] = [];
  let referrals = [];
  let woundSessions: Awaited<ReturnType<typeof getWoundSessionHistory>>["sessions"] = [];
  let observationEntries: ObservationEntry[] = [];
  let activeObservationEpisodes: ObservationStatusRow[] = [];
  let completedObservationEpisodes: ObservationStatusRow[] = [];
  let behaviourEntries: BehaviourEntry[] = [];
  let behaviourEpisodes: BehaviourEpisode[] = [];
  let error = null;
  // Set by whichever tab is active when its query hit REPORT_LIMIT.
  let truncated = false;
  // What the active tab's query actually used. Tabs with a default window
  // report their resolved range so the filter bar never contradicts the query;
  // tabs without one leave these equal to the raw params.
  let appliedStart = startDate;
  let appliedEnd = endDate;

  if (currentTab === "vitals") {
    // No default date window here, unlike the nursing chart. A silent default
    // made a tab full of older readings render as "No vital signs recorded
    // yet." -- which reads as data loss and hides the HQ ADMIN edit/delete
    // buttons, since an empty table has no rows to hang them on. The row cap
    // below is what keeps this bounded: it returns the newest REPORT_LIMIT
    // readings overall, and ResultNotice says so when the cap is hit. See
    // commit 57515a8 for the statement timeout this window was covering.
    const window = resolveWindow(startDate, endDate, null);
    appliedStart = window.start;
    appliedEnd = window.end;

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
        reviewed_by_other,
        tbl_residents!resident_id(id, resident_name, branch_id),
        tbl_staff!reviewed_by(StaffID, staff_name)
      `
      )
      .order("entry_timestamp", { ascending: false });

    if (!canAccessAllBranches(account)) {
      vitalsQuery = vitalsQuery.eq("branch_id", account.branch_id);
    } else if (excludedBranchIds.length > 0) {
      vitalsQuery = vitalsQuery.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
    }

    if (branchFilter) vitalsQuery = vitalsQuery.eq("branch_id", branchFilter);
    if (residentFilter) vitalsQuery = vitalsQuery.eq("resident_id", parseInt(residentFilter));
    if (window.start) vitalsQuery = vitalsQuery.gte("entry_timestamp", `${window.start}T00:00:00`);
    if (window.end) vitalsQuery = vitalsQuery.lte("entry_timestamp", `${window.end}T23:59:59`);

    const { data: rawVitals, error: vitalsError } = await vitalsQuery.limit(REPORT_LIMIT);
    truncated = (rawVitals?.length ?? 0) >= REPORT_LIMIT;

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
        reviewed_by_other,
        created_by,
        created_by_other,
        tbl_residents!resident_id(id, resident_name, branch_id),
        reviewer:tbl_staff!reviewed_by(StaffID, staff_name),
        author:tbl_staff!created_by(StaffID, staff_name)
      `
      )
      .order("entry_timestamp", { ascending: false });

    if (!canAccessAllBranches(account)) {
      notesQuery = notesQuery.eq("branch_id", account.branch_id);
    } else if (excludedBranchIds.length > 0) {
      notesQuery = notesQuery.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
    }

    if (branchFilter) notesQuery = notesQuery.eq("branch_id", branchFilter);
    if (residentFilter) notesQuery = notesQuery.eq("resident_id", parseInt(residentFilter));
    if (startDate) notesQuery = notesQuery.gte("entry_timestamp", `${startDate}T00:00:00`);
    if (endDate) notesQuery = notesQuery.lte("entry_timestamp", `${endDate}T23:59:59`);

    const { data: rawNotes, error: notesError } = await notesQuery.limit(REPORT_LIMIT);
    truncated = (rawNotes?.length ?? 0) >= REPORT_LIMIT;

    notes = (rawNotes || []).map((n: any) => ({
      ...n,
      tbl_residents: Array.isArray(n.tbl_residents) ? n.tbl_residents[0] : n.tbl_residents,
      reviewer: Array.isArray(n.reviewer) ? n.reviewer[0] : n.reviewer,
      author: Array.isArray(n.author) ? n.author[0] : n.author,
    }));

    error = notesError?.message || null;
  } else if (currentTab === "nursing-chart") {
    // Default to the last 7 days when the user hasn't set a range, so the
    // all-branches (HQ) view doesn't read the whole table. The resolved range
    // is passed down to the filter bar so it never contradicts what was
    // queried; clearing either date drops back to the 7-day default.
    const window = resolveWindow(startDate, endDate, DEFAULT_WINDOW_DAYS);
    appliedStart = window.start;
    appliedEnd = window.end;

    let chartQuery = supabase
      .from("tbl_nursing_chart_entries")
      .select(
        `
        id,
        resident_id,
        entry_timestamp,
        tube_feeding,
        fluid_input,
        fluid_output,
        cbd_drainage,
        activity_ids,
        disturbance_level_ids,
        psycho_social_behaviour_ids,
        active_complaint_ids,
        active_complaint_other,
        activity_other,
        psycho_social_other,
        intervention,
        doctors_plan,
        created_by,
        created_by_other,
        tbl_residents!resident_id(id, resident_name, branch_id),
        author:tbl_staff!created_by(StaffID, staff_name)
      `
      )
      .order("entry_timestamp", { ascending: false });

    if (!canAccessAllBranches(account)) {
      chartQuery = chartQuery.eq("branch_id", account.branch_id);
    } else if (excludedBranchIds.length > 0) {
      chartQuery = chartQuery.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
    }

    if (branchFilter) chartQuery = chartQuery.eq("branch_id", branchFilter);
    if (residentFilter) chartQuery = chartQuery.eq("resident_id", parseInt(residentFilter));
    if (window.start) chartQuery = chartQuery.gte("entry_timestamp", `${window.start}T00:00:00`);
    if (window.end) chartQuery = chartQuery.lte("entry_timestamp", `${window.end}T23:59:59`);

    const { data: rawEntries, error: chartError } = await chartQuery.limit(REPORT_LIMIT);
    error = chartError?.message || null;
    truncated = (rawEntries?.length ?? 0) >= REPORT_LIMIT;

    const entryIds = (rawEntries ?? []).map((e: any) => e.id);
    const [{ data: mealsRaw }, { data: hygieneRaw }, { data: eliminationRaw }] =
      entryIds.length > 0
        ? await Promise.all([
            supabase
              .from("tbl_nursing_chart_meals")
              .select("chart_entry_id, meal_type_id, meal_type_other, meal_portion_id, meal_portion_other, feeding_time_id, feeding_volume, aspirate_amount")
              .in("chart_entry_id", entryIds),
            supabase
              .from("tbl_nursing_chart_hygiene_episodes")
              .select("chart_entry_id, assistance_level, activity_ids")
              .in("chart_entry_id", entryIds),
            supabase
              .from("tbl_nursing_chart_elimination_episodes")
              .select("chart_entry_id, bowel_output_ids, pass_urine_id")
              .in("chart_entry_id", entryIds),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }];

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
    const rawMealsByEntry = new Map<number, any[]>();
    (mealsRaw ?? []).forEach((m: any) => {
      const parts = [
        m.meal_type_other || mealTypeById.get(m.meal_type_id),
        m.meal_portion_other || mealPortionById.get(m.meal_portion_id),
        feedingTimeById.get(m.feeding_time_id),
        m.feeding_volume,
      ].filter(Boolean);
      const list = mealsByEntry.get(m.chart_entry_id) ?? [];
      list.push(parts.join(" - "));
      mealsByEntry.set(m.chart_entry_id, list);
      const rawList = rawMealsByEntry.get(m.chart_entry_id) ?? [];
      rawList.push(m);
      rawMealsByEntry.set(m.chart_entry_id, rawList);
    });

    const hygieneByEntry = new Map<number, string[]>();
    const rawHygieneByEntry = new Map<number, any[]>();
    (hygieneRaw ?? []).forEach((h: any) => {
      const activities = (h.activity_ids ?? []).map((id: number) => hygieneActivityById.get(id)).filter(Boolean);
      if (activities.length === 0) return;
      const list = hygieneByEntry.get(h.chart_entry_id) ?? [];
      list.push(`${h.assistance_level}: ${activities.join(", ")}`);
      hygieneByEntry.set(h.chart_entry_id, list);
      const rawList = rawHygieneByEntry.get(h.chart_entry_id) ?? [];
      rawList.push(h);
      rawHygieneByEntry.set(h.chart_entry_id, rawList);
    });

    const eliminationByEntry = new Map<number, string[]>();
    const rawEliminationByEntry = new Map<number, any[]>();
    (eliminationRaw ?? []).forEach((ep: any) => {
      const parts = [...(ep.bowel_output_ids ?? []).map((id: number) => bowelById.get(id)), urineById.get(ep.pass_urine_id)].filter(Boolean);
      if (parts.length === 0) return;
      const list = eliminationByEntry.get(ep.chart_entry_id) ?? [];
      list.push(parts.join(", "));
      eliminationByEntry.set(ep.chart_entry_id, list);
      const rawList = rawEliminationByEntry.get(ep.chart_entry_id) ?? [];
      rawList.push(ep);
      rawEliminationByEntry.set(ep.chart_entry_id, rawList);
    });

    const mapIds = (ids: number[] | null, table: Map<number, string>) => (ids ?? []).map((id) => table.get(id)).filter((v): v is string => !!v);
    // Drops the generic "Others"/"Others:" label so it can be replaced with
    // the specific free text the user typed for it.
    const withoutOthers = (labels: string[]) => labels.filter((l) => !l.trim().toLowerCase().startsWith("others"));

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
        elimination_labels: eliminationByEntry.get(e.id) ?? [],
        activity_labels: [
          ...withoutOthers(mapIds(e.activity_ids, activityById)),
          ...(e.activity_other ? [`Others: ${e.activity_other}`] : []),
        ],
        disturbance_level_labels: mapIds(e.disturbance_level_ids, disturbanceById),
        psycho_social_labels: [
          ...withoutOthers(mapIds(e.psycho_social_behaviour_ids, psychoById)),
          ...(e.psycho_social_other ? [`Others: ${e.psycho_social_other}`] : []),
        ],
        active_complaint_labels: [
          ...withoutOthers(mapIds(e.active_complaint_ids, complaintById)),
          ...(e.active_complaint_other ? [`Others: ${e.active_complaint_other}`] : []),
        ],
        meal_labels: mealsByEntry.get(e.id) ?? [],
        hygiene_labels: hygieneByEntry.get(e.id) ?? [],
        resident_name: resident?.resident_name ?? "--",
        entered_by_name: author?.staff_name ?? e.created_by_other ?? "--",
        raw_meals: rawMealsByEntry.get(e.id) ?? [],
        raw_hygiene: rawHygieneByEntry.get(e.id) ?? [],
        raw_elimination: rawEliminationByEntry.get(e.id) ?? [],
        activity_ids: e.activity_ids ?? null,
        disturbance_level_ids: e.disturbance_level_ids ?? null,
        psycho_social_behaviour_ids: e.psycho_social_behaviour_ids ?? null,
        active_complaint_ids: e.active_complaint_ids ?? null,
      };
    });
  } else if (currentTab === "hospital-referral") {
    let referralsQuery = supabase
      .from("tbl_hospital_referrals")
      .select(
        `
        id,
        resident_id,
        referral_datetime,
        chief_complaints,
        vital_signs,
        mobility,
        feeding,
        hygiene,
        reviewed_by,
        reviewed_by_other,
        tbl_residents!resident_id(id, resident_name, branch_id),
        reviewer:tbl_staff!reviewed_by(StaffID, staff_name)
      `
      )
      .order("referral_datetime", { ascending: false });

    if (!canAccessAllBranches(account)) {
      referralsQuery = referralsQuery.eq("branch_id", account.branch_id);
    } else if (excludedBranchIds.length > 0) {
      referralsQuery = referralsQuery.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
    }

    if (branchFilter) referralsQuery = referralsQuery.eq("branch_id", branchFilter);
    if (residentFilter) referralsQuery = referralsQuery.eq("resident_id", parseInt(residentFilter));
    if (startDate) referralsQuery = referralsQuery.gte("referral_datetime", `${startDate}T00:00:00`);
    if (endDate) referralsQuery = referralsQuery.lte("referral_datetime", `${endDate}T23:59:59`);

    const { data: rawReferrals, error: referralsError } = await referralsQuery.limit(REPORT_LIMIT);
    truncated = (rawReferrals?.length ?? 0) >= REPORT_LIMIT;

    referrals = (rawReferrals || []).map((r: any) => ({
      ...r,
      tbl_residents: Array.isArray(r.tbl_residents) ? r.tbl_residents[0] : r.tbl_residents,
      reviewer: Array.isArray(r.reviewer) ? r.reviewer[0] : r.reviewer,
    }));

    error = referralsError?.message || null;
  } else if (currentTab === "wound-photo") {
    // Wound photos are a low-volume, episodic record, so this keeps the full
    // range rather than defaulting to a window -- but still caps the row count
    // so an all-branches read can't run away.
    const result = await getWoundSessionHistory({
      residentId: residentFilter,
      start: startDate,
      end: endDate,
      excludedBranchIds,
      branchId: branchFilter,
      limit: REPORT_LIMIT,
    });
    woundSessions = result.sessions;
    error = result.error;
    truncated = result.truncated;
  } else if (currentTab === "observation-chart") {
    const [activeResult, completedResult] = await Promise.all([
      getActiveObservationStatuses({ excludedBranchIds, branchId: branchFilter }),
      getCompletedObservationEpisodes({ excludedBranchIds, branchId: branchFilter }),
    ]);
    activeObservationEpisodes = activeResult.episodes;
    completedObservationEpisodes = completedResult.episodes;
    error = activeResult.error ?? completedResult.error;

    const activeResidentIds = activeObservationEpisodes.map((e) => e.resident_id);
    if (activeResidentIds.length > 0) {
      // Default to the last 3 days when no filter is set.
      const obsWindow = defaultWindow(3);

      const chartsResult = await getObservationChartsForResidents({
        residentIds: activeResidentIds,
        start: startDate || obsWindow.start,
        end: endDate || obsWindow.end,
        excludedBranchIds,
        branchId: branchFilter,
      });
      observationEntries = chartsResult.entries;
      error = error ?? chartsResult.error;
    }
  } else if (currentTab === "behaviour-chart") {
    const [chartsResult, episodesResult] = await Promise.all([
      getBehaviourCharts({ residentId: residentFilter, start: startDate, end: endDate, excludedBranchIds, branchId: branchFilter, limit: REPORT_LIMIT }),
      residentFilter
        ? getBehaviourEpisodes({ residentId: residentFilter, start: startDate, end: endDate, excludedBranchIds })
        : { episodes: [], error: null },
    ]);
    behaviourEntries = chartsResult.entries;
    behaviourEpisodes = episodesResult.episodes;
    error = chartsResult.error ?? episodesResult.error;
    truncated = chartsResult.truncated;
  }

  return (
    <div>
      <PageTitle title={t("Clinical")} />

      <ClinicalContent
        residents={residents || []}
        branches={branches}
        currentBranch={branchFilter ? String(branchFilter) : ""}
        allStaff={allStaff}
        nursingStaff={nursingStaff}
        vitals={vitals}
        notes={notes}
        nursingChartEntries={nursingChartEntries}
        nursingChartLookups={nursingChartLookups}
        feedingTypes={feedingTypes}
        referrals={referrals}
        woundSessions={woundSessions}
        woundBodyParts={woundBodyParts}
        observationEntries={observationEntries}
        activeObservationEpisodes={activeObservationEpisodes}
        completedObservationEpisodes={completedObservationEpisodes}
        behaviourEntries={behaviourEntries}
        behaviourEpisodes={behaviourEpisodes}
        currentResident={residentFilter}
        currentStart={appliedStart}
        currentEnd={appliedEnd}
        currentPrev={prevParam}
        error={error}
        truncated={truncated}
      />
    </div>
  );
}
