"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { callInventoryRpc } from "@/lib/inventory/rpc";
import { INV_RPCS, type InvRpcName, type RpcResult } from "@/lib/inventory/core";

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
