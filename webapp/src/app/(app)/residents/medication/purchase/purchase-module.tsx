"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileDown,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import { useDirtyForm } from "@/lib/dirty-form-context";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { LOW_STOCK_DAYS } from "@/lib/medication-stock";
import {
  groupPurchaseRows,
  suggestOrderQty,
  summarize,
  type PurchaseListGroup,
  type PurchaseListOption,
  type PurchaseListRow,
} from "@/lib/medication-purchase-core";

type BranchOption = { id: number; name: string };
type ResidentOption = { id: number; name: string; residentTextId: string | null };

type Props = {
  branches: BranchOption[];
  selectedBranchId: number;
  groups: PurchaseListGroup[];
  stockOptions: PurchaseListOption[];
  residents: ResidentOption[];
};

const OTHER_VALUE = "__other__";

type Message = { text: string; kind: "info" | "error" | "success" };

/** Compact fingerprint of everything the reviewer can change, for dirty tracking. */
function signatureOf(rows: PurchaseListRow[]): string {
  return rows
    .map((r) => `${r.key}|${r.residentId}|${r.medicine}|${r.balance ?? ""}|${r.suggestedQty}`)
    .join("~");
}

export function PurchaseModule({ branches, selectedBranchId, groups, stockOptions, residents }: Props) {
  const t = useTranslation();
  const { navigateTo } = useSafeNavigation();
  const { markDirty, markClean } = useDirtyForm("medication-purchase-list");
  const [isPending, startTransition] = useTransition();

  // Draft rows live here only — nothing is persisted, and leaving the tab
  // discards every edit (the dirty-form guard warns first).
  const [rows, setRows] = useState<PurchaseListRow[]>(() => groups.flatMap((g) => g.rows));
  const [message, setMessage] = useState<Message | null>(null);

  // Add-item controls.
  const [newResidentId, setNewResidentId] = useState<number | "">("");
  const [newOption, setNewOption] = useState<string>("");
  const [customName, setCustomName] = useState("");

  const residentById = useMemo(
    () => new Map(residents.map((r) => [r.id, r])),
    [residents]
  );

  // Group the *edited* rows with the same ordering rule the server used, so
  // the screen and the PDF can never disagree.
  const reviewGroups = useMemo(
    () => groupPurchaseRows(rows, (r) => r.suggestedQty),
    [rows]
  );
  const totals = useMemo(() => summarize(reviewGroups), [reviewGroups]);

  // A signature of the fields the reviewer can change — when it returns to the
  // calculated state the draft is no longer worth warning about.
  const initialSignature = useMemo(
    () => signatureOf(groups.flatMap((g) => g.rows)),
    [groups]
  );
  const currentSignature = useMemo(() => signatureOf(rows), [rows]);

  useEffect(() => {
    if (currentSignature === initialSignature) markClean();
    else markDirty();
  }, [currentSignature, initialSignature, markDirty, markClean]);

  function update(key: string, patch: Partial<PurchaseListRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setMessage(null);
  }

  function remove(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setMessage(null);
  }

  function resetRow(row: PurchaseListRow) {
    update(row.key, { suggestedQty: suggestOrderQty(row.dailyUsage, row.countable) });
  }

  function resetAll() {
    setRows(groups.flatMap((g) => g.rows));
    setMessage({ text: t("Review reset to the calculated values."), kind: "info" });
  }

  function canAdd(): boolean {
    if (newResidentId === "" || newOption === "") return false;
    if (newOption === OTHER_VALUE && customName.trim() === "") return false;
    return true;
  }

  function addRow() {
    if (newResidentId === "" || !canAdd()) return;
    const resident = residentById.get(newResidentId);
    if (!resident) return;

    const isOther = newOption === OTHER_VALUE;
    const selected = stockOptions.find((o) => o.value === newOption);
    // "Metformin 500mg — Tablet" → name and unit split back out.
    const [rawName, rawUnit] = selected ? selected.label.split(" — ") : [customName.trim(), "Unit"];

    const row: PurchaseListRow = {
      key: `extra:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      residentId: resident.id,
      residentName: resident.name,
      residentTextId: resident.residentTextId,
      medicine: isOther ? customName.trim() : rawName,
      schedule: "",
      unit: rawUnit || "Unit",
      balance: null,
      dailyUsage: null,
      daysRemaining: null,
      countable: false,
      suggestedQty: 1,
      reason: t("Added manually"),
      addedManually: true,
    };
    setRows((prev) => [...prev, row]);
    setNewOption("");
    setCustomName("");
    setMessage(null);
  }

  function generatePdf() {
    if (rows.length === 0) {
      setMessage({ text: t("There is nothing to generate."), kind: "error" });
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/reports/purchase-list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId: selectedBranchId,
            rows: rows.map((r) => ({
              key: r.key,
              residentId: r.residentId,
              medicine: r.medicine,
              schedule: r.schedule,
              unit: r.unit,
              balance: r.balance,
              daysRemaining: r.daysRemaining,
              countable: r.countable,
              suggestedQty: r.suggestedQty,
              reason: r.reason,
              addedManually: r.addedManually,
            })),
          }),
        });

        if (!res.ok) {
          let text = t("Could not generate the PDF.");
          try {
            const data = await res.json();
            if (data?.error) text = String(data.error);
          } catch {
            // Non-JSON error body — keep the generic message.
          }
          setMessage({ text, kind: "error" });
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "medication-purchase-list.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        markClean();
        setMessage({ text: t("Purchase list downloaded."), kind: "success" });
      } catch {
        setMessage({ text: t("Could not generate the PDF."), kind: "error" });
      }
    });
  }

  return (
    <div className="rounded-md border border-line bg-surface shadow-sm">
      <div className="border-b border-line-subtle px-5 py-4">
        <h2 className="mb-1 text-sm font-semibold text-fg-secondary">{t("Medication Purchase List")}</h2>
        <p className="text-xs text-fg-muted">
          {t("One list for the whole branch: every OSEM-supplied medicine that needs restocking, grouped by resident.")}
        </p>
      </div>

      <div className="space-y-4 px-5 py-5">
        {/* ── Branch ─────────────────────────────────────────────────────── */}
        <div className="max-w-sm">
          <label className="mb-1.5 block text-sm font-medium text-fg-secondary">{t("Branch")}</label>
          {branches.length === 1 ? (
            <p className="rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg">
              {branches[0].name}
            </p>
          ) : (
            <select
              value={selectedBranchId}
              onChange={(e) => navigateTo(`/residents/medication/purchase?branch=${e.target.value}`)}
              className="w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* ── Review table ───────────────────────────────────────────────── */}
        {reviewGroups.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {t("No medicine needs restocking at this branch right now.")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-strong">
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-muted">
                  <th className="px-3 py-2 font-medium">{t("Medicine")}</th>
                  <th className="px-3 py-2 font-medium">{t("Dosing")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Balance")}</th>
                  <th className="px-3 py-2 font-medium">{t("Days left")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Qty to order")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {reviewGroups.map((group) => (
                  <GroupRows key={group.residentId} group={group} onUpdate={update} onRemove={remove} onReset={resetRow} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Add item ──────────────────────────────────────────────────── */}
        <div className="rounded-md border border-line-subtle bg-surface-strong px-4 py-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg-secondary">
            <Plus className="h-4 w-4" />
            {t("Add another item")}
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <label className="mb-1.5 block text-xs font-medium text-fg-muted" htmlFor="purchase-add-resident">
                {t("Resident")}
              </label>
              <select
                id="purchase-add-resident"
                value={newResidentId}
                onChange={(e) => setNewResidentId(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">{t("Select a resident…")}</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[200px] flex-1">
              <label className="mb-1.5 block text-xs font-medium text-fg-muted" htmlFor="purchase-add-item">
                {t("Medicine")}
              </label>
              <select
                id="purchase-add-item"
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
                disabled={newResidentId === ""}
                className="w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">{t("Select a medicine…")}</option>
                {stockOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                <option value={OTHER_VALUE}>{t("Other…")}</option>
              </select>
            </div>

            {newOption === OTHER_VALUE && (
              <div className="min-w-[180px] flex-1">
                <label className="mb-1.5 block text-xs font-medium text-fg-muted" htmlFor="purchase-add-name">
                  {t("Item name")}
                </label>
                <input
                  id="purchase-add-name"
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={t("Enter the medicine name…")}
                  className="w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            )}

            <button
              type="button"
              onClick={addRow}
              disabled={!canAdd() || isPending}
              className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary shadow-sm transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              {t("Add")}
            </button>
          </div>
          {newResidentId === "" && (
            <p className="mt-2 text-xs text-fg-faint">
              {t("Every item must be assigned to one resident before it can be added.")}
            </p>
          )}
        </div>

        {/* ── Summary + actions ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-subtle bg-surface-strong px-4 py-3">
          <div className="text-sm text-fg-secondary">
            <span className="font-semibold text-fg">
              {totals.totalItems} {t("items")}
            </span>
            {` · ${totals.residentCount} ${t("residents")} · `}
            <span className="font-semibold text-fg">
              {totals.totalQty} {t("units to order")}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetAll}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary shadow-sm transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              {t("Reset review")}
            </button>
            <button
              type="button"
              onClick={generatePdf}
              disabled={isPending || rows.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("Generating…")}
                </>
              ) : (
                <>
                  <FileDown className="h-4 w-4" />
                  {t("Generate purchase list PDF")}
                </>
              )}
            </button>
          </div>
        </div>

        {message && (
          <div
            className={`flex items-start gap-2 rounded-md px-4 py-3 text-sm ${
              message.kind === "error"
                ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                : message.kind === "success"
                  ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300"
                  : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
            }`}
          >
            {message.kind === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}

        <p className="text-xs text-fg-faint">
          {t(
            "Countable balances are forecasts from the prescription since the last stock count, not a physical count. Editing here does not change any stock record."
          )}
        </p>
      </div>
    </div>
  );
}

// ── One resident's medicines ──────────────────────────────────────────────────

function GroupRows({
  group,
  onUpdate,
  onRemove,
  onReset,
}: {
  group: PurchaseListGroup;
  onUpdate: (key: string, patch: Partial<PurchaseListRow>) => void;
  onRemove: (key: string) => void;
  onReset: (row: PurchaseListRow) => void;
}) {
  const t = useTranslation();
  return (
    <>
      <tr className="border-b border-line bg-accent-soft">
        <td colSpan={6} className="px-3 py-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-accent">
              {group.residentTextId ? `${group.residentName} (${group.residentTextId})` : group.residentName}
            </span>
            <span className="text-xs text-fg-muted">
              {`${group.rows.length} ${t("items")} · ${group.subtotalQty} ${t("units")}`}
            </span>
          </div>
        </td>
      </tr>
      {group.rows.map((row) => (
        <Row key={row.key} row={row} onUpdate={onUpdate} onRemove={onRemove} onReset={onReset} />
      ))}
    </>
  );
}

function Row({
  row,
  onUpdate,
  onRemove,
  onReset,
}: {
  row: PurchaseListRow;
  onUpdate: (key: string, patch: Partial<PurchaseListRow>) => void;
  onRemove: (key: string) => void;
  onReset: (row: PurchaseListRow) => void;
}) {
  const t = useTranslation();
  const low = row.countable && (row.daysRemaining ?? 0) < LOW_STOCK_DAYS;

  return (
    <tr className="border-b border-line-subtle last:border-b-0 hover:bg-hover">
      <td className="px-3 py-2">
        <div className="font-medium text-fg">{row.medicine}</div>
        {row.addedManually && <div className="text-xs text-fg-faint">{t("Added manually")}</div>}
      </td>
      <td className="px-3 py-2 text-fg-secondary">
        {row.schedule || "—"}
        <div className="text-xs text-fg-faint">{row.unit}</div>
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          min={0}
          step="any"
          value={row.balance ?? ""}
          onChange={(e) =>
            onUpdate(row.key, { balance: e.target.value === "" ? null : Number(e.target.value) })
          }
          aria-label={t("Balance")}
          className="w-20 rounded-md border border-line-strong bg-input px-2 py-1 text-right text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </td>
      <td className="px-3 py-2">
        {row.countable ? (
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
              low ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" : "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300"
            }`}
          >
            {row.daysRemaining === 0 ? t("Out of stock") : `${row.daysRemaining} ${t("days")}`}
          </span>
        ) : (
          <span className="text-xs text-fg-faint">{t("Not forecast")}</span>
        )}
        <div className="mt-0.5 text-xs text-fg-faint">{row.reason}</div>
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          min={0}
          step="any"
          value={row.suggestedQty}
          onChange={(e) => onUpdate(row.key, { suggestedQty: Number(e.target.value) })}
          aria-label={t("Qty to order")}
          className="w-20 rounded-md border border-line-strong bg-input px-2 py-1 text-right text-sm font-medium text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <div className="mt-0.5 text-xs text-fg-faint">{row.unit}</div>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => onReset(row)}
            title={t("Reset to calculated")}
            aria-label={t("Reset to calculated")}
            className="rounded p-1.5 text-fg-faint transition-colors hover:bg-hover hover:text-fg-secondary"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(row.key)}
            title={t("Remove")}
            aria-label={t("Remove")}
            className={`rounded p-1.5 transition-colors hover:bg-hover ${
              row.addedManually ? "text-red-600 dark:text-red-400" : "text-fg-faint hover:text-fg-secondary"
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
