import { createClient } from "@/lib/supabase/server";
import { formatBranch } from "@/lib/lookups";

// The signed-in login account (tbl_user_accounts), NOT the clinical/audit
// roster (tbl_staff) -- those are deliberately separate. This is what RLS
// actually reads: branch scoping and rights come from here.
//
// Logins can be shared by multiple people at a branch, so this identifies
// "which branch/rights is this session scoped to" -- NOT "who is the real
// person performing this action". Forms that need the latter (progress
// notes, resident admission, etc.) carry their own explicit staff-picker
// field; never attribute an entry to account.id or assume the logged-in
// account maps 1:1 to a person.
export type Rights = "ADMIN" | "MODERATOR" | "STAFF";

export type CurrentUser = {
  id: number;
  username: string;
  email: string;
  rights: Rights;
  branch_id: number;
  branch_name: string;
  // tbl_branches.Function: "NUR" (a residential/nursing branch), "PHY" (a
  // standalone physio hub, e.g. AMP), "HQ". Lets physiotherapy-module
  // access rules key off "is this account based at the physio hub" without
  // hardcoding a branch id -- see lib/physio-scoring's PHYSIO_HUB check.
  branch_function: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("tbl_user_accounts")
    .select("id, username, email, rights, branch_id, tbl_branches(locale:BranchLocale, code:BranchCode, function:Function)")
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
    branch_name: branch ? formatBranch(branch) : "",
    branch_function: branch?.function ?? null,
  };
}

export function isAdmin(account: CurrentUser | null): boolean {
  return account?.rights === "ADMIN";
}

// True for accounts that may access OP physiotherapy and the Analytics dashboard.
// Physio-hub accounts (PHY-function branch) and ADMINs only.
export function canAccessPhysioOp(account: CurrentUser | null): boolean {
  if (!account) return false;
  return account.rights === "ADMIN" || account.branch_function === "PHY";
}
