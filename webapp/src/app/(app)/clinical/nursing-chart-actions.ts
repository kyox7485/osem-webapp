"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { revalidatePath } from "next/cache";

type HygieneEpisodeInput = { assistanceLevel: "By Self" | "With Assistance"; activityIds: number[] };
type EliminationEpisodeInput = { bowelOutputIds: number[]; passUrineId: number | null };
type MealInput = {
  mealTypeId: number | null;
  mealTypeOther: string | null;
  mealPortionId: number | null;
  mealPortionOther: string | null;
  feedingTimeId: number | null;
  feedingVolume: string | null;
};

type CreateNursingChartEntryInput = {
  residentId: number;
  entryTimestamp: string;
  tubeFeeding: "Oral Feed" | "Tube Feeding" | null;
  eliminationEpisodes: EliminationEpisodeInput[];
  fluidInput: number | null;
  fluidOutput: number | null;
  cbdDrainage: string | null;
  activityIds: number[];
  activityOther: string | null;
  disturbanceLevelIds: number[];
  psychoSocialBehaviourIds: number[];
  psychoSocialOther: string | null;
  activeComplaintIds: number[];
  activeComplaintOther: string | null;
  intervention: string | null;
  doctorsPlan: string | null;
  createdBy: string;
  createdByOther?: string | null;
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

  if (!input.createdBy && !input.createdByOther) {
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
      fluid_input: input.fluidInput,
      fluid_output: input.fluidOutput,
      cbd_drainage: input.cbdDrainage,
      activity_ids: input.activityIds.length > 0 ? input.activityIds : null,
      activity_other: input.activityOther,
      disturbance_level_ids: input.disturbanceLevelIds.length > 0 ? input.disturbanceLevelIds : null,
      psycho_social_behaviour_ids: input.psychoSocialBehaviourIds.length > 0 ? input.psychoSocialBehaviourIds : null,
      psycho_social_other: input.psychoSocialOther,
      active_complaint_ids: input.activeComplaintIds.length > 0 ? input.activeComplaintIds : null,
      active_complaint_other: input.activeComplaintOther,
      intervention: input.intervention,
      doctors_plan: input.doctorsPlan,
      created_by: input.createdBy || null,
      created_by_other: input.createdByOther || null,
      reviewed_by: input.reviewedBy || null,
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

  const eliminationRows = input.eliminationEpisodes
    .filter((ep) => ep.bowelOutputIds.length > 0 || ep.passUrineId !== null)
    .map((ep) => ({
      branch_id: resident.branch_id,
      chart_entry_id: entryId,
      bowel_output_ids: ep.bowelOutputIds.length > 0 ? ep.bowelOutputIds : null,
      pass_urine_id: ep.passUrineId,
    }));
  if (eliminationRows.length > 0) {
    childInserts.push(supabase.from("tbl_nursing_chart_elimination_episodes").insert(eliminationRows));
  }

  const mealRows = input.meals
    .filter((m) => m.mealTypeId !== null || m.feedingTimeId !== null || m.feedingVolume !== null)
    .map((m) => ({
      branch_id: resident.branch_id,
      chart_entry_id: entryId,
      meal_type_id: m.mealTypeId,
      meal_type_other: m.mealTypeOther,
      meal_portion_id: m.mealPortionId,
      meal_portion_other: m.mealPortionOther,
      feeding_time_id: m.feedingTimeId,
      feeding_volume: m.feedingVolume,
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

// Carries the tube feeding regime comment forward onto a new entry's form so
// staff amend it rather than retype it every shift -- looks up the most
// recent meal row with a feeding_volume recorded for this resident, across
// any past entry, regardless of that entry's own meal count.
export async function getLastFeedingVolume(residentId: number): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_nursing_chart_meals")
    .select("feeding_volume, tbl_nursing_chart_entries!inner(resident_id, entry_timestamp)")
    .eq("tbl_nursing_chart_entries.resident_id", residentId)
    .not("feeding_volume", "is", null)
    .order("entry_timestamp", { referencedTable: "tbl_nursing_chart_entries", ascending: false })
    .limit(1);

  const row = data?.[0] as { feeding_volume: string | null } | undefined;
  return row?.feeding_volume ?? null;
}
