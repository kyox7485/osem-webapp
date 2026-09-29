"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslation } from "@/components/language-provider";
import { messageForCode } from "@/lib/inventory/core";
import { CARD_CLS, Field, INPUT_CLS, PRIMARY_BTN_CLS, Spinner } from "../components/form-bits";

type MissingResident = { resident_id: number; resident_ref: string; resident_name: string };

/**
 * Charge export (D-122): the CSV comes from /api/inventory/export. By default
 * only charges not yet exported for the month are included (a delta); a full
 * re-export is flagged. One key per attempt: a failed download can be retried
 * and returns the same rows.
 */
export function ExportPanel({ branchId, month }: { branchId: number; month: string }) {
  const t = useTranslation();
  const keyRef = useRef<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [layout, setLayout] = useState("ITEMISED");
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingResident[]>([]);

  function resetAttempt() {
    keyRef.current = null;
    setError(null);
    setInfo(null);
    setMissing([]);
  }

  function download() {
    if (!keyRef.current) keyRef.current = crypto.randomUUID();
    const key = keyRef.current;
    setError(null);
    setInfo(null);
    setMissing([]);
    startTransition(async () => {
      try {
        const res = await fetch("/api/inventory/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch_id: branchId, period: month, layout, full, key }),
        });
        if (res.ok && (res.headers.get("Content-Type") ?? "").includes("text/csv")) {
          const blob = await res.blob();
          const disposition = res.headers.get("Content-Disposition") ?? "";
          const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `charges_${month}.csv`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          keyRef.current = null;
          setInfo(`${t("Downloaded")}: ${name}${res.headers.get("X-Export-Locked") === "1" ? ` (${t("month is locked")})` : ""}`);
          return;
        }
        const json = (await res.json()) as { ok?: boolean; empty?: boolean; code?: string; data?: { residents?: MissingResident[] } };
        if (json.ok && json.empty) {
          keyRef.current = null;
          setInfo(t("Nothing new to export for this month. Tick full re-export to download everything again."));
          return;
        }
        setError(json.code ?? "RPC_ERROR");
        setMissing(json.data?.residents ?? []);
      } catch {
        setError("RPC_ERROR");
      }
    });
  }

  return (
    <section className={`${CARD_CLS} space-y-3`}>
      <h2 className="text-sm font-semibold text-fg">{t("Export charges for billing")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("Layout")}>
          <select
            className={INPUT_CLS}
            value={layout}
            onChange={(e) => {
              resetAttempt();
              setLayout(e.target.value);
            }}
          >
            <option value="ITEMISED">{t("Itemised (one row per charge)")}</option>
            <option value="SUMMARY">{t("Summary (one row per resident)")}</option>
          </select>
        </Field>
        <label className="flex items-start gap-2 self-end pb-2 text-sm text-fg-secondary">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={full}
            onChange={(e) => {
              resetAttempt();
              setFull(e.target.checked);
            }}
          />
          <span>
            {t("Full re-export")}
            <span className="block text-xs text-fg-subtle">{t("Include charges that were already exported. The export is flagged as a re-export.")}</span>
          </span>
        </label>
      </div>
      {error && (
        <div role="alert" className="space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p>{t(messageForCode(error))}</p>
          <p className="font-mono text-xs">{error}</p>
          {missing.length > 0 && (
            <ul className="list-disc pl-5 text-xs">
              {missing.map((r) => (
                <li key={r.resident_id}>
                  {r.resident_name} ({r.resident_ref})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {info && (
        <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {info}
        </div>
      )}
      <button type="button" className={PRIMARY_BTN_CLS} disabled={isPending} onClick={download}>
        {isPending && <Spinner />}
        {isPending ? t("Preparing...") : t("Download CSV")}
      </button>
    </section>
  );
}
