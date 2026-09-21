"use server";

import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import {
  createMedicationOrder,
  updateMedicationOrder,
} from "@/lib/medication-orders-script";

// Generates an 8-character lowercase hex ID and checks the Supabase mirror
// for collisions. The mirror's unique index on external_ref_id is the ground
// truth for whether an ID is already taken.
async function generateRxOrderId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = crypto.randomBytes(4).toString("hex");
    const { data } = await supabase
      .from("tbl_medication_orders")
      .select("id")
      .eq("external_ref_id", id)
      .maybeSingle();
    if (!data) return id;
  }
  throw new Error("Failed to generate unique RxOrderID after 10 attempts");
}

export type OrderFormValues = {
  residentId: string; // numeric tbl_residents.id as string
  dosageForm: string;
  brandName: string;
  activeIngredient: string;
  dose: string;
  unit: string;
  frequency: string;
  administrationTimes: string;
  dosingDays: string;
  indication: string;
  instruction: string;
  durationType: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD or ""
  notedBy: string;
  orderedBy: string;
  suppliedBy: string;
  status: string;
  previousRxOrderId: string;
};

export async function createOrderAction(
  values: OrderFormValues
): Promise<{ success: boolean; error?: string; rxOrderId?: string }> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  if (!values.activeIngredient?.trim())
    return { success: false, error: "Active ingredient is required" };
  if (!values.startDate)
    return { success: false, error: "Start date is required" };
  if (!values.orderedBy?.trim())
    return { success: false, error: "Ordered by is required" };
  if (!values.residentId)
    return { success: false, error: "Resident is required" };

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const residentQ: any = supabase
    .from("tbl_residents")
    .select("id, ResidentID, branch_id")
    .eq("id", parseInt(values.residentId))
    .single();
  const { data: resident } = await residentQ;

  if (!resident) return { success: false, error: "Resident not found" };
  if (!resident.ResidentID)
    return { success: false, error: "Resident has no ResidentID — cannot submit order" };

  const admin = isAdmin(account);

  if (!admin && resident.branch_id !== account.branch_id) {
    return { success: false, error: "Access denied" };
  }

  if (admin) {
    const demoBranchIds = await getDemoBranchIds();
    const isDemoUser = demoBranchIds.includes(account.branch_id);
    if (!isDemoUser && demoBranchIds.includes(resident.branch_id)) {
      return { success: false, error: "Access denied" };
    }
  }

  let rxOrderId: string;
  try {
    rxOrderId = await generateRxOrderId(supabase);
  } catch {
    return {
      success: false,
      error: "Failed to generate a unique order ID. Please try again.",
    };
  }

  try {
    await createMedicationOrder({
      RxOrderID: rxOrderId,
      ResidentID: resident.ResidentID,
      "Dosage Form": values.dosageForm || "",
      "Brand Name": values.brandName || "",
      "Active Ingredient": values.activeIngredient.trim(),
      Dose: values.dose || "",
      Unit: values.unit || "",
      Frequency: values.frequency || "",
      "Administration Times": values.administrationTimes || "",
      "Dosing Days": values.dosingDays || "",
      Indication: values.indication || "",
      Instruction: values.instruction || "",
      "Duration Type": values.durationType || "",
      "Start Date": values.startDate,
      "End Date": values.endDate || "",
      "Noted By": values.notedBy || "",
      "Ordered By": values.orderedBy.trim(),
      "Supplied By": values.suppliedBy || "",
      Status: values.status || "Active",
      PreviousRxOrderID: values.previousRxOrderId || "",
    });
  } catch (err) {
    console.error("createOrderAction — Apps Script error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to submit order",
    };
  }

  return { success: true, rxOrderId };
}

export async function updateOrderAction(
  rxOrderId: string,
  values: Omit<OrderFormValues, "residentId">
): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  if (!values.activeIngredient?.trim())
    return { success: false, error: "Active ingredient is required" };
  if (!values.startDate)
    return { success: false, error: "Start date is required" };
  if (!values.orderedBy?.trim())
    return { success: false, error: "Ordered by is required" };

  const supabase = await createClient();

  // Verify order exists and confirm access via the Supabase mirror.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingOrderQ: any = supabase
    .from("tbl_medication_orders")
    .select("id, branch_id")
    .eq("external_ref_id", rxOrderId)
    .single();
  const { data: existingOrder } = await existingOrderQ;

  if (!existingOrder) return { success: false, error: "Order not found" };

  const admin = isAdmin(account);

  if (!admin && existingOrder.branch_id !== account.branch_id) {
    return { success: false, error: "Access denied" };
  }

  if (admin) {
    const demoBranchIds = await getDemoBranchIds();
    const isDemoUser = demoBranchIds.includes(account.branch_id);
    if (!isDemoUser && demoBranchIds.includes(existingOrder.branch_id)) {
      return { success: false, error: "Access denied" };
    }
  }

  try {
    await updateMedicationOrder(rxOrderId, {
      "Dosage Form": values.dosageForm || "",
      "Brand Name": values.brandName || "",
      "Active Ingredient": values.activeIngredient.trim(),
      Dose: values.dose || "",
      Unit: values.unit || "",
      Frequency: values.frequency || "",
      "Administration Times": values.administrationTimes || "",
      "Dosing Days": values.dosingDays || "",
      Indication: values.indication || "",
      Instruction: values.instruction || "",
      "Duration Type": values.durationType || "",
      "Start Date": values.startDate,
      "End Date": values.endDate || "",
      "Noted By": values.notedBy || "",
      "Ordered By": values.orderedBy.trim(),
      "Supplied By": values.suppliedBy || "",
      Status: values.status || "Active",
      PreviousRxOrderID: values.previousRxOrderId || "",
    });
  } catch (err) {
    console.error("updateOrderAction — Apps Script error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update order",
    };
  }

  return { success: true };
}
