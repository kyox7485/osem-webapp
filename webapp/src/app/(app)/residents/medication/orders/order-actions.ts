"use server";

import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import {
  createMedicationOrder,
  updateMedicationOrder,
} from "@/lib/medication-orders-script";

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
  residentId: string;
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
  startDate: string;
  endDate: string;
  notedBy: string;
  orderedBy: string;
  suppliedBy: string;
  status: string;
};

function validateOrderFields(
  values: Omit<OrderFormValues, "residentId">
): string | null {
  if (!values.dosageForm?.trim()) return "Dosage form is required";
  if (!values.activeIngredient?.trim()) return "Active ingredient is required";

  const doseNum = parseFloat(values.dose ?? "");
  if (!values.dose?.trim() || isNaN(doseNum) || doseNum <= 0)
    return "A valid dose is required";

  if (!values.unit?.trim()) return "Unit is required";
  if (!values.frequency?.trim()) return "Frequency is required";

  if (values.frequency !== "PRN" && !values.administrationTimes?.trim())
    return "Administration times are required";

  if (
    (values.frequency === "Selected Days" || values.frequency === "Others") &&
    !values.dosingDays?.trim()
  )
    return "Dosing days are required";

  if (!values.durationType?.trim()) return "Duration type is required";

  if (values.durationType === "Short Term" && !values.endDate?.trim())
    return "End date is required for Short Term orders";

  if (!values.startDate?.trim()) return "Start date is required";
  if (!values.orderedBy?.trim()) return "Ordered by is required";
  if (!values.suppliedBy?.trim()) return "Supplied by is required";

  return null;
}

export async function createOrderAction(
  values: OrderFormValues
): Promise<{ success: boolean; error?: string; rxOrderId?: string }> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  if (!values.residentId)
    return { success: false, error: "Resident is required" };

  const validationError = validateOrderFields(values);
  if (validationError) return { success: false, error: validationError };

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
    return {
      success: false,
      error: "Resident has no ResidentID — cannot submit order",
    };

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
      "Dosage Form": values.dosageForm,
      "Brand Name": values.brandName || "",
      "Active Ingredient": values.activeIngredient.trim(),
      Dose: values.dose,
      Unit: values.unit,
      Frequency: values.frequency,
      "Administration Times": values.administrationTimes || "",
      "Dosing Days": values.dosingDays || "",
      Indication: values.indication || "",
      Instruction: values.instruction || "",
      "Duration Type": values.durationType,
      "Start Date": values.startDate,
      "End Date": values.endDate || "",
      "Noted By": values.notedBy || "",
      "Ordered By": values.orderedBy,
      "Supplied By": values.suppliedBy,
      Status: "Active",
      PreviousRxOrderID: "",
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

// An edit never overwrites the order in place. It discontinues the old row
// (rxOrderId) and appends a brand-new revision row with a fresh RxOrderID
// and PreviousRxOrderID = rxOrderId, giving a full audit trail — see
// medication-orders.gs's updateOrder. Note that Active Ingredient, Dosage
// Form, Dose, Unit, Frequency, Administration Times, Dosing Days,
// Indication, and Instruction are always carried over from the OLD row by
// Apps Script regardless of what's submitted here — they're locked in the
// edit form UI for the same reason (see order-form.tsx).
export async function updateOrderAction(
  rxOrderId: string,
  values: Omit<OrderFormValues, "residentId">
): Promise<{ success: boolean; error?: string; newRxOrderId?: string }> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  const validationError = validateOrderFields(values);
  if (validationError) return { success: false, error: validationError };

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingOrderQ: any = supabase
    .from("tbl_medication_orders")
    .select("id, branch_id, resident_id")
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

  // The new revision row needs the resident's Google-format ResidentID (the
  // sheet's own identifier), not the Supabase numeric id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const residentQ: any = supabase
    .from("tbl_residents")
    .select("ResidentID")
    .eq("id", existingOrder.resident_id)
    .single();
  const { data: resident } = await residentQ;

  if (!resident?.ResidentID) {
    return {
      success: false,
      error: "Resident has no ResidentID — cannot submit order",
    };
  }

  let newRxOrderId: string;
  try {
    newRxOrderId = await generateRxOrderId(supabase);
  } catch {
    return {
      success: false,
      error: "Failed to generate a unique order ID. Please try again.",
    };
  }

  try {
    await updateMedicationOrder(rxOrderId, {
      RxOrderID: newRxOrderId,
      ResidentID: resident.ResidentID,
      "Dosage Form": values.dosageForm,
      "Brand Name": values.brandName || "",
      "Active Ingredient": values.activeIngredient.trim(),
      Dose: values.dose,
      Unit: values.unit,
      Frequency: values.frequency,
      "Administration Times": values.administrationTimes || "",
      "Dosing Days": values.dosingDays || "",
      Indication: values.indication || "",
      Instruction: values.instruction || "",
      "Duration Type": values.durationType,
      "Start Date": values.startDate,
      "End Date": values.endDate || "",
      "Noted By": values.notedBy || "",
      "Ordered By": values.orderedBy,
      "Supplied By": values.suppliedBy,
      Status: "Active",
      PreviousRxOrderID: rxOrderId,
    });
  } catch (err) {
    console.error("updateOrderAction — Apps Script error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update order",
    };
  }

  return { success: true, newRxOrderId };
}
