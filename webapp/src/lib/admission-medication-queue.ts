// Server-only: the background queue behind New Resident admission
// medications (schema/023_admission_medication_queue.sql).
//
// createResident enqueues the drafts and redirects at once; the browser then
// calls POST /api/residents/admission-medications once per medication. Each
// call claims ONE row, creates its order (and initial stock) through the
// Apps Script bridge and records the outcome -- so a single request is ~one
// Apps Script round trip instead of the whole list, well inside Vercel's
// function limit. All queries use the caller's RLS-scoped client.

import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createMedicationOrder } from "@/lib/medication-orders-script";
import { recordStockEntryAction } from "@/app/(app)/residents/medication/stock/stock-actions";
import type { MedicationDraft } from "@/components/admission-medications";
import type {
  AdmissionMedQueueItem,
  AdmissionMedQueueStatus,
  AdmissionMedStockStatus,
} from "@/lib/admission-medication-queue-types";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Draft = Omit<MedicationDraft, "draftId">;

const TABLE = "tbl_admission_medication_queue";

// A "processing" row whose request died (tab closed mid-call, function
// killed) is reclaimable after this. Longer than Vercel's 300 s limit, so a
// live request can never have its row taken from under it.
const STALE_CLAIM_MS = 6 * 60 * 1000;

type QueueRow = {
  id: number;
  resident_id: number;
  position: number;
  rx_order_id: string;
  draft: Draft;
  status: AdmissionMedQueueStatus;
  order_done: boolean;
  stock_status: AdmissionMedStockStatus;
  attempts: number;
  last_error: string | null;
};

const ROW_COLUMNS =
  "id, resident_id, position, rx_order_id, draft, status, order_done, stock_status, attempts, last_error";

function draftLabel(d: Draft): string {
  const name = d.brandName?.trim() || d.activeIngredient?.trim() || "—";
  const strength = [d.dose, d.unit].filter((v) => v && String(v).trim()).join(" ");
  return strength ? `${name} ${strength}` : name;
}

function needsStock(d: Draft): boolean {
  const qty = d.stockQuantity ? parseFloat(d.stockQuantity) : NaN;
  return isFinite(qty) && qty > 0 && Boolean(d.stockUnit) && Boolean(d.stockRegisteredBy);
}

function toItem(r: QueueRow): AdmissionMedQueueItem {
  return {
    id: r.id,
    position: r.position,
    rxOrderId: r.rx_order_id,
    label: draftLabel(r.draft),
    status: r.status,
    orderDone: r.order_done,
    stockStatus: r.stock_status,
    lastError: r.last_error,
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function generateRxOrderIds(supabase: Supabase, count: number): Promise<string[]> {
  const ids = new Set<string>();
  for (let attempt = 0; attempt < 10 && ids.size < count; attempt++) {
    const candidates = Array.from({ length: (count - ids.size) * 2 }, () => crypto.randomBytes(4).toString("hex"))
      .filter((id) => !ids.has(id));
    const [{ data: orders }, { data: queued }] = await Promise.all([
      supabase.from("tbl_medication_orders").select("external_ref_id").in("external_ref_id", candidates),
      supabase.from(TABLE).select("rx_order_id").in("rx_order_id", candidates),
    ]);
    const taken = new Set([
      ...(orders ?? []).map((o: { external_ref_id: string }) => o.external_ref_id),
      ...(queued ?? []).map((q: { rx_order_id: string }) => q.rx_order_id),
    ]);
    for (const id of candidates) {
      if (ids.size >= count) break;
      if (!taken.has(id)) ids.add(id);
    }
  }
  if (ids.size < count) throw new Error("Failed to generate unique RxOrderIDs");
  return [...ids];
}

export async function enqueueAdmissionMedications(
  supabase: Supabase,
  args: { residentId: number; branchId: number; accountId: number; drafts: Draft[] }
): Promise<{ error?: string }> {
  if (args.drafts.length === 0) return {};
  try {
    const rxIds = await generateRxOrderIds(supabase, args.drafts.length);
    const rows = args.drafts.map((draft, i) => ({
      resident_id: args.residentId,
      branch_id: args.branchId,
      position: i,
      rx_order_id: rxIds[i],
      draft,
      stock_status: needsStock(draft) ? "pending" : "not_needed",
      created_by: args.accountId,
    }));
    const { error } = await supabase.from(TABLE).insert(rows);
    if (error) return { error: error.message };
    return {};
  } catch (err) {
    return { error: errorText(err) };
  }
}

export async function loadAdmissionMedicationQueue(
  supabase: Supabase,
  residentId: number
): Promise<AdmissionMedQueueItem[]> {
  const { data } = await supabase
    .from(TABLE)
    .select(ROW_COLUMNS)
    .eq("resident_id", residentId)
    .order("position");
  return ((data ?? []) as QueueRow[]).map(toItem);
}

// Residents this account admitted whose medications still need work, so the
// app layout can resume them after a closed tab / reload.
export async function loadOpenQueueResidents(
  supabase: Supabase,
  accountId: number
): Promise<{ residentId: number; residentName: string }[]> {
  const { data } = await supabase
    .from(TABLE)
    .select("resident_id, tbl_residents(resident_name)")
    .eq("created_by", accountId)
    .in("status", ["pending", "processing"])
    .limit(50);
  const byId = new Map<number, string>();
  for (const r of (data ?? []) as { resident_id: number; tbl_residents: unknown }[]) {
    const res = (Array.isArray(r.tbl_residents) ? r.tbl_residents[0] : r.tbl_residents) as
      | { resident_name?: string }
      | null;
    byId.set(r.resident_id, res?.resident_name ?? "");
  }
  return [...byId].map(([residentId, residentName]) => ({ residentId, residentName }));
}

async function markRow(supabase: Supabase, id: number, fields: Record<string, unknown>) {
  await supabase
    .from(TABLE)
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
}

// Claims the next open row for this resident and processes it. Returns false
// when there was nothing to claim.
export async function processNextAdmissionMedication(supabase: Supabase, residentId: number): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: candidates } = await supabase
    .from(TABLE)
    .select(ROW_COLUMNS)
    .eq("resident_id", residentId)
    .or(`status.eq.pending,and(status.eq.processing,claimed_at.lt.${staleBefore})`)
    .order("position")
    .limit(1);
  const candidate = (candidates as QueueRow[] | null)?.[0];
  if (!candidate) return false;

  // Compare-and-swap on attempts: if another tab claimed this row between
  // the select and here, attempts has already moved on and this matches 0 rows.
  const now = new Date().toISOString();
  const { data: claimedRows } = await supabase
    .from(TABLE)
    .update({ status: "processing", claimed_at: now, updated_at: now, attempts: candidate.attempts + 1 })
    .eq("id", candidate.id)
    .eq("attempts", candidate.attempts)
    .select(ROW_COLUMNS);
  const row = (claimedRows as QueueRow[] | null)?.[0];
  if (!row) return true; // lost the race -- report progress so the caller asks again

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("ResidentID")
    .eq("id", residentId)
    .single();
  if (!resident?.ResidentID) {
    await markRow(supabase, row.id, { status: "failed", last_error: "Resident has no ResidentID" });
    return true;
  }

  const draft = row.draft;

  if (!row.order_done) {
    try {
      // The RxOrderID was fixed at enqueue time, so re-sending an order that
      // already reached the Sheet is answered with alreadyExisted, not a duplicate.
      await createMedicationOrder({
        RxOrderID: row.rx_order_id,
        ResidentID: resident.ResidentID,
        "Dosage Form": draft.dosageForm,
        "Brand Name": draft.brandName,
        "Active Ingredient": draft.activeIngredient,
        Dose: draft.dose,
        Unit: draft.unit,
        Frequency: draft.frequency,
        "Administration Times": draft.administrationTimes,
        "Dosing Days": draft.dosingDays,
        Indication: draft.indication,
        Instruction: draft.instruction,
        "Duration Type": draft.durationType,
        "Start Date": draft.startDate,
        "End Date": draft.endDate,
        "Noted By": draft.notedBy,
        "Ordered By": draft.orderedBy,
        "Supplied By": draft.suppliedBy,
        Status: draft.status || "Active",
        PreviousRxOrderID: "",
      });
    } catch (err) {
      console.error(`[admission-med-queue] order ${row.rx_order_id} failed:`, err);
      await markRow(supabase, row.id, { status: "failed", last_error: `Order: ${errorText(err)}` });
      return true;
    }
    await markRow(supabase, row.id, { order_done: true });
  }

  if (row.stock_status === "pending" || row.stock_status === "failed") {
    const stockError = await recordInitialStock(supabase, row.rx_order_id, draft);
    if (stockError) {
      console.error(`[admission-med-queue] stock for ${row.rx_order_id} failed:`, stockError);
      await markRow(supabase, row.id, {
        status: "failed",
        order_done: true,
        stock_status: "failed",
        last_error: `Stock: ${stockError}`,
      });
      return true;
    }
  }

  await markRow(supabase, row.id, {
    status: "done",
    order_done: true,
    stock_status: row.stock_status === "not_needed" ? "not_needed" : "done",
    last_error: null,
    completed_at: new Date().toISOString(),
  });
  return true;
}

// Returns an error message, or null on success. A StockID is minted per call,
// so unlike the order this is not naturally idempotent: skip it when an
// initial "Stock Received" row for this order already reached Supabase.
async function recordInitialStock(supabase: Supabase, rxOrderId: string, draft: Draft): Promise<string | null> {
  const { data: order } = await supabase
    .from("tbl_medication_orders")
    .select("id")
    .eq("external_ref_id", rxOrderId)
    .maybeSingle();
  if (order) {
    const { data: existing } = await supabase
      .from("tbl_medication_stock")
      .select("id")
      .eq("medication_order_id", order.id)
      .eq("entry_type", "Stock Received")
      .limit(1);
    if (existing && existing.length > 0) return null;
  }

  try {
    const result = await recordStockEntryAction({
      rxOrderId,
      entryType: "Stock Received",
      quantity: parseFloat(draft.stockQuantity ?? ""),
      unit: draft.stockUnit ?? "",
      registeredBy: draft.stockRegisteredBy ?? "",
      entryDate: draft.stockEntryDate,
    });
    return result.success ? null : result.error ?? "Stock entry failed";
  } catch (err) {
    return errorText(err);
  }
}

// Puts a failed row back in the queue. The order step is skipped on the next
// run when it already succeeded, so Retry only redoes what actually failed.
export async function retryAdmissionMedication(supabase: Supabase, queueId: number): Promise<number | null> {
  const { data: row } = await supabase
    .from(TABLE)
    .select("id, resident_id, status, stock_status")
    .eq("id", queueId)
    .maybeSingle();
  if (!row || row.status !== "failed") return row?.resident_id ?? null;
  await markRow(supabase, queueId, {
    status: "pending",
    stock_status: row.stock_status === "failed" ? "pending" : row.stock_status,
  });
  return row.resident_id;
}
