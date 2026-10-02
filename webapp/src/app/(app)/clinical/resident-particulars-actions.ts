"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDemoBranchIds } from "@/lib/lookups";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";

/**
 * Inline editing of the resident particulars surfaced on the Medical Progress
 * Notes → New Entry dashboard (medical/surgical history, known allergy, TCA
 * notes). Same authority as `createProgressNote` — anyone who can already see
 * the resident — deliberately NOT the HQ-ADMIN-only `admin-record-actions.ts`
 * framework (which also writes through the service role; this path uses the
 * caller's own client so RLS applies on top of the explicit checks).
 *
 * Structural safety -- no migration is needed or made here:
 *   - `allergy`, `past_medical_condition` and `tca_notes` are plain `text`
 *     columns on tbl_residents (schema/001_init.sql:638,639,649).
 *   - Coded diagnoses live in tbl_resident_diagnoses, which carries
 *     `unique (resident_id, diagnosis_option_id)`; that is why the update is
 *     delete-then-reinsert rather than upsert, which cannot express "the user
 *     unchecked this one". Shape copied from residents/actions.ts:309-324.
 *   - branch_id on the diagnosis rows is filled by
 *     fn_fill_resident_diagnosis_branch() on insert, so it is deliberately
 *     absent from the inserted payload.
 *   - Both tables are in fn_audit_trigger()'s list, so every edit lands in
 *     tbl_audit_log with old_data/new_data and changed_by automatically.
 */
export type ResidentParticularsInput =
  | { residentId: number; field: "allergy"; allergy: string | null }
  | { residentId: number; field: "tcaNotes"; tcaNotes: string | null }
  | {
      residentId: number;
      field: "medicalHistory";
      diagnosisOptionIds: number[];
      othersRemark: string | null;
      pastMedicalCondition: string | null;
    };

export async function updateResidentParticulars(
  input: ResidentParticularsInput
): Promise<{ success: boolean; error?: string }> {
  // getCurrentUser() takes zero arguments (CLAUDE.md).
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const residentId = Number(input.residentId);
  if (!Number.isInteger(residentId) || residentId <= 0) {
    return { success: false, error: "Invalid resident id" };
  }

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("branch_id")
    .eq("id", residentId)
    .single();
  if (!resident) return { success: false, error: "Resident not found" };

  // DEMO isolation is symmetric: a DEMO row is reachable only by a DEMO
  // account, and a real-branch account never touches a DEMO row.
  // getDemoBranchIds() is called unconditionally -- never gated on rights,
  // because the `test` account is itself ADMIN (docs/database.md).
  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  if (demoBranchIds.includes(Number(resident.branch_id)) !== isDemoUser) {
    return { success: false, error: "Access denied" };
  }
  if (!canAccessAllBranches(account) && resident.branch_id !== account.branch_id) {
    return { success: false, error: "Access denied" };
  }

  if (input.field === "allergy") {
    // Single-column patch on purpose. buildResidentPayload() in
    // residents/actions.ts writes ~20 columns and would blank everything this
    // call did not send.
    const { error } = await supabase
      .from("tbl_residents")
      .update({ allergy: input.allergy?.trim() || null })
      .eq("id", residentId);
    if (error) return { success: false, error: error.message };
  } else if (input.field === "tcaNotes") {
    const { error } = await supabase
      .from("tbl_residents")
      .update({ tca_notes: input.tcaNotes?.trim() || null })
      .eq("id", residentId);
    if (error) return { success: false, error: error.message };
  } else {
    const { error: textError } = await supabase
      .from("tbl_residents")
      .update({
        past_medical_condition: input.pastMedicalCondition?.trim() || null,
      })
      .eq("id", residentId);
    if (textError) return { success: false, error: textError.message };

    // Drop only the ids the caller submitted as valid options — a stale id in
    // the database (option deactivated since it was chosen) must not silently
    // delete every real diagnosis on this resident.
    const { data: knownOptions } = await supabase
      .from("tbl_diagnosis_options")
      .select("id, name_en");
    const optionById = new Map((knownOptions ?? []).map((o) => [o.id, o.name_en]));
    const requested = [...new Set(input.diagnosisOptionIds)].filter((id) =>
      optionById.has(id)
    );
    const othersId = (knownOptions ?? []).find((o) => o.name_en === "Others")?.id ?? null;

    const { error: deleteError } = await supabase
      .from("tbl_resident_diagnoses")
      .delete()
      .eq("resident_id", residentId);
    if (deleteError) return { success: false, error: deleteError.message };

    if (requested.length > 0) {
      // branch_id is intentionally omitted -- fn_fill_resident_diagnosis_branch()
      // fills it before insert.
      const rows = requested.map((diagnosisOptionId) => ({
        resident_id: residentId,
        diagnosis_option_id: diagnosisOptionId,
        remark: diagnosisOptionId === othersId ? input.othersRemark?.trim() || null : null,
      }));
      const { error: insertError } = await supabase
        .from("tbl_resident_diagnoses")
        .insert(rows);
      if (insertError) return { success: false, error: insertError.message };
    }
  }

  revalidatePath("/clinical");
  revalidatePath("/residents");
  revalidatePath(`/residents/${residentId}`);
  return { success: true };
}