import { createClient } from "@/lib/supabase/server";

// The signed-in login account (tbl_user_accounts), NOT the clinical/audit
// roster (tbl_staff) -- those are deliberately separate. This is what RLS
// actually reads: branch scoping and rights come from here.
export type CurrentUser = {
  id: number;
  username: string;
  email: string;
  rights: string;
  branch_id: number;
  branch_name: string;
  // The tbl_staff row this login is attributed to, if any -- use THIS (not
  // `id`, which is a tbl_user_accounts id) for any reviewed_by/created_by
  // column, since those all reference tbl_staff.
  staff_id: number | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("tbl_user_accounts")
    .select("id, username, email, rights, branch_id, staff_id, tbl_branches(name)")
    .eq("auth_user_id", user.id)
    .single();

  if (error || !data) return null;

  const branch = Array.isArray(data.tbl_branches) ? data.tbl_branches[0] : data.tbl_branches;

  return {
    id: data.id,
    username: data.username,
    email: data.email,
    rights: data.rights,
    branch_id: data.branch_id,
    branch_name: branch?.name ?? "",
    staff_id: data.staff_id,
  };
}

export function isAdmin(account: CurrentUser | null): boolean {
  return account?.rights === "admin";
}
