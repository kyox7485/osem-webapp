"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
async function requireAdmin() {
  const account = await getCurrentUser();
  if (!account) redirect("/login");
  if (!isAdmin(account)) {
    return { error: "Only admins can manage staff" };
  }
  return null;
}

export async function createStaff(formData: FormData) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const payload = buildStaffPayload(formData);

  if (!payload.staff_name || !payload.position_id || !payload.branch_id || !payload.role || !payload.department) {
    return { error: "Name, position, branch, role, and department are required" };
  }

  const { data, error } = await supabase.from("tbl_staff").insert(payload).select("id:StaffID").single();
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
