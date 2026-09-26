"use server";

// HQ-ADMIN record correction: Edit / Delete for every clinical, physio,
// medication and consumables record. The buttons are only rendered for an
// HQ ADMIN (components/admin-record-controls.tsx), but that is cosmetic --
// every action below re-checks isHqAdmin() server-side, so no other login
// can call these even by crafting a request.
//
// Plain Supabase records are written with the service-role client because
// tbl_observation_charts / tbl_behaviour_charts have no UPDATE/DELETE RLS
// policy at all (INSERT/SELECT only). Safety comes from (1) the HQ-ADMIN
// check, (2) the per-kind column whitelist in lib/admin-records.ts, and
// (3) the DEMO isolation check below.
//
// Sheet-first records (medication orders/stock, consumable counts) are never
// written to Supabase here -- they go through Apps Script (AdminEdit.gs),
// which edits the Sheet and then mirrors to Supabase (docs/medication.md,
// docs/medication-stock.md, docs/consumables.md).

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, isHqAdmin } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { deleteWoundPhotoFromDrive } from "@/lib/google-drive";
import {
  adminDeleteConsumableCount,
  adminDeleteMedicationOrder,
  adminDeleteMedicationStockEntry,
  adminUpdateConsumableCount,
  adminUpdateMedicationStockEntry,
  type AdminConsumableSheetFields,
  type AdminStockSheetFields,
} from "@/lib/medication-orders-script";
import { toSheetStockDate } from "@/lib/medication-stock";
import {
  ADMIN_RECORDS,
  fromKlInputValue,
  type AdminField,
  type AdminRecordKind,
} from "@/lib/admin-records";

export type AdminActionResult = { success: boolean; error?: string };
export type AdminFormValue = string | boolean | string[] | null;

const TABLES: Record<AdminRecordKind, string> = {
  progress_note: "tbl_progress_notes",
  nursing_chart: "tbl_nursing_chart_entries",
  vital: "tbl_vital",
  observation_chart: "tbl_observation_charts",
  behaviour_chart: "tbl_behaviour_charts",
  wound_session: "tbl_wound_sessions",
  wound_photo: "tbl_wound_photos",
  hospital_referral: "tbl_hospital_referrals",
  physio_assessment: "physio_assessments",
  medication_order: "tbl_medication_orders",
  medication_stock: "tbl_medication_stock",
  consumable_count: "tbl_resident_consumables",
};

function isKind(kind: string): kind is AdminRecordKind {
  return Object.prototype.hasOwnProperty.call(ADMIN_RECORDS, kind);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Authorises the caller and loads the target row's branch (+ the columns a
// Sheet-first action needs). DEMO isolation: a real-branch account may never
// touch DEMO rows and vice versa (CLAUDE.md -- getDemoBranchIds is always
// called unconditionally).
async function authorise(kind: string, id: number, extraColumns = "") {
  const account = await getCurrentUser();
  if (!account) return { error: "Not authenticated" } as const;
  if (!isHqAdmin(account)) return { error: "Only an HQ administrator can edit or delete records" } as const;
  if (!isKind(kind)) return { error: "Unknown record type" } as const;
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid record id" } as const;

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from(TABLES[kind])
    .select(`id, branch_id${extraColumns ? `, ${extraColumns}` : ""}`)
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message } as const;
  if (!row) return { error: "Record not found -- it may already have been deleted" } as const;

  const record = row as unknown as Record<string, unknown> & { branch_id: number };
  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  if (demoBranchIds.includes(Number(record.branch_id)) !== isDemoUser) {
    return { error: "Record not found -- it may already have been deleted" } as const;
  }

  return { kind, admin, record } as const;
}

// Turns the dialog's raw values into a column patch, dropping anything not in
// the kind's whitelist and validating each value against its field type.
async function buildPatch(
  fields: AdminField[],
  values: Record<string, AdminFormValue>,
  admin: ReturnType<typeof createAdminClient>
): Promise<{ patch: Record<string, unknown> } | { error: string }> {
  const patch: Record<string, unknown> = {};
  const staffIds: string[] = [];

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(values, field.name)) continue;
    const raw = values[field.name];
    let value: unknown;

    switch (field.type) {
      case "boolean":
        value = raw === true || raw === "true";
        break;
      case "multiselect": {
        const list = Array.isArray(raw) ? raw : [];
        const allowed = new Set((field.options ?? []).map((o) => o.value));
        value = list.filter((v) => allowed.has(v));
        break;
      }
      case "number": {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (!text) {
          value = null;
          break;
        }
        const n = Number(text);
        if (!Number.isFinite(n)) return { error: `${field.label} must be a number` };
        if (field.min !== undefined && n < field.min) return { error: `${field.label} must be at least ${field.min}` };
        if (field.max !== undefined && n > field.max) return { error: `${field.label} must be at most ${field.max}` };
        value = n;
        break;
      }
      case "datetime": {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (text && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return { error: `${field.label} is not a valid date/time` };
        value = fromKlInputValue(text);
        break;
      }
      case "time": {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (text && !/^\d{2}:\d{2}(:\d{2})?$/.test(text)) return { error: `${field.label} is not a valid time` };
        value = text || null;
        break;
      }
      default: {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (field.type === "select" && text && !(field.options ?? []).some((o) => o.value === text)) {
          return { error: `${field.label}: invalid option` };
        }
        if (field.type === "staff" && text) staffIds.push(text);
        value = text ? (field.numeric ? Number(text) : text) : null;
      }
    }

    if (field.required && (value === null || value === undefined)) return { error: `${field.label} is required` };
    patch[field.name] = value;
  }

  if (staffIds.length) {
    const unique = [...new Set(staffIds)];
    const { data } = await admin.from("tbl_staff").select("StaffID").in("StaffID", unique);
    const found = new Set((data ?? []).map((s) => s.StaffID));
    if (unique.some((s) => !found.has(s))) return { error: "Selected staff member was not found" };
  }

  return { patch };
}

function revalidateAll() {
  revalidatePath("/clinical");
  revalidatePath("/physiotherapy");
  revalidatePath("/residents", "layout");
}

export async function adminUpdateRecordAction(
  kind: string,
  id: number,
  values: Record<string, AdminFormValue>
): Promise<AdminActionResult> {
  try {
    const extra =
      kind === "medication_stock" || kind === "consumable_count" ? "external_ref_id" : "";
    const auth = await authorise(kind, id, extra);
    if ("error" in auth) return { success: false, error: auth.error };

    const config = ADMIN_RECORDS[auth.kind];
    if (config.fields.length === 0) return { success: false, error: "This record type cannot be edited here" };

    const built = await buildPatch(config.fields, values ?? {}, auth.admin);
    if ("error" in built) return { success: false, error: built.error };
    const patch = built.patch;
    if (Object.keys(patch).length === 0) return { success: true };

    if (auth.kind === "medication_stock") {
      const fields: AdminStockSheetFields = {};
      if ("balance" in patch) fields.Balance = patch.balance as number;
      if ("unit" in patch) fields.Unit = patch.unit as string;
      if ("entry_type" in patch) fields.EntryType = patch.entry_type as AdminStockSheetFields["EntryType"];
      if ("registered_by" in patch) fields.RegisteredBy = (patch.registered_by as string | null) ?? "";
      if ("stock_date" in patch) fields.StockDate = toSheetStockDate(new Date(patch.stock_date as string));
      await adminUpdateMedicationStockEntry(String(auth.record.external_ref_id), fields);
    } else if (auth.kind === "consumable_count") {
      const fields: AdminConsumableSheetFields = {};
      if ("current_stock" in patch) fields.CurrentStock = patch.current_stock as number;
      if ("supplier" in patch) fields.Supplier = patch.supplier as AdminConsumableSheetFields["Supplier"];
      if ("counted_by" in patch) fields.CountedBy = patch.counted_by as string;
      if ("last_count" in patch) fields.LastCount = toSheetStockDate(new Date(patch.last_count as string));
      await adminUpdateConsumableCount(String(auth.record.external_ref_id), fields);
    } else {
      const { error } = await auth.admin.from(TABLES[auth.kind]).update(patch).eq("id", id);
      if (error) return { success: false, error: error.message };
    }

    revalidateAll();
    return { success: true };
  } catch (err) {
    console.error(`adminUpdateRecordAction(${kind}, ${id}) failed:`, err);
    return { success: false, error: errorMessage(err) };
  }
}

export async function adminDeleteRecordAction(kind: string, id: number): Promise<AdminActionResult> {
  try {
    const extra =
      kind === "medication_order" || kind === "medication_stock" || kind === "consumable_count"
        ? "external_ref_id"
        : kind === "wound_photo"
          ? "drive_file_id"
          : "";
    const auth = await authorise(kind, id, extra);
    if ("error" in auth) return { success: false, error: auth.error };
    const { admin, record } = auth;

    switch (auth.kind) {
      case "medication_order": {
        // A later revision chains to this row via previous_order_id; deleting
        // it would break that audit link (and the FK), so newest-first only.
        const { count } = await admin
          .from("tbl_medication_orders")
          .select("id", { count: "exact", head: true })
          .eq("previous_order_id", id);
        if (count && count > 0) {
          return { success: false, error: "A later revision of this order exists -- delete that revision first" };
        }
        await adminDeleteMedicationOrder(String(record.external_ref_id));
        break;
      }
      case "medication_stock":
        await adminDeleteMedicationStockEntry(String(record.external_ref_id));
        break;
      case "consumable_count":
        await adminDeleteConsumableCount(String(record.external_ref_id));
        break;
      case "wound_photo": {
        // Drive file is trashed (recoverable), never permanently destroyed.
        await deleteWoundPhotoFromDrive(String(record.drive_file_id));
        const { error } = await admin.from("tbl_wound_photos").delete().eq("id", id);
        if (error) return { success: false, error: error.message };
        break;
      }
      case "wound_session": {
        const { data: photos } = await admin.from("tbl_wound_photos").select("drive_file_id").eq("session_id", id);
        for (const photo of photos ?? []) {
          await deleteWoundPhotoFromDrive(photo.drive_file_id);
        }
        // tbl_wound_photos cascades on session delete.
        const { error } = await admin.from("tbl_wound_sessions").delete().eq("id", id);
        if (error) return { success: false, error: error.message };
        break;
      }
      default: {
        // Child rows (nursing chart meals/hygiene/elimination, behaviour
        // episodes, physio assessment sections) cascade in the database.
        const { error } = await admin.from(TABLES[auth.kind]).delete().eq("id", id);
        if (error) return { success: false, error: error.message };
      }
    }

    revalidateAll();
    return { success: true };
  } catch (err) {
    console.error(`adminDeleteRecordAction(${kind}, ${id}) failed:`, err);
    return { success: false, error: errorMessage(err) };
  }
}

// Loads the whitelisted columns of one record for the edit dialog, straight
// from the database -- list views often don't load every editable column,
// so the dialog never pre-fills from (possibly partial) display data.
export async function adminGetRecordAction(
  kind: string,
  id: number
): Promise<{ success: boolean; error?: string; values?: Record<string, unknown> }> {
  try {
    if (!isKind(kind)) return { success: false, error: "Unknown record type" };
    const columns = ADMIN_RECORDS[kind].fields.map((f) => f.name).join(", ");
    const auth = await authorise(kind, id, columns);
    if ("error" in auth) return { success: false, error: auth.error };
    return { success: true, values: auth.record };
  } catch (err) {
    return { success: false, error: errorMessage(err) };
  }
}

// Staff picker options for the edit dialog: every ACTIVE, non-DEMO staff
// member (a physio hub's therapists document other branches' residents, so
// this is not narrowed to the record's branch).
export async function adminStaffOptionsAction(): Promise<{ value: string; label: string }[]> {
  const account = await getCurrentUser();
  if (!isHqAdmin(account)) return [];
  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = account ? demoBranchIds.includes(account.branch_id) : false;
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  const admin = createAdminClient();
  let query = admin.from("tbl_staff").select("StaffID, staff_name, branch_id").eq("status", "ACTIVE");
  if (excludedBranchIds.length) query = query.not("branch_id", "in", `(${excludedBranchIds.join(",")})`);
  const { data } = await query.order("staff_name");
  return (data ?? []).map((s) => ({ value: s.StaffID as string, label: s.staff_name as string }));
}
