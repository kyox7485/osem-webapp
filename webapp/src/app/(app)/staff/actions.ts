"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, isAdmin } from "@/lib/current-user";

function buildStaffPayload(formData: FormData) {
  return {
    staff_name: (formData.get("staff_name") as string)?.trim(),
    position_id: parseInt(formData.get("position_id") as string, 10),
    branch_id: parseInt(formData.get("branch_id") as string, 10),
    role: formData.get("role") as string,
    department: (formData.get("department") as string) || null,
    status: (formData.get("status") as string) || "ACTIVE",
  };
}

// RLS (staff_write policy) is the real enforcement here -- a non-admin's
// insert/update is rejected by Postgres regardless of what the UI shows.
// This check just gives a clean error message instead of a raw RLS failure.
//
// Still ADMIN-only: the branch SCOPE of a roster entry is admin territory. A
// non-admin may CREATE (see createStaff) but never retarget or edit a row.
async function requireAdmin() {
  const account = await getCurrentUser();
  if (!account) redirect("/login");
  if (!isAdmin(account)) {
    return { error: "Only admins can manage staff" };
  }
  return null;
}

// Signed-in, but nothing more. Every login gets here; the branch scoping
// below is what actually limits a non-admin, not this gate.
async function requireLogin() {
  const account = await getCurrentUser();
  if (!account) redirect("/login");
  return account;
}

export async function createStaff(formData: FormData) {
  const account = await requireLogin();
  const admin = isAdmin(account);

  const supabase = await createClient();
  const payload = buildStaffPayload(formData);

  // Scope, not trust. A non-admin's branch_id and role are re-derived from the
  // session and whatever the form posted is discarded, so a hand-crafted POST
  // cannot create staff at another branch or hand itself ADMIN rights.
  // Note these are tbl_staff.role (a label on the roster row) -- login rights
  // live on tbl_user_accounts and remain ADMIN-only under /accounts.
  if (!admin) {
    payload.branch_id = account.branch_id;
    payload.role = "STAFF";
  }

  if (!payload.staff_name || !payload.position_id || !payload.branch_id || !payload.role || !payload.department) {
    return { error: "Name, position, branch, role, and department are required" };
  }

  // Non-admins go through the service-role client on purpose: the staff_write
  // RLS policy is ADMIN-only, so the session client would reject this insert
  // even though the branch scoping above already confines it. The scope is
  // enforced here in the action, one layer above RLS -- the same trade
  // lib/admin-records.ts makes for HQ-ADMIN record corrections.
  const writer = admin ? supabase : createAdminClient();

  const { data, error } = await writer.from("tbl_staff").insert(payload).select("id:StaffID").single();
  if (error) return { error: error.message };

  revalidatePath("/staff");
  redirect(`/staff/${data.id}`);
}

export async function updateStaff(staffId: string, formData: FormData) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const payload = buildStaffPayload(formData);

  if (!payload.staff_name || !payload.position_id || !payload.branch_id || !payload.role || !payload.department) {
    return { error: "Name, position, branch, role, and department are required" };
  }

  const { error } = await supabase.from("tbl_staff").update(payload).eq("StaffID", staffId);
  if (error) return { error: error.message };

  revalidatePath("/staff");
  revalidatePath(`/staff/${staffId}`);
  redirect(`/staff/${staffId}`);
}
