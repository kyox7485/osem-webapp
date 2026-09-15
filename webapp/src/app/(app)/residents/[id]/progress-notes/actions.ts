"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";

function optional(value: FormDataEntryValue | null): string | null {
  const s = value?.toString().trim();
  return s ? s : null;
}

function optionalInt(value: FormDataEntryValue | null): number | null {
  const s = optional(value);
  return s ? parseInt(s, 10) : null;
}

export async function createProgressNote(residentId: number, formData: FormData) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const progressNote = optional(formData.get("progress_note"));
  if (!progressNote) {
    return { error: "Progress note is required" };
  }

  const staffId = optionalInt(formData.get("staff_id"));
  if (!staffId) {
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
    current_medication_regime: optional(formData.get("current_medication_regime")),
    tca_notes: optional(formData.get("tca_notes")),
    // created_by references tbl_staff -- the explicitly-picked person, not
    // the (possibly shared) login account.
    created_by: staffId,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/residents/${residentId}/progress-notes`);
}
