"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { callInventoryRpc } from "@/lib/inventory/rpc";
import { createClient } from "@/lib/supabase/server";
import { INV_RPCS, INV_TIER, barcodeVariants, type InvRpcName, type InvStaff, type RpcResult } from "@/lib/inventory/core";
import { isPlausibleBarcode } from "@/lib/inventory/scan";
import { getInventoryContext, loadStaff } from "@/lib/inventory/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_CHARS = 200_000;

// The single Server Action behind every Inventory form. The client makes the
// idempotency key once per submit attempt and re-sends the same key on a
// confirm round-trip (negative stock / sanity / inactive resident), so a
// retry never posts twice (§4.5). The RPC is the authority on permissions;
// this only checks the call is well-formed and the user is signed in.
export async function runInventoryRpc(rpc: InvRpcName, payload: Record<string, unknown>, key: string): Promise<RpcResult> {
  const account = await getCurrentUser();
  if (!account) return { ok: false, code: "NOT_AUTHENTICATED" };
  if (!(INV_RPCS as readonly string[]).includes(rpc)) return { ok: false, code: "FORBIDDEN" };
  if (!UUID_RE.test(key) || typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, code: "INVALID_PAYLOAD" };
  }
  if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) return { ok: false, code: "INVALID_PAYLOAD" };

  const result = await callInventoryRpc(rpc, payload, key);
  if (result.ok) revalidatePath("/inventory", "layout");
  return result;
}

/**
 * D-95 fallback: the preloaded barcode map missed, so ask the database (RLS
 * scopes it exactly like the RPCs). Keeps a code attached a moment ago working
 * before the page reloads its map. Never searches by name.
 */
export async function lookupBarcodeAction(code: string): Promise<{ productId: number; uomId: number } | null> {
  const account = await getCurrentUser();
  if (!account || typeof code !== "string") return null;
  const trimmed = code.trim();
  if (!isPlausibleBarcode(trimmed)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_inv_product_barcodes")
    .select("product_id, uom_id")
    .eq("is_active", true)
    .in("barcode", barcodeVariants(trimmed))
    .limit(1);
  const row = data?.[0];
  return row ? { productId: Number(row.product_id), uomId: Number(row.uom_id) } : null;
}

export type BarcodeAttachContext = { allowed: boolean; needsStaff: boolean; staff: InvStaff[] };

/** Who may attach a scanned-but-unknown barcode (BARCODE_ATTACH tier), and which staff can perform it. */
export async function getBarcodeAttachContext(): Promise<BarcodeAttachContext> {
  const none: BarcodeAttachContext = { allowed: false, needsStaff: false, staff: [] };
  const ctx = await getInventoryContext();
  if (!ctx || ctx.branchId === null) return none;
  const allowed = ctx.isDemoUser ? ctx.rank >= 4 : ctx.rank >= INV_TIER.BARCODE_ATTACH;
  if (!allowed) return none;
  const needsStaff = !ctx.isHqAdmin && !ctx.isDemoUser;
  return { allowed, needsStaff, staff: needsStaff ? await loadStaff(ctx.supabase, ctx.branchId, false) : [] };
}
