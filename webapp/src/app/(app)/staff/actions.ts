"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentStaff, isAdmin } from "@/lib/current-staff";

function buildStaffPayload(formData: FormData) {
  return {
    staff_name: (formData.get("staff_name") as string)?.trim(),
    position_id: parseInt(formData.get("position_id") as string, 10),
    branch_id: parseInt(formData.get("branch_id") as string, 10),
    role: formData.get("role") as string,
    status: (formData.get("status") as string) || "ACTIVE",
  };
}

// RLS (staff_write policy) is the real enforcement here -- a non-admin's
// insert/update is rejected by Postgres regardless of what the UI shows.
// This check just gives a clean error message instead of a raw RLS failure.
async function requireAdmin() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (!isAdmin(staff)) {
    return { error: "Only admins can manage staff" };
  }
  return null;
}

export async function createStaff(formData: FormData) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const payload = buildStaffPayload(formData);

  if (!payload.staff_name || !payload.position_id || !payload.branch_id || !payload.role) {
    return { error: "Name, position, branch, and role are required" };
  }

  const { data, error } = await supabase.from("tbl_staff").insert(payload).select("id").single();
  if (error) return { error: error.message };

  revalidatePath("/staff");
  redirect(`/staff/${data.id}`);
}

export async function updateStaff(staffId: number, formData: FormData) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const payload = buildStaffPayload(formData);

  if (!payload.staff_name || !payload.position_id || !payload.branch_id || !payload.role) {
    return { error: "Name, position, branch, and role are required" };
  }

  const { error } = await supabase.from("tbl_staff").update(payload).eq("id", staffId);
  if (error) return { error: error.message };

  revalidatePath("/staff");
  revalidatePath(`/staff/${staffId}`);
  redirect(`/staff/${staffId}`);
}
