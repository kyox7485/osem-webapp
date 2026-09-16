import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { redirect } from "next/navigation";
import { VitalsTable } from "./vitals-table";

export default async function VitalsPage({
  searchParams,
}: {
  searchParams: Promise<{ resident?: string; start?: string; end?: string }>;
}) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const params = await searchParams;
  const residentFilter = params.resident || "";
  const startDate = params.start || "";
  const endDate = params.end || "";

  const supabase = await createClient();

  // Fetch residents for filter dropdown
  let residentQuery = supabase
    .from("tbl_residents")
    .select("id, resident_name, branch_id")
    .eq("status", "ACTIVE")
    .order("resident_name");

  if (account.rights !== "ADMIN") {
    residentQuery = residentQuery.eq("branch_id", account.branch_id);
  }

  const { data: residents } = await residentQuery;

  // Fetch vitals with filters
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

  if (residentFilter) {
    vitalsQuery = vitalsQuery.eq("resident_id", parseInt(residentFilter));
  }

  if (startDate) {
    vitalsQuery = vitalsQuery.gte("entry_timestamp", `${startDate}T00:00:00`);
  }

  if (endDate) {
    vitalsQuery = vitalsQuery.lte("entry_timestamp", `${endDate}T23:59:59`);
  }

  const { data: rawVitals, error } = await vitalsQuery;

  // Supabase returns arrays for joins, transform to expected shape
  const vitals = (rawVitals || []).map((v: any) => ({
    ...v,
    tbl_residents: Array.isArray(v.tbl_residents) ? v.tbl_residents[0] : v.tbl_residents,
    tbl_staff: Array.isArray(v.tbl_staff) ? v.tbl_staff[0] : v.tbl_staff,
  }));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Vital Signs</h1>
      </div>

      <VitalsTable
        vitals={vitals || []}
        residents={residents || []}
        currentResident={residentFilter}
        currentStart={startDate}
        currentEnd={endDate}
        error={error?.message || null}
      />
    </div>
  );
}
