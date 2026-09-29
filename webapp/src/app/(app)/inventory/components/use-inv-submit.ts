"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useDirtyForm } from "@/lib/dirty-form-context";
import { CONFIRM_FLAGS, type InvRpcName, type RpcResult } from "@/lib/inventory/core";
import { runInventoryRpc } from "../actions";

type Pending = { payload: Record<string, unknown>; flags: Record<string, boolean>; code: string; data: unknown };

/**
 * Submit state for one Inventory form (§4.5, §9.4):
 *  - one idempotency key per submit attempt, created on first submit;
 *  - a confirm round-trip (NEGATIVE_STOCK_CONFIRM / SANITY_CONFIRM /
 *    INACTIVE_RESIDENT_CONFIRM) re-sends the SAME key with the flag set;
 *  - a new key after a success, or once the user edits after an error;
 *  - useTransition for the pending state; the app-wide dirty-form guard via
 *    touch() on every edit, cleared on success and on unmount.
 */
export function useInvSubmit(rpc: InvRpcName, formId: string, onSuccess?: (data: Record<string, unknown> | null) => void) {
  const keyRef = useRef<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [success, setSuccess] = useState<Record<string, unknown> | null>(null);
  const { markDirty, markClean } = useDirtyForm(formId);

  useEffect(() => () => markClean(), [markClean]);

  const send = useCallback(
    (payload: Record<string, unknown>, flags: Record<string, boolean>) => {
      if (!keyRef.current) keyRef.current = crypto.randomUUID();
      const key = keyRef.current;
      setError(null);
      setSuccess(null);
      startTransition(async () => {
        let result: RpcResult;
        try {
          result = await runInventoryRpc(rpc, { ...payload, ...flags }, key);
        } catch {
          result = { ok: false, code: "RPC_ERROR" };
        }
        if (result.ok) {
          keyRef.current = null;
          setConfirm(null);
          setSuccess(result.data ?? {});
          markClean();
          onSuccess?.(result.data);
          return;
        }
        if (CONFIRM_FLAGS[result.code] && !flags[CONFIRM_FLAGS[result.code]]) {
          setConfirm({ payload, flags, code: result.code, data: result.data });
          return;
        }
        setConfirm(null);
        setError(result.code);
      });
    },
    [rpc, markClean, onSuccess]
  );

  const submit = useCallback((payload: Record<string, unknown>) => send(payload, {}), [send]);

  const confirmAndResubmit = useCallback(() => {
    if (!confirm) return;
    send(confirm.payload, { ...confirm.flags, [CONFIRM_FLAGS[confirm.code]]: true });
  }, [confirm, send]);

  /** Call on every edit: marks the form dirty; after an error the next submit gets a new key. */
  const touch = useCallback(() => {
    markDirty();
    setSuccess(null);
    if (error || confirm) {
      keyRef.current = null;
      setError(null);
      setConfirm(null);
    }
  }, [markDirty, error, confirm]);

  return {
    isPending,
    error,
    confirm,
    success,
    submit,
    confirmAndResubmit,
    cancelConfirm: () => setConfirm(null),
    touch,
    /** Forget unsaved edits (after the user chose to close the form). */
    discard: markClean,
    setError,
  };
}
