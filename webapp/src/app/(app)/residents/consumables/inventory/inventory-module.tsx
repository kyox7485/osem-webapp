"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Info,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { useDirtyForm, type SaveResult } from "@/lib/dirty-form-context";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { formatDateTime, fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/format-date";
import {
  COUNT_DUE_DAYS,
  OTHER_UNITS,
  SUPPLIERS,
  daysSince,
  fmtQty,
  isOtherItem,
  lineKey,
  type CatalogueItem,
  type ConsumableLine,
  type StaffPick,
  type Supplier,
} from "@/lib/consumables";
import { recordConsumableCountAction } from "./inventory-actions";
import { AdminRecordControls, useIsHqAdmin } from "@/components/admin-record-controls";

export type InventoryResident = { id: number; name: string; residentTextId: string; branchId: number };

/** A line on the count sheet: an existing item, or one added this session. */
type SheetLine = {
  key: string;
  consumableId: string;
  name: string;
  unit: string;
  otherConsumable: string | null;
  otherUnit: string | null;
  isNew: boolean;
  existing: ConsumableLine | null;
};

const DASH = "—";
const OTHER_VALUE = "__other__";
const btnFocus = "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40";
const inputCls =
  "block min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-input px-3 py-2 text-base text-fg sm:min-h-10 sm:text-sm placeholder-fg-faint focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-surface-muted disabled:text-fg-faint";
const labelCls = "mb-1 block text-xs font-medium text-fg-muted";

// ── Supplier toggle ───────────────────────────────────────────────────────────

function SupplierToggle({ value, onChange, name }: { value: Supplier | null; onChange: (s: Supplier) => void; name: string }) {
  const t = useTranslation();
  return (
    <div role="radiogroup" aria-label={`${t("Supplied By")}: ${name}`} className="inline-flex rounded-md border border-line-strong p-0.5">
      {SUPPLIERS.map((s) => {
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(s)}
            className={`min-h-9 min-w-16 rounded px-3 text-xs font-medium transition-colors ${btnFocus} ${
              active
                ? s === "Family"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
                : "text-fg-subtle hover:bg-hover"
            }`}
          >
            {t(s)}
          </button>
        );
      })}
    </div>
  );
}

// ── History modal ─────────────────────────────────────────────────────────────

function HistoryModal({ line, onClose }: { line: ConsumableLine; onClose: () => void }) {
  const t = useTranslation();
  const isHqAdmin = useIsHqAdmin();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("Count History")}>
      <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-elevated shadow-xl sm:max-h-[90dvh] sm:max-w-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-fg sm:text-sm">{t("Count History")}</h3>
            <p className="mt-0.5 break-words text-xs text-fg-subtle">{line.name} · {t(line.unit)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} className={`-mr-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-hover ${btnFocus}`}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-fg-subtle">
              <tr className="border-b border-line-subtle">
                <th className="py-2 pr-3 font-medium">{t("Count Date")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("Quantity")}</th>
                <th className="py-2 pr-3 font-medium">{t("Supplied By")}</th>
                <th className="py-2 font-medium">{t("Counted By")}</th>
                {isHqAdmin && <th className="py-2 pl-3 font-medium">{t("Actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {line.history.map((h) => (
                <tr key={h.recordId} className="border-b border-line-subtle last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-fg-secondary">{formatDateTime(h.lastCount)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-medium text-fg">{fmtQty(h.currentStock)}</td>
                  <td className="py-2 pr-3 text-fg-secondary">{h.supplier ? t(h.supplier) : DASH}</td>
                  <td className="py-2 text-fg-secondary">{h.countedByName ?? DASH}</td>
                  {isHqAdmin && (
                    <td className="py-1.5 pl-3">
                      <AdminRecordControls kind="consumable_count" id={h.id} compact />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function InventoryModule({ residents, selectedResidentId, catalogue, lines, staffOptions, loadError }: {
  residents: InventoryResident[];
  selectedResidentId: number | null;
  catalogue: CatalogueItem[];
  lines: ConsumableLine[];
  staffOptions: StaffPick[];
  loadError: string | null;
}) {
  const t = useTranslation();
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const [isPending, startTransition] = useTransition();

  const index = residents.findIndex((r) => r.id === selectedResidentId);
  const selected = index >= 0 ? residents[index] : null;

  // Count sheet state. The parent keys this component by resident, so it
  // re-seeds on every resident switch.
  const [openedAt] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [countDate, setCountDate] = useState(openedAt);
  const [countedBy, setCountedBy] = useState("");
  const [added, setAdded] = useState<SheetLine[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [supplier, setSupplier] = useState<Record<string, Supplier | null>>(
    () => Object.fromEntries(lines.map((l) => [l.key, l.supplier]))
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "info"; text: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<ConsumableLine | null>(null);

  // Add-item controls.
  const [newItem, setNewItem] = useState("");
  const [otherName, setOtherName] = useState("");
  const [otherUnit, setOtherUnit] = useState<string>(OTHER_UNITS[0]);

  const [now] = useState(() => new Date());
  const catalogueById = useMemo(() => new Map(catalogue.map((c) => [c.consumableId, c])), [catalogue]);

  const sheet: SheetLine[] = useMemo(
    () => [
      ...lines.map((l) => ({
        key: l.key,
        consumableId: l.consumableId,
        name: l.name,
        unit: l.unit,
        otherConsumable: l.otherConsumable,
        otherUnit: l.otherUnit,
        isNew: false,
        existing: l,
      })),
      ...added,
    ],
    [lines, added]
  );
  const onSheet = useMemo(() => new Set(sheet.map((l) => l.key)), [sheet]);
  // Catalogue items the resident has no line for yet. "Other" can repeat
  // (one line per free-text name), so it is always offered.
  const addable = catalogue.filter((c) => !isOtherItem(c) && !onSheet.has(lineKey(c.consumableId, null)));
  const otherItem = catalogue.find((c) => isOtherItem(c)) ?? null;

  const filled = sheet.filter((l) => (qty[l.key] ?? "").trim() !== "");
  const supplierChanged = lines.filter((l) => supplier[l.key] !== l.supplier);
  const dirty = filled.length > 0 || added.length > 0 || countedBy !== "" || countDate !== openedAt || supplierChanged.length > 0;

  const { markDirty, markClean } = useDirtyForm(`consumable-count-${selectedResidentId ?? "none"}`);

  function goTo(id: number | null) {
    guardedAction(() => push(id === null ? "/residents/consumables/inventory" : `/residents/consumables/inventory?resident=${id}`));
  }

  function validate(): string | null {
    if (filled.length === 0) return t("Enter the count for at least one item.");
    const iso = fromDatetimeLocalValue(countDate);
    if (!countDate || isNaN(new Date(iso).getTime()) || countDate > toDatetimeLocalValue(new Date().toISOString()))
      return t("Count date/time cannot be in the future");
    if (!countedBy) return t("Counted By is required");
    for (const l of filled) {
      const n = parseFloat(qty[l.key]);
      if (!isFinite(n) || n < 0) return t("Enter a valid quantity for {item}.", { item: l.name });
      if (!supplier[l.key]) return t("Select who supplies {item}.", { item: l.name });
    }
    // A supplier switch is recorded as part of a count row.
    const unsavedSwitch = supplierChanged.find((l) => (qty[l.key] ?? "").trim() === "");
    if (unsavedSwitch) return t("Enter the count for {item} to save its new supplier.", { item: unsavedSwitch.name });
    const emptyAdded = added.find((l) => (qty[l.key] ?? "").trim() === "");
    if (emptyAdded) return t("Enter the count for {item} or remove it.", { item: emptyAdded.name });
    return null;
  }

  function save(): Promise<SaveResult> {
    setError(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return Promise.resolve({ success: false, error: problem });
    }
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await recordConsumableCountAction({
          residentId: selectedResidentId!,
          countedBy,
          countDate: fromDatetimeLocalValue(countDate),
          entries: filled.map((l) => ({
            consumableId: l.consumableId,
            otherConsumable: l.otherConsumable ?? undefined,
            otherUnit: l.otherUnit ?? undefined,
            supplier: supplier[l.key]!,
            quantity: parseFloat(qty[l.key]),
          })),
        });
        if (!result.success) {
          setError(result.error ?? "Unknown error");
          resolve({ success: false, error: result.error });
          return;
        }
        markClean();
        setQty({});
        setAdded([]);
        setCountedBy("");
        setNotice(
          result.pendingSync
            ? { kind: "info", text: t("Saved to the Google Sheet. It will appear here after the automatic sync (about 1 minute).") }
            : { kind: "success", text: t("{n} counts saved.", { n: result.saved ?? filled.length }) }
        );
        resolve({ success: true });
      });
    });
  }

  useEffect(() => {
    if (dirty) markDirty(save);
    else markClean();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, qty, supplier, countedBy, countDate, added]);
  useEffect(() => () => markClean(), [markClean]);

  function addLine() {
    setError(null);
    if (newItem === "") return;
    if (newItem === OTHER_VALUE) {
      if (!otherItem) return;
      const name = otherName.trim();
      if (!name) return;
      const key = lineKey(otherItem.consumableId, name);
      if (onSheet.has(key)) {
        setError(t("{item} is already on the list.", { item: name }));
        return;
      }
      setAdded((prev) => [...prev, { key, consumableId: otherItem.consumableId, name, unit: otherUnit, otherConsumable: name, otherUnit, isNew: true, existing: null }]);
      setSupplier((prev) => ({ ...prev, [key]: null }));
    } else {
      const item = catalogueById.get(newItem);
      if (!item) return;
      const key = lineKey(item.consumableId, null);
      setAdded((prev) => [...prev, { key, consumableId: item.consumableId, name: item.consumable, unit: item.unit, otherConsumable: null, otherUnit: null, isNew: true, existing: null }]);
      setSupplier((prev) => ({ ...prev, [key]: null }));
    }
    setNewItem("");
    setOtherName("");
    setOtherUnit(OTHER_UNITS[0]);
  }

  function removeAdded(key: string) {
    setAdded((prev) => prev.filter((l) => l.key !== key));
    setQty((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  const navBtn = `inline-flex min-h-10 items-center gap-1 rounded-md border border-line bg-surface px-3 text-sm text-fg-secondary hover:bg-hover disabled:opacity-40 transition-colors ${btnFocus}`;

  return (
    <div className="space-y-4">
      {/* Resident picker */}
      <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
        <label htmlFor="cons-resident" className={labelCls}>{t("Resident")}</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            id="cons-resident"
            value={selected ? String(selected.id) : ""}
            onChange={(e) => goTo(e.target.value ? Number(e.target.value) : null)}
            className="min-h-10 w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:flex-1"
          >
            <option value="">{t("Select resident")}</option>
            {residents.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.residentTextId})</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="button" className={navBtn} disabled={index <= 0} onClick={() => goTo(residents[index - 1].id)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {t("Previous")}
            </button>
            <button type="button" className={navBtn} disabled={index < 0 || index >= residents.length - 1} onClick={() => goTo(residents[index + 1].id)}>
              {t("Next")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        {selected && (
          <p className="mt-2 text-xs text-fg-subtle">{t("Resident {n} of {total}", { n: index + 1, total: residents.length })}</p>
        )}
      </div>

      {notice && (
        <div role="status" className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${notice.kind === "success" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"}`}>
          {notice.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {notice.text}
        </div>
      )}

      {loadError ? (
        <div className="flex items-start gap-2 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{t("Could not load consumables.")}</p>
            <p className="mt-0.5 text-xs opacity-80">{loadError}</p>
          </div>
        </div>
      ) : !selected ? (
        <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-fg-subtle">
          {t("Select a resident to do their weekly consumable count.")}
        </div>
      ) : (
        <form
          className="rounded-lg border border-line bg-surface shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="border-b border-line-subtle px-4 py-3">
            <h2 className="text-base font-semibold text-fg">{selected.name}</h2>
            <p className="mt-0.5 text-xs text-fg-subtle">
              {t("Enter what is physically there now. Leave an item blank to skip it.")}
            </p>
          </div>

          {/* Count date + staff */}
          <div className="grid gap-3 border-b border-line-subtle px-4 py-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cons-date" className={labelCls}>
                {t("Count Date/Time")}<span className="ml-0.5 text-red-500"> *</span>
              </label>
              <input
                id="cons-date"
                type="datetime-local"
                value={countDate}
                max={toDatetimeLocalValue(new Date().toISOString())}
                onChange={(e) => setCountDate(e.target.value)}
                className={`${inputCls} appearance-none`}
              />
            </div>
            <div>
              <label htmlFor="cons-staff" className={labelCls}>
                {t("Counted By")}<span className="ml-0.5 text-red-500"> *</span>
              </label>
              <select id="cons-staff" value={countedBy} onChange={(e) => setCountedBy(e.target.value)} className={inputCls}>
                <option value="">{t("Select staff")}</option>
                {staffOptions.map((s) => (
                  <option key={s.staffId} value={s.staffId}>{s.name}{s.ownBranch ? "" : ` (${t("HQ")})`}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Item lines */}
          {sheet.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-subtle">
              {t("No consumables recorded for this resident yet. Add the first item below.")}
            </p>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {sheet.map((l) => {
                const ex = l.existing;
                const age = ex ? daysSince(ex.lastCount, now) : null;
                const due = age !== null && age >= COUNT_DUE_DAYS;
                return (
                  <li key={l.key} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
                    <div className="min-w-0 md:flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-fg">{l.name}</span>
                        <span className="text-xs text-fg-subtle">{t(l.unit)}</span>
                        {l.isNew && (
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{t("New item")}</span>
                        )}
                        {due && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
                            <Clock className="h-3 w-3" aria-hidden />
                            {t("Count due")}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-fg-subtle">
                        {ex
                          ? t("Last count {qty} · {date} · {who}", {
                              qty: fmtQty(ex.currentStock),
                              date: formatDateTime(ex.lastCount),
                              who: ex.lastCountedBy ?? DASH,
                            })
                          : t("Not counted yet")}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <SupplierToggle
                        name={l.name}
                        value={supplier[l.key] ?? null}
                        onChange={(s) => setSupplier((prev) => ({ ...prev, [l.key]: s }))}
                      />
                      <div className="w-28">
                        <label htmlFor={`cons-qty-${l.key}`} className="sr-only">{t("New count")}: {l.name}</label>
                        <input
                          id={`cons-qty-${l.key}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          placeholder={t("New count")}
                          value={qty[l.key] ?? ""}
                          onChange={(e) => setQty((prev) => ({ ...prev, [l.key]: e.target.value }))}
                          className={`${inputCls} text-right`}
                        />
                      </div>
                      {ex ? (
                        <button type="button" onClick={() => setHistoryFor(ex)} aria-label={`${t("View History")}: ${l.name}`} title={t("View History")} className={`inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-fg-secondary hover:bg-hover ${btnFocus}`}>
                          <History className="h-4 w-4" aria-hidden />
                        </button>
                      ) : (
                        <button type="button" onClick={() => removeAdded(l.key)} aria-label={`${t("Remove")}: ${l.name}`} title={t("Remove")} className={`inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-red-600 hover:bg-hover dark:text-red-400 ${btnFocus}`}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Add item */}
          <div className="border-t border-line-subtle bg-surface-strong px-4 py-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg-secondary">
              <Plus className="h-4 w-4" aria-hidden />
              {t("Add item")}
            </h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="sm:min-w-[200px] sm:flex-1">
                <label htmlFor="cons-add-item" className={labelCls}>{t("Item")}</label>
                <select id="cons-add-item" value={newItem} onChange={(e) => setNewItem(e.target.value)} className={inputCls}>
                  <option value="">{t("Select an item…")}</option>
                  {addable.map((c) => (
                    <option key={c.consumableId} value={c.consumableId}>{t(c.consumable)} ({t(c.unit)})</option>
                  ))}
                  {otherItem && <option value={OTHER_VALUE}>{t("Other…")}</option>}
                </select>
              </div>
              {newItem === OTHER_VALUE && (
                <>
                  <div className="sm:min-w-[180px] sm:flex-1">
                    <label htmlFor="cons-add-name" className={labelCls}>
                      {t("Item name")}<span className="ml-0.5 text-red-500"> *</span>
                    </label>
                    <input id="cons-add-name" type="text" maxLength={100} value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder={t("e.g. plaster")} className={inputCls} />
                  </div>
                  <div className="sm:w-36">
                    <label htmlFor="cons-add-unit" className={labelCls}>{t("Unit")}</label>
                    <select id="cons-add-unit" value={otherUnit} onChange={(e) => setOtherUnit(e.target.value)} className={inputCls}>
                      {OTHER_UNITS.map((u) => (
                        <option key={u} value={u}>{t(u)}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={addLine}
                disabled={newItem === "" || (newItem === OTHER_VALUE && otherName.trim() === "")}
                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary shadow-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-10 ${btnFocus}`}
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t("Add")}
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="space-y-3 border-t border-line-subtle px-4 py-4">
            {error && (
              <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-fg-secondary">
                {t("{n} of {total} items counted", { n: filled.length, total: sheet.length })}
              </p>
              <button
                type="submit"
                disabled={isPending}
                className={`min-h-11 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors sm:min-h-10 ${btnFocus}`}
              >
                {isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {t("Saving...")}
                  </span>
                ) : t("Save count")}
              </button>
            </div>
          </div>
        </form>
      )}

      {historyFor && <HistoryModal line={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}
