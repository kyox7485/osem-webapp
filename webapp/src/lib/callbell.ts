import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { type CurrentUser } from "@/lib/current-user";

// Call Bell (Wenze L5070 receivers) has no per-account grant anywhere in the
// schema -- cb_receivers.branch_id is the only link back to OSEM. So visibility
// is derived from hardware: a login sees the module when it is based at HQ
// (which is also where receivers get registered, so HQ must see the module even
// before its own branch has one) or when its own branch has at least one
// registered receiver.
//
// The read uses the service-role client (not the caller's session client)
// because the callbell pages themselves query receivers through it; RLS on
// cb_receivers would otherwise decide visibility differently from the page.

/**
 * Sidebar gate for the Call Bell module.
 *
 * True for any HQ-function login, otherwise true only when the account's own
 * branch has a row in cb_receivers. A branch with no receiver -- and a physio
 * hub that has never registered one -- does not see the module at all.
 *
 * Returns false (rather than throwing) if the query fails, so a transient
 * database error hides a navigation link instead of breaking the whole layout.
 */
export async function hasCallbellAccess(account: CurrentUser | null): Promise<boolean> {
  if (!account) return false;
  if (account.branch_function === "HQ") return true;

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("cb_receivers")
    .select("id")
    .eq("branch_id", account.branch_id)
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}
