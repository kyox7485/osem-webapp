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

export async function getBranches(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tbl_branches").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
}

// Used for "who actually did this" pickers on entry forms (progress notes,
// resident admission, etc.) -- branch logins can be shared, so the app
// never assumes the signed-in account is the real person; these forms ask
// explicitly instead. Scoped to one branch and active staff only.
export async function getStaffRoster(branchId: number): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_staff")
    .select("id, staff_name")
    .eq("branch_id", branchId)
    .eq("status", "ACTIVE")
    .order("staff_name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.staff_name }));
}

// Same idea as getStaffRoster, but unscoped + carries branch_id -- for forms
// (like resident admission) where the branch itself is also a form field, so
// filtering has to happen client-side as the user picks a branch.
export async function getAllStaffWithBranch(): Promise<(LookupOption & { branch_id: number })[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_staff")
    .select("id, staff_name, branch_id")
    .eq("status", "ACTIVE")
    .order("staff_name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.staff_name, branch_id: r.branch_id }));
}
