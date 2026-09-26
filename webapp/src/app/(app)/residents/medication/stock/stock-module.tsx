"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileDown,
  History,
  PackagePlus,
  Info,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { useDirtyForm, type SaveResult } from "@/lib/dirty-form-context";
import { formatDate, formatDateTime, fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/format-date";
import {
  LOW_STOCK_DAYS,
  STOCK_UNITS,
  computeStockStatus,
  defaultStockUnitForOrderUnit,
  trackingFor,
  type StockOrder,
  type StockStatus,
} from "@/lib/medication-stock";
import { recordStockEntryAction } from "./stock-actions";
import { AdminRecordControls, useIsHqAdmin } from "@/components/admin-record-controls";

// ── Types (built by page.tsx) ─────────────────────────────────────────────────

export type StockResident = { id: number; name: string; residentTextId: string; branchId: number };

export type StaffPick = { staffId: string; name: string; ownBranch: boolean };

export type StockOrderRow = {
  rxOrderId: string;
  dosageForm: string | null;
  brandName: string | null;
  activeIngredient: string;
  dose: number | null;
  orderUnit: string | null;
  frequency: string | null;
  dosingDays: string | null;
  prn: boolean;
  /** "OSEM" | "Family" — picks which stock PDF lists it. */
  suppliedBy: string | null;
  /** The order's schedule, to preview the balance at a back-dated entry time. */
  schedule: StockOrder;
  status: StockStatus;
  lastStockDate: string | null;
  lastRegisteredBy: string | null;
};

export type StockHistoryRow = {
  id: number; // tbl_medication_stock.id (for the HQ-admin Edit/Delete controls)
  stockId: string;
  stockDate: string;
  entryType: string;
  balance: number;
  unit: string;
  dailyUsage: number | null;
  daysRemaining: number | null;
  registeredByName: string | null;
};

type EntryType = "Stock Count" | "Stock Received";

// ── Formatting ────────────────────────────────────────────────────────────────

const DASH = "—";

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

function drugLabel(o: StockOrderRow): string {
  return [o.brandName || o.activeIngredient, o.brandName ? `(${o.activeIngredient})` : null]
    .filter(Boolean)
    .join(" ");
}

function scheduleLabel(o: StockOrderRow, t: (s: string) => string): string {
  const dose = o.dose !== null ? `${o.dose} ${o.orderUnit ? t(o.orderUnit) : ""}`.trim() : "";
  const days = o.dosingDays && o.dosingDays !== "Everyday"
    ? o.dosingDays.split(",").map((d) => t(d.trim()).slice(0, 3)).join("/")
    : "";
  return [dose, o.frequency ? t(o.frequency) : "", days].filter(Boolean).join(" · ");
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "Tue 13/10/2026" from a YYYY-MM-DD date.
function dayLabel(isoDate: string, t: (s: string) => string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${t(weekday).slice(0, 3)} ${formatDate(isoDate)}`;
}

const btnFocus = "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40";

// ── Badges ────────────────────────────────────────────────────────────────────

function DaysBadge({ row }: { row: StockOrderRow }) {
  const t = useTranslation();
  const { daysRemaining: days, lastDoseDate, lastsUntilOrderEnd } = row.status;
  if (lastsUntilOrderEnd) {
    return (
      <div>
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          {t("Enough until order ends")}
        </span>
        <div className="mt-1 text-[11px] text-fg-subtle">
          {t("Order ends {date}", { date: dayLabel(lastsUntilOrderEnd, t) })}
        </div>
      </div>
    );
  }
  if (days === null) return <span className="text-fg-faint">{DASH}</span>;

  const tone =
    days === 0
      ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
      : days < LOW_STOCK_DAYS
        ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900"
        : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900";
  const Icon = days < LOW_STOCK_DAYS ? AlertTriangle : CheckCircle2;

  const badge = (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {days === 0 ? t("Out of stock") : t("{days} days left", { days })}
    </span>
  );

  return (
    <div>
      {badge}
      <div className="mt-1 text-[11px] text-fg-subtle">
        {lastDoseDate
          ? t("Last dose {date}", { date: dayLabel(lastDoseDate, t) })
          : t("No doses left after today")}
      </div>
    </div>
  );
}

function BalanceCell({ row }: { row: StockOrderRow }) {
  const t = useTranslation();
  const s = row.status;
  if (s.balance === null || !s.unit) {
    return <span className="text-sm text-fg-faint italic">{t("Not recorded yet")}</span>;
  }
  return (
    <div>
      <div className="text-sm font-semibold text-fg">
        {fmtQty(s.balance)} {t(s.unit)}
      </div>
      <div
        className="text-[11px] text-fg-subtle"
        title={s.forecast ? t("Forecast from the medication order since the last stock entry, not a physical count.") : undefined}
      >
        {s.forecast ? t("Forecast") : trackingFor(s.unit) === "Estimate" ? t("Last counted (estimate)") : t("Last counted")}
      </div>
    </div>
  );
}

function ActionButtons({ row, onAction }: { row: StockOrderRow; onAction: (row: StockOrderRow, a: EntryType | "History") => void }) {
  const t = useTranslation();
  const base = `inline-flex min-h-9 items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-fg-secondary hover:bg-hover transition-colors ${btnFocus}`;
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={base} onClick={() => onAction(row, "Stock Count")}>
        <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
        {t("Stock Count")}
      </button>
      <button type="button" className={base} onClick={() => onAction(row, "Stock Received")}>
        <PackagePlus className="h-3.5 w-3.5" aria-hidden />
        {t("Stock Received")}
      </button>
      <button type="button" className={base} onClick={() => onAction(row, "History")}>
        <History className="h-3.5 w-3.5" aria-hidden />
        {t("View History")}
      </button>
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

function Modal({ title, subtitle, onClose, children, wide }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const t = useTranslation();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Stop the page behind from scrolling (iOS scrolls it through the backdrop).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Phones (< sm): bottom sheet, full width, sized with dvh so Safari's
  // collapsing toolbar and the on-screen keyboard never hide the buttons,
  // plus safe-area padding for the home indicator. sm+: centred dialog.
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-elevated shadow-xl sm:max-h-[90dvh] sm:rounded-xl ${wide ? "sm:max-w-3xl" : "sm:max-w-md"}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-fg sm:text-sm">{title}</h3>
            {subtitle && <p className="mt-0.5 break-words text-xs text-fg-subtle">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className={`-mr-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-hover ${btnFocus}`}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">{children}</div>
      </div>
    </div>
  );
}

// ── Stock Count / Stock Received ──────────────────────────────────────────────

function EntryModal({ row, entryType, staffOptions, history, onClose, onSaved }: {
  row: StockOrderRow;
  entryType: EntryType;
  staffOptions: StaffPick[];
  history: StockHistoryRow[];
  onClose: () => void;
  onSaved: (pendingSync: boolean) => void;
}) {
  const t = useTranslation();
  const current = row.status;
  const received = entryType === "Stock Received";
  // Received must stay in the unit the balance is already recorded in;
  // changing unit is a Stock Count (a new baseline).
  const unitLocked = received && !!current.unit;

  // datetime-local wall clock in Kuala Lumpur; defaults to now.
  const [openedAt] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [entryDate, setEntryDate] = useState(openedAt);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<string>(current.unit ?? defaultStockUnitForOrderUnit(row.orderUnit) ?? "");
  const [registeredBy, setRegisteredBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { markDirty, markClean } = useDirtyForm(`medication-stock-entry-${row.rxOrderId}`);

  const entryIso = entryDate ? fromDatetimeLocalValue(entryDate) : "";
  const entryTime = entryIso ? new Date(entryIso).getTime() : NaN;
  const entryValid = isFinite(entryTime) && entryDate <= toDatetimeLocalValue(new Date().toISOString());
  const backDated = entryValid && entryDate < openedAt;
  // Entries recorded after the chosen time are not recalculated.
  const laterEntries = backDated ? history.filter((h) => new Date(h.stockDate).getTime() > entryTime).length : 0;

  // Balance as it was at the entry time (same rule the server uses).
  const asOf = backDated ? history.find((h) => new Date(h.stockDate).getTime() <= entryTime) ?? null : null;
  const balanceAtEntry = !backDated
    ? current
    : computeStockStatus(asOf ? { balance: asOf.balance, unit: asOf.unit, stock_date: asOf.stockDate } : null, row.schedule, new Date(entryTime));

  const qty = parseFloat(quantity);
  const qtyValid = quantity.trim() !== "" && isFinite(qty) && qty >= 0 && (!received || qty > 0);
  const currentBalance = balanceAtEntry.balance ?? 0;
  const newBalance = qtyValid ? (received ? currentBalance + qty : qty) : null;

  const tracking = trackingFor(unit);
  const unitMismatch =
    tracking === "Count" && !row.prn && defaultStockUnitForOrderUnit(row.orderUnit) !== unit;

  function save(): Promise<SaveResult> {
    setError(null);
    if (!entryValid) return Promise.resolve({ success: false, error: t("Entry date/time cannot be in the future") });
    if (!qtyValid) return Promise.resolve({ success: false, error: t("A valid quantity is required") });
    if (!unit) return Promise.resolve({ success: false, error: t("Unit is required") });
    if (!registeredBy) return Promise.resolve({ success: false, error: t("Registered By is required") });

    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await recordStockEntryAction({
          rxOrderId: row.rxOrderId,
          entryType,
          quantity: qty,
          unit,
          registeredBy,
          entryDate: entryIso,
        });
        if (!result.success) {
          setError(result.error ?? "Unknown error");
          resolve({ success: false, error: result.error });
          return;
        }
        markClean();
        onSaved(!!result.pendingSync);
        resolve({ success: true });
      });
    });
  }

  // Wire into the app-wide unsaved-changes guard while anything is entered.
  const dirty = quantity.trim() !== "" || registeredBy !== "" || entryDate !== openedAt;
  useEffect(() => {
    if (dirty) markDirty(save);
    else markClean();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, quantity, unit, registeredBy, entryDate]);
  useEffect(() => () => markClean(), [markClean]);

  function close() {
    markClean();
    onClose();
  }

  const inputCls =
    "block min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-input px-3 py-2 text-base text-fg sm:min-h-10 sm:text-sm placeholder-fg-faint focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-surface-muted disabled:text-fg-faint";
  const labelCls = "mb-1 block text-xs font-medium text-fg-muted";

  return (
    <Modal title={t(entryType)} subtitle={drugLabel(row)} onClose={close}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save().then((r) => { if (!r.success && r.error) setError(r.error); });
        }}
      >
        <div>
          <label htmlFor="stock-date" className={labelCls}>
            {t("Entry Date/Time")}
            <span className="ml-0.5 text-red-500"> *</span>
          </label>
          <input
            id="stock-date"
            type="datetime-local"
            value={entryDate}
            max={toDatetimeLocalValue(new Date().toISOString())}
            onChange={(e) => setEntryDate(e.target.value)}
            className={`${inputCls} appearance-none`}
          />
          {backDated ? (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              {laterEntries > 0
                ? t("Back-dated entry. {n} later entries are not recalculated.", { n: laterEntries })
                : t("Back-dated entry. The balance is calculated as at this date/time.")}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-fg-subtle">{t("Change it to record a count or delivery from an earlier time.")}</p>
          )}
        </div>

        <div>
          <label htmlFor="stock-qty" className={labelCls}>
            {received ? t("Quantity received") : t("Counted balance")}
            <span className="ml-0.5 text-red-500"> *</span>
          </label>
          <input
            id="stock-qty"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-fg-subtle">
            {received
              ? t("Enter only the newly received quantity. The new balance is calculated for you.")
              : t("Enter what is physically there now. This replaces the forecast.")}
          </p>
        </div>

        <div>
          <label htmlFor="stock-unit" className={labelCls}>
            {t("Unit")}
            <span className="ml-0.5 text-red-500"> *</span>
          </label>
          <select id="stock-unit" value={unit} disabled={unitLocked} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
            <option value="">{t("Select unit")}</option>
            <optgroup label={t("Countable — balance is forecast")}>
              {STOCK_UNITS.filter((u) => u.tracking === "Count").map((u) => (
                <option key={u.unit} value={u.unit}>{t(u.unit)}</option>
              ))}
            </optgroup>
            <optgroup label={t("Estimate — not forecast")}>
              {STOCK_UNITS.filter((u) => u.tracking === "Estimate").map((u) => (
                <option key={u.unit} value={u.unit}>{t(u.unit)}</option>
              ))}
            </optgroup>
          </select>
          {unitLocked && (
            <p className="mt-1 text-[11px] text-fg-subtle">
              {t("Stock is recorded in {unit}. Use Stock Count to change the unit.", { unit: t(current.unit!) })}
            </p>
          )}
          {tracking === "Estimate" && (
            <p className="mt-1 text-[11px] text-fg-subtle">
              {t("Estimate units are never reduced automatically. Daily usage and days remaining show as —.")}
            </p>
          )}
          {unitMismatch && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              {t("The order is dosed in {unit}, so usage cannot be forecast in this unit.", { unit: row.orderUnit ? t(row.orderUnit) : DASH })}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="stock-staff" className={labelCls}>
            {t("Registered By")}
            <span className="ml-0.5 text-red-500"> *</span>
          </label>
          <select id="stock-staff" value={registeredBy} onChange={(e) => setRegisteredBy(e.target.value)} className={inputCls}>
            <option value="">{t("Select staff")}</option>
            {staffOptions.map((s) => (
              <option key={s.staffId} value={s.staffId}>
                {s.name}{s.ownBranch ? "" : ` (${t("HQ")})`}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md bg-surface-muted px-3 py-2 text-sm text-fg-secondary">
          {received && (
            <div className="flex justify-between">
              <span>{backDated ? t("Balance at entry time") : t("Current balance")}</span>
              <span>{balanceAtEntry.unit ? `${fmtQty(currentBalance)} ${t(balanceAtEntry.unit)}` : t("Not recorded yet")}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-fg">
            <span>{t("New balance")}</span>
            <span>{newBalance === null ? DASH : `${fmtQty(Math.round(newBalance * 100) / 100)} ${unit ? t(unit) : ""}`}</span>
          </div>
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="submit"
            disabled={isPending}
            className={`min-h-11 rounded-lg sm:min-h-10 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors ${btnFocus}`}
          >
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t("Saving...")}
              </span>
            ) : t("Save")}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={isPending}
            className={`min-h-11 rounded-lg sm:min-h-10 border border-line bg-surface px-4 py-2 text-sm font-medium text-fg-secondary hover:bg-hover disabled:opacity-50 transition-colors ${btnFocus}`}
          >
            {t("Cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

function HistoryModal({ row, rows, onClose }: { row: StockOrderRow; rows: StockHistoryRow[]; onClose: () => void }) {
  const t = useTranslation();
  const isHqAdmin = useIsHqAdmin();

  // Stored snapshots use 0 for "not applicable" (Sheet/AppSheet convention).
  function snapshot(h: StockHistoryRow, value: number | null): string {
    const applicable = trackingFor(h.unit) === "Count" && !row.prn && (h.dailyUsage ?? 0) > 0;
    return applicable && value !== null ? fmtQty(value) : DASH;
  }

  return (
    <Modal title={t("Stock History")} subtitle={`${drugLabel(row)} · ${row.rxOrderId}`} onClose={onClose} wide>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-subtle">{t("No stock records for this order yet.")}</p>
      ) : (
        <div>
          <ul className="divide-y divide-line-subtle sm:hidden">
            {rows.map((h) => (
              <li key={h.stockId} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-fg">{t(h.entryType)}</span>
                  <span className="text-sm font-semibold text-fg">{fmtQty(h.balance)} {t(h.unit)}</span>
                </div>
                <div className="mt-0.5 text-xs text-fg-subtle">
                  {formatDateTime(h.stockDate)} · {h.registeredByName ?? DASH}
                </div>
                <div className="mt-0.5 text-xs text-fg-subtle">
                  {t("Daily Usage")}: {snapshot(h, h.dailyUsage)} · {t("Days Remaining")}: {snapshot(h, h.daysRemaining)}
                </div>
                <AdminRecordControls kind="medication_stock" id={h.id} className="mt-2" />
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-fg-subtle">
              <tr className="border-b border-line-subtle">
                <th className="py-2 pr-3 font-medium">{t("Stock Date")}</th>
                <th className="py-2 pr-3 font-medium">{t("Entry Type")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("Stock Balance")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("Daily Usage")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("Days Remaining")}</th>
                <th className="py-2 font-medium">{t("Registered By")}</th>
                {isHqAdmin && <th className="py-2 pl-3 font-medium">{t("Actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.stockId} className="border-b border-line-subtle last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-fg-secondary">{formatDateTime(h.stockDate)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-fg">{t(h.entryType)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-fg">{fmtQty(h.balance)} {t(h.unit)}</td>
                  <td className="py-2 pr-3 text-right text-fg-secondary">{snapshot(h, h.dailyUsage)}</td>
                  <td className="py-2 pr-3 text-right text-fg-secondary">{snapshot(h, h.daysRemaining)}</td>
                  <td className="py-2 text-fg-secondary">{h.registeredByName ?? DASH}</td>
                  {isHqAdmin && (
                    <td className="py-1.5 pl-3">
                      <AdminRecordControls kind="medication_stock" id={h.id} compact />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="mt-3 text-[11px] text-fg-subtle">
            {t("Daily usage and days remaining are as calculated when each entry was recorded.")}
          </p>
        </div>
      )}
    </Modal>
  );
}

// ── Print PDF menu ────────────────────────────────────────────────────────────

type PdfReport = {
  href: string;
  title: string;
  description: string;
  icon: typeof FileDown;
  /** Set when there is nothing to list: clicking shows this instead of opening a tab. */
  emptyMessage: string | null;
};

// One "Print PDF" button with a menu, instead of a row of long-labelled
// buttons. Each item opens a one-off PDF (rendered in memory by
// /api/reports/*, never stored) in a new tab.
function PrintPdfMenu({ reports, onEmpty }: { reports: PdfReport[]; onEmpty: (message: string) => void }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const items = itemRefs.current.filter(Boolean) as HTMLAnchorElement[];
    const i = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next =
        e.key === "Home" ? 0
        : e.key === "End" ? items.length - 1
        : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative w-full sm:w-auto">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="stock-pdf-menu"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors sm:min-h-10 sm:w-auto ${btnFocus}`}
      >
        <FileDown className="h-4 w-4" aria-hidden />
        {t("Print PDF")}
        <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div
          id="stock-pdf-menu"
          role="menu"
          aria-label={t("Print PDF")}
          onKeyDown={onMenuKeyDown}
          className="absolute inset-x-0 z-30 mt-2 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-lg sm:left-auto sm:right-0 sm:w-80"
        >
          {reports.map((r, i) => {
            const Icon = r.icon;
            return (
              <a
                key={r.href}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role="menuitem"
                href={r.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (r.emptyMessage) {
                    e.preventDefault();
                    onEmpty(r.emptyMessage);
                  }
                  close(false);
                }}
                className="flex min-h-11 items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-hover focus:bg-hover focus:outline-none"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{r.title}</span>
                  <span className="block text-xs text-fg-subtle">{r.description}</span>
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function StockModule({ residents, selectedResidentId, orders, history, staffOptions }: {
  residents: StockResident[];
  selectedResidentId: number | null;
  orders: StockOrderRow[];
  history: Record<string, StockHistoryRow[]>;
  staffOptions: StaffPick[];
}) {
  const t = useTranslation();
  const push = useNavPush();
  const [active, setActive] = useState<{ row: StockOrderRow; action: EntryType | "History" } | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "info" | "error"; text: string } | null>(null);

  const index = residents.findIndex((r) => r.id === selectedResidentId);
  const selected = index >= 0 ? residents[index] : null;

  function goTo(id: number | null) {
    setNotice(null);
    push(id === null ? "/residents/medication/stock" : `/residents/medication/stock?resident=${id}`);
  }

  const navBtn = `inline-flex min-h-10 items-center gap-1 rounded-md border border-line bg-surface px-3 text-sm text-fg-secondary hover:bg-hover disabled:opacity-40 transition-colors ${btnFocus}`;

  return (
    <div className="space-y-4">
      {/* Resident picker — patient-by-patient */}
      <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
        <label htmlFor="stock-resident" className="mb-1 block text-xs font-medium text-fg-muted">
          {t("Resident")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            id="stock-resident"
            value={selected ? String(selected.id) : ""}
            onChange={(e) => goTo(e.target.value ? Number(e.target.value) : null)}
            className="min-h-10 w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:flex-1"
          >
            <option value="">{t("Select resident")}</option>
            {residents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.residentTextId})
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="button" className={navBtn} disabled={index <= 0} onClick={() => goTo(residents[index - 1].id)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {t("Previous")}
            </button>
            <button
              type="button"
              className={navBtn}
              disabled={index >= residents.length - 1}
              onClick={() => goTo(residents[index + 1].id)}
            >
              {t("Next")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        {selected && (
          <p className="mt-2 text-xs text-fg-subtle">
            {t("Resident {n} of {total}", { n: index + 1, total: residents.length })}
          </p>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
            notice.kind === "success"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : notice.kind === "error"
                ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                : "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
          }`}
        >
          {notice.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : notice.kind === "error" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          {notice.text}
        </div>
      )}

      {!selected ? (
        <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-fg-subtle">
          {t("Select a resident to review their medication stock.")}
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface shadow-sm">
          <div className="border-b border-line-subtle px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <h2 className="text-base font-semibold text-fg">{selected.name}</h2>
              {/* With no matching orders there is nothing to render, so the
                  menu says so instead of opening an empty tab. */}
              <PrintPdfMenu
                onEmpty={(text) => setNotice({ kind: "info", text })}
                reports={[
                  {
                    href: `/api/reports/stock-summary?resident=${selected.id}`,
                    title: t("Stock Summary"),
                    description: t("All medicines in one table, any supplier"),
                    icon: ClipboardList,
                    emptyMessage: orders.length === 0
                      ? t("Nothing to generate: this resident has no active medication orders.")
                      : null,
                  },
                  {
                    href: `/api/reports/osem-purchase-list?resident=${selected.id}`,
                    title: t("OSEM Purchase List"),
                    description: t("Internal: OSEM-supplied medicines to restock"),
                    icon: ShoppingCart,
                    emptyMessage: orders.some((o) => o.suppliedBy === "OSEM")
                      ? null
                      : t("Nothing to generate: this resident has no active OSEM-supplied medicine."),
                  },
                  {
                    href: `/api/reports/family-reminder?resident=${selected.id}`,
                    title: t("Family Medicine Reminder"),
                    description: t("Bilingual restock notice for the family"),
                    icon: Users,
                    emptyMessage: orders.some((o) => o.suppliedBy === "Family")
                      ? null
                      : t("Nothing to generate: this resident has no active family-supplied medicine."),
                  },
                ]}
              />
            </div>
          </div>

          {orders.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-subtle">{t("No active medication orders.")}</p>
          ) : (
            <>
              {/* Mobile: cards */}
              <ul className="divide-y divide-line-subtle md:hidden">
                {orders.map((o) => (
                  <li key={o.rxOrderId} className="space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-fg">{drugLabel(o)}</div>
                        <div className="text-xs text-fg-subtle">{scheduleLabel(o, t)}</div>
                      </div>
                      <div className="text-right"><BalanceCell row={o} /></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                      <DaysBadge row={o} />
                      <span>
                        {t("Daily Usage")}: {o.status.dailyUsage === null ? DASH : `${fmtQty(o.status.dailyUsage)} ${t(o.status.unit!)}`}
                      </span>
                      {o.lastStockDate && (
                        <span>
                          {formatDateTime(o.lastStockDate)} · {o.lastRegisteredBy ?? DASH}
                        </span>
                      )}
                    </div>
                    <ActionButtons row={o} onAction={(row, action) => setActive({ row, action })} />
                  </li>
                ))}
              </ul>

              {/* Desktop: table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-fg-subtle">
                    <tr className="border-b border-line-subtle">
                      <th className="px-4 py-2 font-medium">{t("Medication")}</th>
                      <th className="px-3 py-2 font-medium">{t("Dosage / Frequency")}</th>
                      <th className="px-3 py-2 font-medium">{t("Current Balance")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("Daily Usage")}</th>
                      <th className="px-3 py-2 font-medium">{t("Days Remaining")}</th>
                      <th className="px-3 py-2 font-medium">{t("Last Stock Date")}</th>
                      <th className="px-3 py-2 font-medium">{t("Last Registered By")}</th>
                      <th className="px-4 py-2 font-medium">{t("Actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.rxOrderId} className="border-b border-line-subtle align-top last:border-0">
                        <td className="px-4 py-3 font-medium text-fg">{drugLabel(o)}</td>
                        <td className="px-3 py-3 text-fg-secondary">{scheduleLabel(o, t)}</td>
                        <td className="px-3 py-3"><BalanceCell row={o} /></td>
                        <td className="px-3 py-3 text-right text-fg-secondary">
                          {o.status.dailyUsage === null ? DASH : `${fmtQty(o.status.dailyUsage)} ${t(o.status.unit!)}`}
                        </td>
                        <td className="px-3 py-3"><DaysBadge row={o} /></td>
                        <td className="whitespace-nowrap px-3 py-3 text-fg-secondary">
                          {o.lastStockDate ? formatDateTime(o.lastStockDate) : DASH}
                        </td>
                        <td className="px-3 py-3 text-fg-secondary">{o.lastRegisteredBy ?? DASH}</td>
                        <td className="px-4 py-3">
                          <ActionButtons row={o} onAction={(row, action) => setActive({ row, action })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {active && active.action === "History" && (
        <HistoryModal row={active.row} rows={history[active.row.rxOrderId] ?? []} onClose={() => setActive(null)} />
      )}
      {active && active.action !== "History" && (
        <EntryModal
          key={`${active.row.rxOrderId}-${active.action}`}
          row={active.row}
          entryType={active.action}
          staffOptions={staffOptions}
          history={history[active.row.rxOrderId] ?? []}
          onClose={() => setActive(null)}
          onSaved={(pendingSync) => {
            setActive(null);
            setNotice(
              pendingSync
                ? { kind: "info", text: t("Saved to the Google Sheet. It will appear here after the automatic sync (about 1 minute).") }
                : { kind: "success", text: t("Stock saved.") }
            );
          }}
        />
      )}
    </div>
  );
}
