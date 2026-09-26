// Server-only loaders for Consumables. Never import this from a "use client"
// component (it is used with the server Supabase client — see the Turbopack
// footgun in CLAUDE.md). Pure rules live in lib/consumables.ts.

import crypto from "crypto";
import type { createClient } from "@/lib/supabase/server";
import {
  isOtherItem,
  isSupplier,
  lineKey,
  type CatalogueItem,
  type ConsumableLine,
  type CountRecord,
  type StaffPick,
} from "@/lib/consumables";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type { StaffPick };

export async function loadCatalogue(supabase: Supabase): Promise<{ items: CatalogueItem[] } | { error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("tbl_consumable_master")
    .select("consumable_id, consumable, unit, max_stock, restock_required")
    .order("consumable_id");
  if (error) return { error: error.message };
  return {
    items: ((data ?? []) as {
      consumable_id: string;
      consumable: string;
      unit: string;
      max_stock: number | null;
      restock_required: boolean;
    }[]).map((r) => ({
      consumableId: r.consumable_id,
      consumable: r.consumable,
      unit: r.unit,
      maxStock: r.max_stock === null ? null : Number(r.max_stock),
      restockRequired: r.restock_required,
    })),
  };
}

type RecordRaw = {
  id: number;
  external_ref_id: string;
  resident_id: number;
  consumable_id: string;
  other_consumable: string | null;
  other_unit: string | null;
  supplier: string | null;
  current_stock: number;
  last_count: string;
  counted_by: string | null;
};

/**
 * Every count record for these residents, grouped into item lines (newest
 * count first). Paged, because a branch accumulates well over PostgREST's
 * 1000-row default within a year of weekly counts. A failed query returns
 * { error } — never an empty result that would read as "nothing to do".
 */
export async function loadResidentLines(
  supabase: Supabase,
  residentIds: number[],
  catalogue: CatalogueItem[]
): Promise<{ lines: Map<number, ConsumableLine[]> } | { error: string }> {
  const lines = new Map<number, ConsumableLine[]>();
  if (residentIds.length === 0) return { lines };

  const records: RecordRaw[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("tbl_resident_consumables")
      .select("id, external_ref_id, resident_id, consumable_id, other_consumable, other_unit, supplier, current_stock, last_count, counted_by")
      .in("resident_id", residentIds)
      .order("last_count", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return { error: error.message };
    records.push(...((data ?? []) as RecordRaw[]));
    if (!data || data.length < PAGE) break;
  }

  const staffIds = [...new Set(records.map((r) => r.counted_by).filter(Boolean))] as string[];
  const staffNames: Record<string, string> = {};
  if (staffIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("tbl_staff")
      .select("staff_name, StaffID")
      .in("StaffID", staffIds);
    for (const s of (data ?? []) as { staff_name: string; StaffID: string }[]) staffNames[s.StaffID] = s.staff_name;
  }

  const byId = new Map(catalogue.map((c) => [c.consumableId, c]));
  // Records arrive newest first, so the first one seen per line is current.
  const index = new Map<string, ConsumableLine>();
  for (const r of records) {
    const item = byId.get(r.consumable_id);
    if (!item) continue;
    const other = isOtherItem(item);
    const otherName = other ? (r.other_consumable ?? "").trim() || null : null;
    const key = lineKey(r.consumable_id, otherName);
    const count: CountRecord = {
      id: r.id,
      recordId: r.external_ref_id,
      currentStock: Number(r.current_stock),
      lastCount: r.last_count,
      supplier: isSupplier(r.supplier) ? r.supplier : null,
      countedByName: r.counted_by ? staffNames[r.counted_by] ?? r.counted_by : null,
    };
    const mapKey = `${r.resident_id}#${key}`;
    const existing = index.get(mapKey);
    if (existing) {
      existing.history.push(count);
      continue;
    }
    const line: ConsumableLine = {
      key,
      consumableId: r.consumable_id,
      name: other ? otherName ?? item.consumable : item.consumable,
      unit: other ? (r.other_unit ?? "").trim() || item.unit : item.unit,
      otherConsumable: otherName,
      otherUnit: other ? r.other_unit : null,
      isOther: other,
      maxStock: item.maxStock,
      restockRequired: item.restockRequired,
      supplier: count.supplier,
      currentStock: count.currentStock,
      lastCount: count.lastCount,
      lastCountedBy: count.countedByName,
      history: [count],
    };
    index.set(mapKey, line);
    const list = lines.get(r.resident_id) ?? [];
    list.push(line);
    lines.set(r.resident_id, list);
  }
  for (const list of lines.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return { lines };
}

/** ACTIVE staff of the branch + HQ (HQ staff also count stock). Own branch first. */
export async function loadStaffOptions(
  supabase: Supabase,
  branchId: number,
  excludedBranchIds: number[]
): Promise<StaffPick[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: hqBranches } = await (supabase as any).from("tbl_branches").select("BranchID").eq("Function", "HQ");
  const branchIds = [branchId, ...((hqBranches ?? []) as { BranchID: number }[]).map((b) => b.BranchID)].filter(
    (id) => !excludedBranchIds.includes(id) || id === branchId
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("tbl_staff")
    .select("staff_name, branch_id, staffId:StaffID")
    .in("branch_id", branchIds)
    .eq("status", "ACTIVE")
    .order("staff_name");
  return ((data ?? []) as { staff_name: string; branch_id: number; staffId: string }[])
    .map((s) => ({ staffId: s.staffId, name: s.staff_name, ownBranch: s.branch_id === branchId }))
    .sort((a, b) => Number(b.ownBranch) - Number(a.ownBranch));
}

/**
 * The ACTIVE staff member, if they belong to the branch or HQ — same set the
 * pickers offer. The name is read here, never trusted from the client.
 */
export async function resolveBranchStaff(
  supabase: Supabase,
  staffId: string,
  branchId: number
): Promise<{ staffId: string; name: string } | null> {
  if (!staffId) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: hqBranches } = await (supabase as any).from("tbl_branches").select("BranchID").eq("Function", "HQ");
  const allowed = [branchId, ...((hqBranches ?? []) as { BranchID: number }[]).map((b) => b.BranchID)];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("tbl_staff")
    .select("staff_name, StaffID, branch_id")
    .eq("StaffID", staffId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!data || !allowed.includes(data.branch_id)) return null;
  return { staffId: data.StaffID, name: data.staff_name };
}

/** n unique 8-hex RecordIDs (same shape as the existing AppSheet rows). */
export async function generateRecordIds(supabase: Supabase, n: number): Promise<string[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ids = [...new Set(Array.from({ length: n }, () => crypto.randomBytes(4).toString("hex")))];
    if (ids.length < n) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("tbl_resident_consumables")
      .select("external_ref_id")
      .in("external_ref_id", ids);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return ids;
  }
  throw new Error("Failed to generate unique RecordIDs");
}
