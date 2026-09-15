import { createClient } from "@/lib/supabase/server";

export type CurrentStaff = {
  id: number;
  staff_name: string;
  role: string;
  branch_id: number;
  branch_name: string;
};

// The caller's own tbl_staff row, via auth_user_id = auth.uid() (RLS already
// scopes this to "yourself" implicitly -- staff_read allows any
// authenticated user to read all staff rows, so we filter explicitly here).
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("tbl_staff")
    .select("id, staff_name, role, branch_id, tbl_branches(name)")
    .eq("auth_user_id", user.id)
    .single();

  if (error || !data) return null;

  const branch = Array.isArray(data.tbl_branches) ? data.tbl_branches[0] : data.tbl_branches;

  return {
    id: data.id,
    staff_name: data.staff_name,
    role: data.role,
    branch_id: data.branch_id,
    branch_name: branch?.name ?? "",
  };
}

export function isAdmin(staff: CurrentStaff | null): boolean {
  return staff?.role === "admin";
}
