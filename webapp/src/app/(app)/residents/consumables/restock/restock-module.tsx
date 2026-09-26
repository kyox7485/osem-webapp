"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, FileDown, Loader2, Plus, RotateCcw, Trash2, Truck, Users } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import { useNavPush } from "@/components/nav-loading";
import { useDirtyForm } from "@/lib/dirty-form-context";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { formatDate } from "@/lib/format-date";
import {
  LOW_STOCK_THRESHOLD,
  fmtQty,
  groupRestockRows,
  isBalanceOnly,
  type RestockRow,
  type StaffPick,
  type Supplier,
} from "@/lib/consumables";

type BranchOption = { id: number; name: string };
type ResidentOption = { id: number; name: string; residentTextId: string | null };

/** An item that is not on the list yet but can be added for that resident. */
export type AddOption = {
  key: string;
  consumableId: string;
  item: string;
  unit: string;
  supplier: Supplier | null;
  currentStock: number | null;
  lastCount: string | null;
  hasMaxStock: boolean;
};

type Message = { text: string; kind: "info" | "error" | "success" };

const ALL = "all";

function signatureOf(rows: RestockRow[]): string {
  return rows.map((r) => `${r.key}|${r.suggestedQty}`).join("~");
}

export function RestockModule({ branches, selectedBranchId, residents, rows: serverRows, addOptions, staffOptions, loadError }: {
  branches: BranchOption[];
  selectedBranchId: number;
  residents: ResidentOption[];
  rows: RestockRow[];
  addOptions: Record<number, AddOption[]>;
  staffOptions: StaffPick[];
  loadError: string | null;
}) {
  const t = useTranslation();
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const { markDirty, markClean } = useDirtyForm("consumable-restock-review");
  const [isPending, startTransition] = useTransition();

  // Draft only — edits never write to any table. Family and OSEM rows share
  // one draft, so switching audience or resident loses nothing (no guard
  // needed for those toggles); leaving the tab or switching branch does.
  const [rows, setRows] = useState<RestockRow[]>(serverRows);
  const [audience, setAudience] = useState<Supplier>("Family");
  const [residentFilter, setResidentFilter] = useState<string>("");
  const [preparedBy, setPreparedBy] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [newOption, setNewOption] = useState("");

  const residentById = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);

  // Family reminders are always for one resident; the pick-up list can be
  // the whole branch.
  const residentId = residentFilter === "" || residentFilter === ALL ? null : Number(residentFilter);
  const needsResident = audience === "Family" && residentId === null;

  const visible = useMemo(
    () => rows.filter((r) => r.supplier === audience && (residentId === null ? true : r.residentId === residentId)),
    [rows, audience, residentId]
  );
  const groups = useMemo(
    () =>
      groupRestockRows(visible, (id) => {
        const r = residentById.get(id);
        return { name: r?.name ?? "—", textId: r?.residentTextId ?? null };
      }),
    [visible, residentById]
  );
  // Items with a MaxStock (top-up) and items without one are reviewed — and
  // printed — in separate blocks. On the family reminder the second block is
  // a non-urgent balance update (no quantity; the family decides).
  const blocks = useMemo(
    () =>
      [
        { id: "max", title: t("Top up to maximum stock"), rows: visible.filter((r) => r.hasMaxStock), note: null as string | null },
        {
          id: "nomax",
          title:
            audience === "Family"
              ? t("Stock balance update — family decides")
              : t("No maximum stock — restock when less than {n} left", { n: LOW_STOCK_THRESHOLD }),
          rows: visible.filter((r) => !r.hasMaxStock),
          note: audience === "Family" ? t("Usage varies, so no quantity is suggested — the family sees the balance and decides.") : null,
        },
      ]
        .filter((b) => b.rows.length > 0)
        .map((b) => ({
          ...b,
          groups: groupRestockRows(b.rows, (id) => {
            const r = residentById.get(id);
            return { name: r?.name ?? "—", textId: r?.residentTextId ?? null };
          }),
        })),
    [visible, residentById, audience, t]
  );

  const serverSig = useMemo(() => signatureOf(serverRows), [serverRows]);
  const currentSig = useMemo(() => signatureOf(rows), [rows]);
  useEffect(() => {
    if (serverSig === currentSig) markClean();
    else markDirty();
  }, [serverSig, currentSig, markClean, markDirty]);
  useEffect(() => () => markClean(), [markClean]);

  const onList = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  const available = residentId === null ? [] : (addOptions[residentId] ?? []).filter((o) => !onList.has(o.key));

  function update(key: string, qty: number) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, suggestedQty: Math.max(0, qty) } : r)));
    setMessage(null);
  }

  function remove(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setMessage(null);
  }

  function resetRow(row: RestockRow) {
    const original = serverRows.find((r) => r.key === row.key);
    update(row.key, original ? original.suggestedQty : 1);
  }

  function resetAll() {
    setRows(serverRows);
    setMessage({ text: t("Review reset to the calculated values."), kind: "info" });
  }

  function addRow() {
    if (residentId === null) return;
    const o = available.find((x) => x.key === newOption);
    if (!o) return;
    setRows((prev) => [
      ...prev,
      {
        key: o.key,
        residentId,
        consumableId: o.consumableId,
        item: o.item,
        unit: o.unit,
        supplier: audience,
        currentStock: o.currentStock,
        lastCount: o.lastCount,
        suggestedQty: isBalanceOnly({ hasMaxStock: o.hasMaxStock, supplier: audience }) ? 0 : 1,
        addedManually: true,
        hasMaxStock: o.hasMaxStock,
      },
    ]);
    setNewOption("");
    setMessage(null);
  }

  function switchBranch(id: string) {
    guardedAction(() => push(`/residents/consumables/restock?branch=${id}`));
  }

  function generatePdf() {
    if (needsResident) {
      setMessage({ text: t("Select a resident for the family reminder."), kind: "error" });
      return;
    }
    if (visible.length === 0) {
      setMessage({ text: t("There is nothing to generate."), kind: "error" });
      return;
    }
    if (!preparedBy) {
      setMessage({ text: t("Please select the staff member who prepared this list."), kind: "error" });
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/reports/consumable-restock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audience,
            branchId: selectedBranchId,
            residentId,
            preparedBy,
            rows: visible.map((r) => ({
              residentId: r.residentId,
              item: r.item,
              unit: r.unit,
              currentStock: r.currentStock,
              lastCount: r.lastCount,
              suggestedQty: r.suggestedQty,
              addedManually: r.addedManually,
              hasMaxStock: r.hasMaxStock,
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
        a.download = audience === "Family" ? "consumable-restock-reminder.pdf" : "consumable-pickup-list.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setMessage({ text: t("PDF downloaded."), kind: "success" });
      } catch {
        setMessage({ text: t("Could not generate the PDF."), kind: "error" });
      }
    });
  }

  const selectCls =
    "min-h-11 w-full rounded-md border border-line-strong bg-input px-3 py-2 text-base text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:min-h-10 sm:text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-fg-muted";
  const audiences: { value: Supplier; label: string; hint: string; icon: typeof Users }[] = [
    { value: "Family", label: t("Family Reminder"), hint: t("Bilingual PDF asking the family to restock"), icon: Users },
    { value: "OSEM", label: t("OSEM Pick-up List"), hint: t("Internal: what to take from the store and charge to the resident"), icon: Truck },
  ];

  return (
    <div className="rounded-lg border border-line bg-surface shadow-sm">
      {/* Audience */}
      <div className="grid gap-2 border-b border-line-subtle p-4 sm:grid-cols-2" role="radiogroup" aria-label={t("PDF type")}>
        {audiences.map((a) => {
          const active = audience === a.value;
          const Icon = a.icon;
          return (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => { setAudience(a.value); setMessage(null); setNewOption(""); }}
              className={`flex min-h-14 items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                active ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40" : "border-line hover:bg-hover"
              }`}
            >
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${active ? "bg-indigo-600 text-white" : "bg-surface-strong text-fg-subtle"}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg">{a.label}</span>
                <span className="block text-xs text-fg-subtle">{a.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-4 p-4">
        {/* Scope */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="restock-branch" className={labelCls}>{t("Branch")}</label>
            {branches.length === 1 ? (
              <p className="rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg">{branches[0].name}</p>
            ) : (
              <select id="restock-branch" value={selectedBranchId} onChange={(e) => switchBranch(e.target.value)} className={selectCls}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label htmlFor="restock-resident" className={labelCls}>
              {t("Resident")}{audience === "Family" && <span className="ml-0.5 text-red-500"> *</span>}
            </label>
            <select id="restock-resident" value={residentFilter} onChange={(e) => { setResidentFilter(e.target.value); setNewOption(""); setMessage(null); }} className={selectCls}>
              {audience === "Family" ? (
                <option value="">{t("Select resident")}</option>
              ) : (
                <option value="">{t("All residents")}</option>
              )}
              {residents.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.residentTextId ? ` (${r.residentTextId})` : ""}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Review */}
        {loadError ? (
          <div className="flex items-start gap-2 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{t("Could not load consumables.")}</p>
              <p className="mt-0.5 text-xs opacity-80">{loadError}</p>
            </div>
          </div>
        ) : needsResident ? (
          <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-fg-subtle">
            {t("Select a resident to prepare their family reminder.")}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {audience === "Family"
              ? t("No family-supplied item needs restocking for this resident.")
              : t("No OSEM-supplied item needs restocking right now.")}
          </div>
        ) : (
          <div className="space-y-4">
            {blocks.map((block) => (
              <section key={block.id} aria-label={block.title}>
                <h3 className="flex items-center justify-between gap-3 text-sm font-semibold text-fg-secondary">
                  <span className="flex flex-wrap items-center gap-2">
                    {block.title}
                    {block.note && (
                      <span className="rounded-full border border-line-strong bg-surface-strong px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                        {t("Not urgent")}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs font-normal text-fg-muted">{t("{n} items", { n: block.rows.length })}</span>
                </h3>
                {block.note && <p className="mt-0.5 text-xs text-fg-subtle">{block.note}</p>}
                <div className="mb-2" />
                <div className="overflow-hidden rounded-md border border-line">
                  {block.groups.map((g) => (
                    <div key={g.residentId}>
                      <div className="flex items-center justify-between gap-3 border-b border-line bg-accent-soft px-3 py-1.5">
                        <span className="text-sm font-semibold text-accent">
                          {g.residentTextId ? `${g.residentName} (${g.residentTextId})` : g.residentName}
                        </span>
                        <span className="text-xs text-fg-muted">{t("{n} items", { n: g.rows.length })}</span>
                      </div>
                      <ul className="divide-y divide-line-subtle">
                        {g.rows.map((r) => (
                          <li key={r.key} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                            <div className="min-w-0 sm:flex-1">
                              <div className="text-sm font-medium text-fg">
                                {t(r.item)}
                                {r.addedManually && <span className="ml-2 text-xs font-normal text-fg-faint">{t("Added manually")}</span>}
                              </div>
                              <div className="text-xs text-fg-subtle">
                                {isBalanceOnly(r) ? (
                                  `${t("Last counted")}: ${r.lastCount ? formatDate(r.lastCount) : "—"}`
                                ) : r.currentStock === null
                                  ? t("Not counted yet")
                                  : t("In stock {qty} {unit} · counted {date}", {
                                      qty: fmtQty(r.currentStock),
                                      unit: t(r.unit),
                                      date: r.lastCount ? formatDate(r.lastCount) : "—",
                                    })}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isBalanceOnly(r) ? (
                                <>
                                  <span className="text-xs text-fg-muted">{t("Stock balance")}</span>
                                  <span className="w-20 text-right text-sm font-semibold text-fg">
                                    {r.currentStock === null ? "—" : fmtQty(r.currentStock)}
                                  </span>
                                  <span className="w-12 text-xs text-fg-subtle">{t(r.unit)}</span>
                                  <span className="h-10 w-10" aria-hidden />
                                </>
                              ) : (
                              <>
                              <label htmlFor={`restock-qty-${r.key}`} className="text-xs text-fg-muted">
                                {audience === "Family" ? t("Suggested") : t("Qty to take")}
                              </label>
                              <input
                                id={`restock-qty-${r.key}`}
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step="any"
                                value={r.suggestedQty}
                                onChange={(e) => update(r.key, Number(e.target.value))}
                                className="min-h-10 w-20 rounded-md border border-line-strong bg-input px-2 py-1 text-right text-sm font-medium text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                              />
                              <span className="w-12 text-xs text-fg-subtle">{t(r.unit)}</span>
                              <button type="button" onClick={() => resetRow(r)} title={t("Reset to calculated")} aria-label={`${t("Reset to calculated")}: ${r.item}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg-secondary">
                                <RotateCcw className="h-4 w-4" aria-hidden />
                              </button>
                              </>
                              )}
                              <button type="button" onClick={() => remove(r.key)} title={t("Remove")} aria-label={`${t("Remove")}: ${r.item}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-red-600 dark:hover:text-red-400">
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Add item (needs one resident) */}
        {!loadError && !needsResident && (
          <div className="rounded-md border border-line-subtle bg-surface-strong px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="sm:flex-1">
                <label htmlFor="restock-add" className={labelCls}>{t("Add another item")}</label>
                <select id="restock-add" value={newOption} onChange={(e) => setNewOption(e.target.value)} disabled={residentId === null} className={`${selectCls} disabled:cursor-not-allowed disabled:opacity-50`}>
                  <option value="">{residentId === null ? t("Select a resident first") : t("Select an item…")}</option>
                  {available.map((o) => (
                    <option key={o.key} value={o.key}>
                      {t(o.item)} — {o.currentStock === null ? t("Not counted yet") : `${fmtQty(o.currentStock)} ${t(o.unit)}`}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={addRow} disabled={newOption === ""} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary shadow-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-10">
                <Plus className="h-4 w-4" aria-hidden />
                {t("Add")}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3 rounded-md border border-line-subtle bg-surface-strong px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-sm text-fg-secondary">
            <span className="font-semibold text-fg">{t("{n} items", { n: visible.length })}</span>
            {" · "}
            {t("{n} residents", { n: groups.length })}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:min-w-[200px]">
              <label htmlFor="restock-prepared" className={labelCls}>
                {t("Prepared By")}<span className="ml-0.5 text-red-500"> *</span>
              </label>
              <select id="restock-prepared" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} className={selectCls}>
                <option value="">{t("Select staff")}</option>
                {staffOptions.map((s) => (
                  <option key={s.staffId} value={s.staffId}>{s.name}{s.ownBranch ? "" : ` (${t("HQ")})`}</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={resetAll} disabled={isPending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary shadow-sm hover:bg-hover disabled:opacity-40 sm:min-h-10">
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t("Reset review")}
            </button>
            <button
              type="button"
              onClick={generatePdf}
              disabled={isPending || needsResident || visible.length === 0 || preparedBy === ""}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-10"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t("Generating…")}
                </>
              ) : (
                <>
                  <FileDown className="h-4 w-4" aria-hidden />
                  {audience === "Family" ? t("Generate family reminder PDF") : t("Generate pick-up list PDF")}
                </>
              )}
            </button>
          </div>
        </div>

        {message && (
          <div role="status" className={`flex items-start gap-2 rounded-md px-4 py-3 text-sm ${
            message.kind === "error"
              ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
              : message.kind === "success"
                ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300"
                : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
          }`}>
            {message.kind === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            {message.text}
          </div>
        )}

        <p className="text-xs text-fg-faint">
          {audience === "Family"
            ? t("Items with a maximum stock are topped up to it; items without one show their balance only, so the family can decide. Editing here does not change any count.")
            : t("Items with a maximum stock are topped up to it; items without one are listed only when less than {n} is left. Editing here does not change any count.", { n: LOW_STOCK_THRESHOLD })}
        </p>
      </div>
    </div>
  );
}
