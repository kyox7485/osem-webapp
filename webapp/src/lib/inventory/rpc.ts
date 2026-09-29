import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { InvRpcName, RpcResult } from "./core";

// Typed wrapper around the inv_* RPCs (schema/010, 011, 014, 015, 017, 018). Always the
// user-session client — never the service role (D-85): auth.uid() must be
// the real login for fn_inv_can and the audit log.
//
// Business rejections come back as {ok:false, code}. Anything raised inside
// the RPC (it rolls back completely) arrives as a PostgREST error; the known
// ones are mapped to a code, a deadlock/serialization failure is retried once
// with the SAME key (§4.6), everything else becomes RPC_ERROR.

const RETRYABLE = new Set(["40P01", "40001"]);
const RAISED_CODES: [RegExp, string][] = [
  [/INV_ISSUE_HAS_RETURNS/, "ISSUE_HAS_RETURNS"],
  [/INV_REQUEST_LINK/, "REQUEST_NOT_FOUND"],
];

export async function callInventoryRpc(rpc: InvRpcName, payload: Record<string, unknown>, key: string): Promise<RpcResult> {
  const supabase = await createClient();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc(rpc, { p_payload: payload, p_key: key });
    if (error) {
      if (RETRYABLE.has(error.code ?? "") && attempt === 0) continue;
      const mapped = RAISED_CODES.find(([re]) => re.test(error.message ?? ""));
      if (!mapped) console.error(`[inventory] ${rpc} failed`, error.code, error.message);
      return { ok: false, code: mapped ? mapped[1] : "RPC_ERROR" };
    }
    const result = data as { ok?: boolean; code?: string; message?: string; data?: unknown; replayed?: boolean } | null;
    if (result?.ok) {
      return { ok: true, data: (result.data as Record<string, unknown> | null) ?? null, replayed: result.replayed };
    }
    return { ok: false, code: result?.code ?? "RPC_ERROR", message: result?.message, data: result?.data };
  }
  return { ok: false, code: "RPC_ERROR" };
}
