import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { getAllStaffWithBranch } from "@/lib/lookups";
import { redirect } from "next/navigation";
import { ClinicalContent } from "./clinical-content";

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
  const currentTab = params.tab || "vitals";
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

  const [{ data: residents }, allStaff] = await Promise.all([residentQuery, getAllStaffWithBranch()]);

  // Fetch data based on active tab
  let vitals = [];
  let notes = [];
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

    vitals = (rawVitals || []).map((v: any) => ({
      ...v,
      tbl_residents: Array.isArray(v.tbl_residents) ? v.tbl_residents[0] : v.tbl_residents,
      tbl_staff: Array.isArray(v.tbl_staff) ? v.tbl_staff[0] : v.tbl_staff,
    }));

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
        currentResident={residentFilter}
        currentStart={startDate}
        currentEnd={endDate}
        error={error}
      />
    </div>
  );
}
