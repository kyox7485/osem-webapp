"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/current-staff";

function optional(value: FormDataEntryValue | null): string | null {
  const s = value?.toString().trim();
  return s ? s : null;
}

export async function createProgressNote(residentId: number, formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const progressNote = optional(formData.get("progress_note"));
  if (!progressNote) {
    return { error: "Progress note is required" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tbl_progress_notes").insert({
    branch_id: staff.branch_id,
    resident_id: residentId,
    progress_note: progressNote,
    physical_examination: optional(formData.get("physical_examination")),
    medical_plan: optional(formData.get("medical_plan")),
    nursing_plan: optional(formData.get("nursing_plan")),
    feeding_plan: optional(formData.get("feeding_plan")),
    monitoring_plan: optional(formData.get("monitoring_plan")),
    current_medication_regime: optional(formData.get("current_medication_regime")),
    tca_notes: optional(formData.get("tca_notes")),
    created_by: staff.id,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/residents/${residentId}/progress-notes`);
}
