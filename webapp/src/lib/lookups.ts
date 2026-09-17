import { createClient } from "@/lib/supabase/server";
import type { LookupOption } from "@/lib/types";

export async function getNationalities(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tbl_nationalities").select("id, country_name").order("country_name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.country_name }));
}

export async function getDietTypes(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tbl_diet_types").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
}

export async function getFeedingTypes(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tbl_feeding_types").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
}

export async function getPositions(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tbl_positions").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
}

// Branches are displayed everywhere as just "<BranchLocale>" (e.g. "ALMA")
// rather than the full BranchName -- shorter and matches how staff refer
// to branches day to day.
export function formatBranch(branch: { locale: string | null; code: string } | null | undefined): string {
  if (!branch) return "--";
  return branch.locale ?? branch.code;
}

// onlyFunction restricts to branches whose tbl_branches.Function matches
// (e.g. "NUR" for the resident-admission branch picker, which should only
// ever offer nursing branches -- "PHY" physiotherapy branches like AMP
// don't register residents). Omit for every branch, unfiltered.
export async function getBranches(onlyFunction?: string): Promise<LookupOption[]> {
  const supabase = await createClient();
  // tbl_branches' columns are PascalCase (BranchID/BranchLocale/BranchCode)
  // -- aliased back to lowercase here so nothing downstream has to know that.
  let query = supabase.from("tbl_branches").select("id:BranchID, locale:BranchLocale, code:BranchCode");
  if (onlyFunction) query = query.eq("Function", onlyFunction);
  const { data } = await query.order("BranchCode");
  return (data ?? []).map((r) => ({ id: r.id, label: formatBranch(r) }));
}

// A physio-hub branch (Function = "PHY", e.g. AMP) has no residents of its
// own -- its physiotherapists cover the residential (Function = "NUR")
// branches for inpatient work instead, and their own hub for outpatients.
// Used by the physiotherapy module's branch-scoping checks. Driven by the
// Function column rather than a hardcoded branch id, so a newly added
// nursing branch (or a second physio hub) is in scope automatically.
export async function getPhysioIpBranchIds(account: { branch_id: number; branch_function: string | null }): Promise<number[]> {
  if (account.branch_function !== "PHY") return [account.branch_id];
  const nurBranches = await getBranches("NUR");
  return nurBranches.map((b) => Number(b.id));
}

// Used for "who actually did this" pickers on entry forms (progress notes,
// resident admission, nursing chart entries, stock entries, etc.) -- branch
// logins can be shared, so the app never assumes the signed-in account is
// the real person; these forms ask explicitly instead. Scoped to one branch
// and active staff only.
//
// allowedRoles restricts which tbl_staff.role values can be picked on a
// given form -- e.g. a nursing chart entry passes ["STAFF"], a stock entry
// passes ["MODERATOR"]. ADMIN staff are always included regardless, since
// admins can act anywhere. Omit allowedRoles (or pass nothing) for a form
// with no role restriction, which includes every active role.
export async function getStaffRoster(branchId: number, allowedRoles?: string[]): Promise<LookupOption[]> {
  const supabase = await createClient();
  let query = supabase
    .from("tbl_staff")
    .select("id:StaffID, staff_name")
    .eq("branch_id", branchId)
    .eq("status", "ACTIVE");
  if (allowedRoles) query = query.in("role", [...new Set([...allowedRoles, "ADMIN"])]);
  const { data } = await query.order("staff_name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.staff_name }));
}

// Same idea as getStaffRoster, but unscoped + carries branch_id -- for forms
// (like resident admission) where the branch itself is also a form field, so
// filtering has to happen client-side as the user picks a branch.
//
// department restricts to a single tbl_staff.department (e.g. "Physiotherapy"
// for the physio assessment's "Documented by" picker) -- ADMIN staff are
// still always included regardless of department, same "admins can act
// anywhere" convention as allowedRoles below.
export async function getAllStaffWithBranch(
  allowedRoles?: string[],
  department?: string
): Promise<(LookupOption & { branch_id: number })[]> {
  const supabase = await createClient();
  let query = supabase.from("tbl_staff").select("id:StaffID, staff_name, branch_id").eq("status", "ACTIVE");
  if (allowedRoles) query = query.in("role", [...new Set([...allowedRoles, "ADMIN"])]);
  if (department) query = query.or(`department.eq.${department},role.eq.ADMIN`);
  const { data } = await query.order("staff_name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.staff_name, branch_id: r.branch_id }));
}
