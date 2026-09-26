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
import { useNavPush } from "@/components/nav-loading";
import { useDirtyForm } from "@/lib/dirty-form-context";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { LOW_STOCK_DAYS } from "@/lib/medication-stock";
import {
  daysLeftFor,
  groupPurchaseRows,
  suggestOrderQty,
  summarize,
  type PurchaseListGroup,
  type PurchaseListRow,
  type PurchaseListStaff,
  type ResidentMedicineOption,
} from "@/lib/medication-purchase-core";

type BranchOption = { id: number; name: string };
type ResidentOption = { id: number; name: string; residentTextId: string | null };

type Props = {
  branches: BranchOption[];
  selectedBranchId: number;
  groups: PurchaseListGroup[];
  /** Active OSEM medicines per resident — scopes the "add item" picker. */
  residentMedicines: Record<number, ResidentMedicineOption[]>;
  staffOptions: PurchaseListStaff[];
  residents: ResidentOption[];
  /** Set when the branch list failed to load — never show "nothing to restock" then. */
  loadError: string | null;
};

const OTHER_VALUE = "__other__";

type Message = { text: string; kind: "info" | "error" | "success" };

/**
 * Monotonic id for manually added rows. A ref counter rather than
 * Date.now()/Math.random() so the key is unique and the linter is happy about
 * impure calls.
 */
let extraRowCounter = 0;
function nextRowId(): string {
  extraRowCounter += 1;
  return `extra:${extraRowCounter}`;
}

/** Compact fingerprint of everything the reviewer can change, for dirty tracking. */
function signatureOf(rows: PurchaseListRow[]): string {
  return rows
    .map((r) => `${r.key}|${r.residentId}|${r.medicine}|${r.balance ?? ""}|${r.suggestedQty}`)
    .join("~");
}

export function PurchaseModule({
  branches,
  selectedBranchId,
  groups,
  residentMedicines,
  staffOptions,
  residents,
  loadError,
}: Props) {
  const t = useTranslation();
  // push() (not navigateTo) so switching branch shows the app-wide loading
  // overlay — a plain router.push gives the user no feedback while the next
  // branch's list is being computed.
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const { markDirty, markClean } = useDirtyForm("medication-purchase-list");
  const [isPending, startTransition] = useTransition();

  // Draft rows live here only — nothing is persisted, and leaving the tab
  // discards every edit (the dirty-form guard warns first). The parent gives
  // this component a `key` of the branch id, so switching branch remounts it
  // and this initialiser re-seeds from the new branch instead of keeping the
  // previous branch's rows.
  const [rows, setRows] = useState<PurchaseListRow[]>(() => groups.flatMap((g) => g.rows));
  const [message, setMessage] = useState<Message | null>(null);

  // Add-item controls.
  const [newResidentId, setNewResidentId] = useState<number | "">("");
  const [newOption, setNewOption] = useState<string>("");
  const [customName, setCustomName] = useState("");
  const [customDose, setCustomDose] = useState("");
  // Who prepared this list — required before the PDF can be generated.
  const [preparedBy, setPreparedBy] = useState("");

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
  const serverSignature = useMemo(
    () => signatureOf(groups.flatMap((g) => g.rows)),
    [groups]
  );
  const currentSignature = useMemo(() => signatureOf(rows), [rows]);

  useEffect(() => {
    if (currentSignature === serverSignature) markClean();
    else markDirty();
  }, [currentSignature, serverSignature, markDirty, markClean]);

  function update(key: string, patch: Partial<PurchaseListRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // Keep "Days left" honest whenever the balance is edited by hand.
        if (patch.balance !== undefined) {
          next.daysRemaining = r.countable ? daysLeftFor(next.balance, r.dailyUsage) : null;
          next.reason =
            r.addedManually ? t("Not forecast; Added manually")
            : next.daysRemaining === null
              ? (next.balance !== null && next.balance <= 0 ? t("Out of stock") : t("Low quantity"))
              : (next.daysRemaining === 0 ? t("Out of stock") : t("Balance adjusted"));
        }
        return next;
      })
    );
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

  // Only the chosen resident's own active medicines — never another
  // resident's drug. The server already drops anything already on the list;
  // also drop anything added during this session so the same medicine cannot
  // be added twice.
  const onListNames = useMemo(
    () => new Set(rows.map((r) => r.medicine.trim().toLowerCase())),
    [rows]
  );
  const availableMedicines: ResidentMedicineOption[] =
    newResidentId === ""
      ? []
      : (residentMedicines[newResidentId] ?? []).filter(
          (o) => !onListNames.has(o.label.trim().toLowerCase())
        );

  function canAdd(): boolean {
    if (newResidentId === "" || newOption === "") return false;
    // "Other…" is free text, so both the name and the dose must be typed in.
    if (newOption === OTHER_VALUE && (customName.trim() === "" || customDose.trim() === "")) return false;
    return true;
  }

  function addRow() {
    if (newResidentId === "" || !canAdd()) return;
    const resident = residentById.get(newResidentId);
    if (!resident) return;

    const isOther = newOption === OTHER_VALUE;
    const selected = availableMedicines.find((o) => o.value === newOption);
    const medicineName = isOther ? customName.trim() : selected?.label ?? "";
    // The server already drops listed medicines from the picker, but a
    // free-text "Other…" can still name one that's already on the list (for
    // this resident or any other). Refuse rather than create a duplicate.
    const duplicate = rows.some(
      (r) => r.medicine.trim().toLowerCase() === medicineName.trim().toLowerCase()
    );
    if (duplicate) {
      setMessage({ text: t("This medicine is already on the purchase list."), kind: "error" });
      return;
    }
    const inherited = selected ?? null;
    const doseStr = isOther ? (customDose.trim() || "—") : (inherited?.schedule || "—");

    const row: PurchaseListRow = {
      key: `extra:${nextRowId()}`,
      residentId: resident.id,
      residentName: resident.name,
      residentTextId: resident.residentTextId,
      medicine: medicineName || "—",
      schedule: doseStr,
      unit: selected?.unit || "Unit",
      // Inherit the order's real dosing/forecast from the picker option, so the
      // added line shows the resident's actual balance and days left instead
      // of blanks. "Other…" has no source order, so only its typed dose.
      balance: isOther ? null : (inherited?.balance ?? null),
      dailyUsage: isOther ? null : (inherited?.dailyUsage ?? null),
      daysRemaining: isOther ? null : (inherited?.daysRemaining ?? null),
      countable: isOther ? false : (inherited?.countable ?? false),
      suggestedQty: 1,
      reason: t("Added manually"),
      addedManually: true,
    };
    setRows((prev) => [...prev, row]);
    setNewOption("");
    setCustomName("");
    setCustomDose("");
    setMessage(null);
  }

  function generatePdf() {
    if (rows.length === 0) {
      setMessage({ text: t("There is nothing to generate."), kind: "error" });
      return;
    }
    if (preparedBy === "") {
      setMessage({ text: t("Please select the staff member who prepared this list."), kind: "error" });
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/reports/purchase-list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId: selectedBranchId,
            preparedBy,
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
              onChange={(e) =>
                guardedAction(() => push(`/residents/medication/purchase?branch=${e.target.value}`))
              }
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
        {loadError ? (
          <div className="flex items-start gap-2 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{t("Could not load the purchase list for this branch.")}</p>
              <p className="mt-0.5 text-xs opacity-80">{loadError}</p>
            </div>
          </div>
        ) : reviewGroups.length === 0 ? (
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
                onChange={(e) => {
                  setNewResidentId(e.target.value === "" ? "" : Number(e.target.value));
                  // A medicine chosen for the previous resident is not valid
                  // for this one — clear it.
                  setNewOption("");
                  setCustomName("");
                  setCustomDose("");
                }}
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
                {availableMedicines.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} — {o.unit}
                  </option>
                ))}
                <option value={OTHER_VALUE}>{t("Other…")}</option>
              </select>
            </div>

            {newOption === OTHER_VALUE && (
              <>
                <div className="min-w-[180px] flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-fg-muted" htmlFor="purchase-add-name">
                    {t("Item name")}
                    <span className="ml-0.5 text-red-500">*</span>
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
                <div className="min-w-[140px] flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-fg-muted" htmlFor="purchase-add-dose">
                    {t("Dose")}
                    <span className="ml-0.5 text-red-500">*</span>
                  </label>
                  <input
                    id="purchase-add-dose"
                    type="text"
                    value={customDose}
                    onChange={(e) => setCustomDose(e.target.value)}
                    placeholder={t("e.g. 1 Tablet twice daily")}
                    className="w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </>
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
            {` · ${totals.residentCount} ${t("residents")}`}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px]">
              <label className="mb-1.5 block text-xs font-medium text-fg-muted" htmlFor="purchase-prepared-by">
                {t("Prepared By")}
                <span className="ml-0.5 text-red-500">*</span>
              </label>
              <select
                id="purchase-prepared-by"
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                className="w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">{t("Select staff")}</option>
                {staffOptions.map((s) => (
                  <option key={s.staffId} value={s.staffId}>
                    {s.name}
                    {s.ownBranch ? "" : ` (${t("HQ")})`}
                  </option>
                ))}
              </select>
            </div>
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
              disabled={isPending || rows.length === 0 || preparedBy === ""}
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
              {`${group.rows.length} ${t("items")}`}
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
        {row.reason && <div className="mt-0.5 text-xs text-fg-faint">{row.reason}</div>}
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
