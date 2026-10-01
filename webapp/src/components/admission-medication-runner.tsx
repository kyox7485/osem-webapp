"use client";

// App-wide driver for the New Resident admission-medication queue
// (lib/admission-medication-queue.ts). Mounted once in the (app) layout so it
// survives client-side navigation: the nurse lands on the new resident's page
// and can then go anywhere in the app while this works through the queue one
// medication per request, showing progress in a small corner panel.
//
// The queue itself lives in Supabase, so closing the tab loses nothing --
// the rows wait, and are resumed when that resident's page is opened again
// or when the admitting account next loads the app (layout seeds `initial`).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "@/components/language-provider";
import {
  ADMISSION_MED_QUEUE_API,
  hasOpenItems,
  type AdmissionMedQueueItem,
  type AdmissionMedQueueResponse,
} from "@/lib/admission-medication-queue-types";

type RunnerContext = {
  // Start (or resume) driving this resident's queue.
  watch: (residentId: number, residentName: string, items?: AdmissionMedQueueItem[]) => void;
  retry: (queueId: number, residentId: number, residentName: string) => Promise<void>;
  itemsFor: (residentId: number) => AdmissionMedQueueItem[] | undefined;
  isDriving: (residentId: number) => boolean;
};

const Ctx = createContext<RunnerContext | null>(null);

export function useAdmissionMedicationRunner(): RunnerContext | null {
  return useContext(Ctx);
}

const RETRY_AFTER_ERROR_MS = 15_000;
const MAX_CONSECUTIVE_ERRORS = 3;
const SUCCESS_PANEL_MS = 8_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function postQueue(body: Record<string, unknown>): Promise<AdmissionMedQueueResponse | null> {
  const res = await fetch(ADMISSION_MED_QUEUE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // 400/401/404: nothing this tab can do for that resident -- stop quietly.
  if (res.status === 400 || res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AdmissionMedQueueResponse;
}

export function AdmissionMedicationRunner({
  initial,
  children,
}: {
  initial: { residentId: number; residentName: string }[];
  children: React.ReactNode;
}) {
  const t = useTranslation();
  const [items, setItems] = useState<Record<number, AdmissionMedQueueItem[]>>({});
  const [names, setNames] = useState<Record<number, string>>(() =>
    Object.fromEntries(initial.map((r) => [r.residentId, r.residentName]))
  );
  // Residents shown in the corner panel this session (until dismissed).
  const [shown, setShown] = useState<number[]>(() => initial.map((r) => r.residentId));
  const [driving, setDriving] = useState<number | null>(null);

  // Seeded with what this account left unfinished (closed tab, reload).
  const pendingRef = useRef<number[]>(initial.map((r) => r.residentId));
  const runningRef = useRef(false);

  const drive = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (pendingRef.current.length > 0) {
        const residentId = pendingRef.current[0];
        setDriving(residentId);
        let errors = 0;
        for (;;) {
          try {
            const res = await postQueue({ action: "process", residentId });
            if (!res) break;
            setItems((prev) => ({ ...prev, [residentId]: res.items }));
            errors = 0;
            if (!res.processed) break;
          } catch (err) {
            console.error("[admission-med-runner] request failed:", err);
            if (++errors >= MAX_CONSECUTIVE_ERRORS) break; // rows stay queued in the DB
            await sleep(RETRY_AFTER_ERROR_MS);
          }
        }
        pendingRef.current.shift();
      }
    } finally {
      runningRef.current = false;
      setDriving(null);
    }
  }, []);

  const watch = useCallback<RunnerContext["watch"]>(
    (residentId, residentName, seed) => {
      if (residentName) setNames((prev) => (prev[residentId] === residentName ? prev : { ...prev, [residentId]: residentName }));
      if (seed) setItems((prev) => (prev[residentId] ? prev : { ...prev, [residentId]: seed }));
      setShown((prev) => (prev.includes(residentId) ? prev : [...prev, residentId]));
      if (!pendingRef.current.includes(residentId)) pendingRef.current.push(residentId);
      void drive();
    },
    [drive]
  );

  const retry = useCallback<RunnerContext["retry"]>(
    async (queueId, residentId, residentName) => {
      try {
        const res = await postQueue({ action: "retry", queueId });
        if (res) setItems((prev) => ({ ...prev, [res.residentId]: res.items }));
      } catch (err) {
        console.error("[admission-med-runner] retry failed:", err);
      }
      watch(residentId, residentName);
    },
    [watch]
  );

  // Resume anything this account left unfinished.
  useEffect(() => {
    if (pendingRef.current.length > 0) void drive();
  }, [drive]);

  // Closing the tab mid-queue is safe (the rows wait in the DB), but the
  // medications won't reach Medication Orders until someone resumes them --
  // so ask first, the same way an unsaved form does.
  const busy = driving !== null;
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  // Auto-hide a resident's panel row a few seconds after everything saved.
  useEffect(() => {
    const finished = shown.filter((id) => {
      const list = items[id];
      return list && list.length > 0 && list.every((i) => i.status === "done") && driving !== id;
    });
    if (finished.length === 0) return;
    const timer = setTimeout(() => setShown((prev) => prev.filter((id) => !finished.includes(id))), SUCCESS_PANEL_MS);
    return () => clearTimeout(timer);
  }, [shown, items, driving]);

  const ctx = useMemo<RunnerContext>(
    () => ({
      watch,
      retry,
      itemsFor: (id) => items[id],
      isDriving: (id) => driving === id,
    }),
    [watch, retry, items, driving]
  );

  const rows = shown
    .map((id) => ({ id, name: names[id] ?? "", list: items[id] ?? [] }))
    .filter((r) => r.list.length > 0 || driving === r.id);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {rows.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm space-y-2 rounded-lg border border-line bg-surface p-3 text-sm text-fg shadow-lg"
        >
          {rows.map((r) => {
            const total = r.list.length;
            const done = r.list.filter((i) => i.status === "done").length;
            const failed = r.list.filter((i) => i.status === "failed").length;
            const open = hasOpenItems(r.list) || driving === r.id;
            return (
              <div key={r.id} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {open ? (
                    <svg className="h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  ) : failed > 0 ? (
                    <span className="block h-4 w-4 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden="true" />
                  ) : (
                    <span className="block h-4 w-4 rounded-full bg-green-500 dark:bg-green-400" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {open ? t("Saving admission medicines") : failed > 0 ? t("Some admission medicines failed") : t("Admission medicines saved")}
                    {r.name ? ` — ${r.name}` : ""}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {t("{done}/{total} saved", { done, total })}
                    {failed > 0 ? ` · ${t("{count} failed", { count: failed })}` : ""}
                  </p>
                  {open && (
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {t("You can keep working. Keep this browser tab open until it finishes.")}
                    </p>
                  )}
                  <Link href={`/residents/${r.id}`} className="mt-1 inline-block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {t("Open resident")}
                  </Link>
                </div>
                {!open && (
                  <button
                    type="button"
                    onClick={() => setShown((prev) => prev.filter((id) => id !== r.id))}
                    className="shrink-0 rounded px-1 text-fg-subtle hover:text-fg"
                    aria-label={t("Dismiss")}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Ctx.Provider>
  );
}
