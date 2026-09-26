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

// True only for an ADMIN login based at an HQ-function branch. Gates the
// record-correction Edit/Delete buttons on every clinical/medication/
// consumables list (components/admin-record-controls.tsx) and the Server
// Actions behind them (app/(app)/admin-record-actions.ts). Deliberately
// narrower than isAdmin(): a branch-level ADMIN (e.g. the DEMO `test`
// account) does NOT get it.
export function isHqAdmin(account: { rights: string; branch_function: string | null } | null): boolean {
  return account?.rights === "ADMIN" && account.branch_function === "HQ";
}

// True when this account may see data across every real branch.
//
// The rule is driven by the branch's Function, NOT the rights tier:
//   Function = 'HQ'  -> all branches (headquarters oversees everything)
//   Function = 'PHY' -> all branches (a physio hub covers every NUR branch
//                       for inpatient work -- see getPhysioIpBranchIds in
//                       lib/lookups.ts, which encodes the same rule)
//   Function = 'NUR' -> own branch only, however high the rights tier
// ADMIN is unrestricted wherever it's based.
//
// This is deliberately NOT isAdmin(). isAdmin() gates login management
// (/accounts, staff create/edit) and stays ADMIN-only on purpose -- a
// moderator gets data authority, not authority over who can log in.
//
// A plain STAFF login at an HQ or PHY branch also gets all-branch scope.
// That is intentional: a physio hub has no residents of its own, and the
// physiotherapy module already treats a hub login as hub-wide. It is called
// out here so it stays a decision rather than a surprise.
//
// This mirrors the SQL helper auth_is_all_branch_account() in
// migration/scripts/scope_moderator_to_branch.sql -- keep the two in sync.
// RLS only guards the DATABASE; this is what the UI and Server Actions use.
//
// Takes the structural subset it actually needs, matching the signature of
// getPhysioIpBranchIds in lib/lookups.ts -- several physio call sites pass a
// narrow object rather than a full CurrentUser.
export function canAccessAllBranches(account: {
  rights: string;
  branch_function: string | null;
} | null): boolean {
  if (!account) return false;
  if (account.rights === "ADMIN") return true;
  return account.branch_function === "HQ" || account.branch_function === "PHY";
}

// True for accounts that may access OP physiotherapy and the Analytics dashboard.
// Physio-hub accounts (PHY-function branch) and ADMINs only.
export function canAccessPhysioOp(account: CurrentUser | null): boolean {
  if (!account) return false;
  return account.rights === "ADMIN" || account.branch_function === "PHY";
}
