"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";

function optional(value: FormDataEntryValue | null): string | null {
  const s = value?.toString().trim();
  return s ? s : null;
}

export async function createProgressNote(residentId: number, formData: FormData) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const progressNote = optional(formData.get("progress_note"));
  if (!progressNote) {
    return { error: "Progress note is required" };
  }

  // tbl_staff's PK is a text code (e.g. "AMN-1"), not a bigint.
  const staffIdRaw = optional(formData.get("staff_id"));
  const staffIdOther = staffIdRaw === "__others__" ? optional(formData.get("staff_id_other")) : null;
  const staffId = staffIdRaw === "__others__" ? null : staffIdRaw;
  if (!staffId && !staffIdOther) {
    return { error: "Select who's entering this note" };
  }

  const supabase = await createClient();

  // Use the resident's own branch, not the logged-in account's -- they
  // differ whenever an admin/management account (not scoped to one branch)
  // is entering a note for a resident elsewhere.
  const { data: resident, error: residentError } = await supabase
    .from("tbl_residents")
    .select("branch_id")
    .eq("id", residentId)
    .single();

  if (residentError || !resident) {
    return { error: residentError?.message ?? "Resident not found" };
  }

  const { error } = await supabase.from("tbl_progress_notes").insert({
    branch_id: resident.branch_id,
    resident_id: residentId,
    progress_note: progressNote,
    physical_examination: optional(formData.get("physical_examination")),
    medical_plan: optional(formData.get("medical_plan")),
    nursing_plan: optional(formData.get("nursing_plan")),
    feeding_plan: optional(formData.get("feeding_plan")),
    monitoring_plan: optional(formData.get("monitoring_plan")),
    // created_by references tbl_staff -- the explicitly-picked person, not
    // the (possibly shared) login account.
    created_by: staffId,
    created_by_other: staffIdOther,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/residents/${residentId}/progress-notes`);
}
