"use server";

import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { revalidatePath } from "next/cache";
import {
  createMedicationOrder,
  updateMedicationOrder,
  setMedicationOrderStatus,
} from "@/lib/medication-orders-script";
import { recordOrderChangedStock } from "@/lib/medication-stock-server";

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
  if (!values.notedBy?.trim()) return "Noted By is required";

  return null;
}

// Sheet-first status change (medication-orders.gs setOrderStatus): the Sheet
// is updated, then the same request syncs the row to Supabase and rebuilds
// current_medication_list. Writing Supabase alone never reached the Sheet
// (sync only runs Sheet → Supabase), so the next sync reverted it.
// Ids the Sheet doesn't have fall back to the old direct Supabase update so
// they don't stay Active forever.
async function discontinueOrders(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rxOrderIds: string[]
): Promise<void> {
  const result = await setMedicationOrderStatus(rxOrderIds, "Discontinued");
  const notFound = result.notFound ?? [];
  if (notFound.length > 0) {
    console.error("Orders not found in the Google Sheet; updating Supabase only:", notFound);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("tbl_medication_orders")
      .update({ status: "Discontinued" })
      .in("external_ref_id", notFound);
  }
}

// Discontinue a single order (status → Discontinued), Sheet first.
export async function discontinueOrderAction(
  rxOrderId: string
): Promise<{ success: boolean; error?: string }> {
  const account = await getCurrentUser();
  if (!account) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingOrder } = await (supabase as any)
    .from("tbl_medication_orders")
    .select("id, branch_id, status")
    .eq("external_ref_id", rxOrderId)
    .single();

  if (!existingOrder) return { success: false, error: "Order not found" };
  if (existingOrder.status !== "Active")
    return { success: false, error: "Order is not active" };

  const admin = canAccessAllBranches(account);
  if (!admin && existingOrder.branch_id !== account.branch_id)
    return { success: false, error: "Access denied" };

  if (admin) {
    const demoBranchIds = await getDemoBranchIds();
    const isDemoUser = demoBranchIds.includes(account.branch_id);
    if (!isDemoUser && demoBranchIds.includes(existingOrder.branch_id))
      return { success: false, error: "Access denied" };
  }

  try {
    await discontinueOrders(supabase, [rxOrderId]);
  } catch (err) {
    console.error("discontinueOrderAction — Apps Script error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to discontinue order",
    };
  }

  revalidatePath("/residents/medication/orders");
  revalidatePath("/residents/medication/stock");
  return { success: true };
}

// Auto-expire active orders whose end_date has passed.
// Called at page load. Only calls Apps Script when something has actually
// expired (usually nothing), then discontinues them Sheet first.
export async function autoExpireOrdersAction(branchId: number, adminUser: boolean, excludedBranchIds: number[]): Promise<void> {
  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (supabase as any)
    .from("tbl_medication_orders")
    .select("external_ref_id")
    .lt("end_date", today)
    .eq("status", "Active")
    .not("external_ref_id", "is", null);

  if (!adminUser) {
    q = q.eq("branch_id", branchId);
  } else if (excludedBranchIds.length > 0) {
    q = q.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
  }

  const { data } = await q;
  const expiredIds = ((data ?? []) as { external_ref_id: string }[]).map((r) => r.external_ref_id);
  if (expiredIds.length === 0) return;

  await discontinueOrders(supabase, expiredIds);
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

  const admin = canAccessAllBranches(account);

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
// and PreviousRxOrderID = rxOrderId, giving a full audit trail.
// All submitted form values (including dose, unit, frequency, etc.) are
// applied to the new revision row — the Apps Script INHERITED_ON_REVISION
// list has been cleared to allow full editing.
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

  const admin = canAccessAllBranches(account);

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

  // Carry the stock balance onto the new RxOrderID as "Order Changed".
  // Best-effort: never fails the order edit (it only logs).
  await recordOrderChangedStock({
    supabase,
    oldRxOrderId: rxOrderId,
    newRxOrderId,
    residentTextId: resident.ResidentID,
    newOrder: {
      dose: parseFloat(values.dose),
      unit: values.unit,
      frequency: values.frequency,
      administration_times: values.administrationTimes || null,
      dosing_days: values.dosingDays || null,
      start_date: values.startDate,
      end_date: values.endDate || null,
    },
    notedBy: values.notedBy || "",
  });
  revalidatePath("/residents/medication/stock");

  return { success: true, newRxOrderId };
}
