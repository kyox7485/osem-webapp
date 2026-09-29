"use client";

import { useEffect, useRef } from "react";
import {
  burstCodeOnEnter,
  continuesBurst,
  EMPTY_BURST,
  feedBurstKey,
  type BurstState,
} from "@/lib/inventory/scan";

/**
 * D-109 scanner capture. A keyboard-wedge scanner types its code very fast and
 * ends with Enter. One document-level keydown listener (capture phase) spots a
 * burst of >= 6 characters with < 35 ms between keys ending in Enter, routes the
 * code to the newest visible, enabled screen, swallows that Enter (so it never
 * submits a form), and puts back whatever the focused input held before the
 * burst typed into it. Mark a field or modal with `data-scanner-ignore` to opt
 * it out. IME composition is ignored. Camera scanning is V2.
 */

type Handler = {
  onScan: (code: string) => void;
  isEnabled: () => boolean;
  getRoot: () => HTMLElement | null;
};
type TextField = HTMLInputElement | HTMLTextAreaElement;

const handlers: Handler[] = [];
let burst: BurstState = EMPTY_BURST;
let origin: { el: TextField; value: string } | null = null;

function isTextField(el: EventTarget | null): el is TextField {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

function isVisible(el: HTMLElement | null): boolean {
  return !el || (el.isConnected && el.getClientRects().length > 0);
}

function activeHandler(): Handler | null {
  for (let i = handlers.length - 1; i >= 0; i--) {
    const h = handlers[i];
    if (h.isEnabled() && isVisible(h.getRoot())) return h;
  }
  return null;
}

/** Put the field back to what it held before the burst (React-controlled safe). */
function restore(saved: { el: TextField; value: string } | null) {
  if (!saved || !saved.el.isConnected || saved.el.value === saved.value) return;
  const proto = saved.el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(saved.el, saved.value);
  saved.el.dispatchEvent(new Event("input", { bubbles: true }));
}

function onKeyDown(e: KeyboardEvent) {
  if (e.isComposing || e.key === "Process" || e.keyCode === 229) {
    burst = EMPTY_BURST;
    return;
  }
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("[data-scanner-ignore]")) {
    burst = EMPTY_BURST;
    origin = null;
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === "Enter") {
    const code = burstCodeOnEnter(burst, e.timeStamp);
    const saved = origin;
    burst = EMPTY_BURST;
    origin = null;
    if (!code) return;
    const handler = activeHandler();
    if (!handler) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    restore(saved);
    handler.onScan(code);
    return;
  }

  if (e.key.length !== 1) return; // Shift, arrows, ... do not break a burst
  const startsNew = !continuesBurst(burst, e.timeStamp);
  burst = feedBurstKey(burst, e.key, e.timeStamp);
  if (startsNew) origin = isTextField(target) ? { el: target, value: target.value } : null;
}

function register(handler: Handler): () => void {
  if (handlers.length === 0) document.addEventListener("keydown", onKeyDown, true);
  handlers.push(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
    if (handlers.length === 0) {
      document.removeEventListener("keydown", onKeyDown, true);
      burst = EMPTY_BURST;
      origin = null;
    }
  };
}

/**
 * Route scanner bursts to `onScan` while this screen is mounted and visible.
 * `rootRef` (optional) lets a hidden panel (display: none) step aside.
 */
export function useScannerCapture(
  onScan: (code: string) => void,
  opts: { enabled?: boolean; rootRef?: React.RefObject<HTMLElement | null> } = {},
) {
  const latest = useRef({ onScan, enabled: opts.enabled ?? true, rootRef: opts.rootRef });
  useEffect(() => {
    latest.current = { onScan, enabled: opts.enabled ?? true, rootRef: opts.rootRef };
  });
  useEffect(
    () =>
      register({
        onScan: (code) => latest.current.onScan(code),
        isEnabled: () => latest.current.enabled,
        getRoot: () => latest.current.rootRef?.current ?? null,
      }),
    [],
  );
}
