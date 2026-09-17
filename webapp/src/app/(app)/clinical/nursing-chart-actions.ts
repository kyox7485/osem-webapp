"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { revalidatePath } from "next/cache";

type HygieneEpisodeInput = { assistanceLevel: "By Self" | "With Assistance"; activityIds: number[] };
type MealInput = { mealTypeId: number | null; mealPortionId: number | null; feedingTimeId: number | null };

type CreateNursingChartEntryInput = {
  residentId: number;
  entryTimestamp: string;
  tubeFeeding: "Oral Feed" | "Tube Feeding" | null;
  bowelOutputIds: number[];
  passUrineIds: number[];
  fluidInput: number | null;
  fluidOutput: number | null;
  cbdDrainage: string | null;
  activityIds: number[];
  disturbanceLevelIds: number[];
  psychoSocialBehaviourIds: number[];
  activeComplaintIds: number[];
  respirationRate: number | null;
  gcsEyeId: number | null;
  gcsVerbalId: number | null;
  gcsMotorId: number | null;
  avpuId: number | null;
  intervention: string | null;
  doctorsPlan: string | null;
  createdBy: string;
  reviewedBy: string | null;
  hygieneEpisodes: HygieneEpisodeInput[];
  meals: MealInput[];
};

export async function createNursingChartEntry(
  input: CreateNursingChartEntryInput
): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) {
    return { success: false, error: "Not authenticated" };
  }

  if (!input.createdBy) {
    return { success: false, error: "Please select who entered this" };
  }

  const supabase = await createClient();

  const { data: resident } = await supabase.from("tbl_residents").select("branch_id").eq("id", input.residentId).single();

  if (!resident) {
    return { success: false, error: "Resident not found" };
  }

  if (account.rights !== "ADMIN" && resident.branch_id !== account.branch_id) {
    return { success: false, error: "Access denied" };
  }

  const { data: entry, error: entryError } = await supabase
    .from("tbl_nursing_chart_entries")
    .insert({
      branch_id: resident.branch_id,
      resident_id: input.residentId,
      entry_timestamp: input.entryTimestamp,
      tube_feeding: input.tubeFeeding,
      bowel_output_ids: input.bowelOutputIds.length > 0 ? input.bowelOutputIds : null,
      pass_urine_ids: input.passUrineIds.length > 0 ? input.passUrineIds : null,
      fluid_input: input.fluidInput,
      fluid_output: input.fluidOutput,
      cbd_drainage: input.cbdDrainage,
      activity_ids: input.activityIds.length > 0 ? input.activityIds : null,
      disturbance_level_ids: input.disturbanceLevelIds.length > 0 ? input.disturbanceLevelIds : null,
      psycho_social_behaviour_ids: input.psychoSocialBehaviourIds.length > 0 ? input.psychoSocialBehaviourIds : null,
      active_complaint_ids: input.activeComplaintIds.length > 0 ? input.activeComplaintIds : null,
      respiration_rate: input.respirationRate,
      gcs_eye_id: input.gcsEyeId,
      gcs_verbal_id: input.gcsVerbalId,
      gcs_motor_id: input.gcsMotorId,
      avpu_id: input.avpuId,
      intervention: input.intervention,
      doctors_plan: input.doctorsPlan,
      created_by: input.createdBy,
      reviewed_by: input.reviewedBy,
    })
    .select("id")
    .single();

  if (entryError || !entry) {
    console.error("Failed to create nursing chart entry:", entryError);
    return { success: false, error: entryError?.message ?? "Failed to save entry" };
  }

  const entryId = entry.id;

  const childInserts: PromiseLike<{ error: { message: string } | null }>[] = [];

  const hygieneRows = input.hygieneEpisodes
    .filter((h) => h.activityIds.length > 0)
    .map((h) => ({
      branch_id: resident.branch_id,
      chart_entry_id: entryId,
      assistance_level: h.assistanceLevel,
      activity_ids: h.activityIds,
    }));
  if (hygieneRows.length > 0) {
    childInserts.push(supabase.from("tbl_nursing_chart_hygiene_episodes").insert(hygieneRows));
  }

  const mealRows = input.meals
    .filter((m) => m.mealTypeId !== null)
    .map((m) => ({
      branch_id: resident.branch_id,
      chart_entry_id: entryId,
      meal_type_id: m.mealTypeId,
      meal_portion_id: m.mealPortionId,
      feeding_time_id: m.feedingTimeId,
    }));
  if (mealRows.length > 0) {
    childInserts.push(supabase.from("tbl_nursing_chart_meals").insert(mealRows));
  }

  if (childInserts.length > 0) {
    const results = await Promise.all(childInserts);
    const failed = results.find((r) => r.error);
    if (failed) {
      console.error("Failed to save nursing chart child rows:", failed.error);
      // Best-effort cleanup so a partial save doesn't leave an orphan parent row.
      await supabase.from("tbl_nursing_chart_entries").delete().eq("id", entryId);
      return { success: false, error: failed.error?.message ?? "Failed to save entry details" };
    }
  }

  revalidatePath("/clinical");
  return { success: true };
}
