"use client";

import { useTranslation } from "@/components/language-provider";
import { messageForCode, type InvResident, type InvStaff } from "@/lib/inventory/core";

// Small presentational pieces shared by every Inventory form. Theme tokens
// only (docs/theming.md); coloured notices carry their dark: partner.

export const INPUT_CLS =
  "w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-surface-strong";
export const SMALL_INPUT_CLS =
  "w-full rounded-md border border-line-strong bg-input px-2 py-1.5 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
export const CARD_CLS = "rounded-lg border border-line bg-surface p-4 shadow-sm";
export const PRIMARY_BTN_CLS =
  "inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50";
export const SECONDARY_BTN_CLS =
  "inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg-secondary hover:bg-hover disabled:opacity-50";

export function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-fg-secondary">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function SubmitButton({ isPending, label, disabled }: { isPending: boolean; label: string; disabled?: boolean }) {
  const t = useTranslation();
  return (
    <button type="submit" className={PRIMARY_BTN_CLS} disabled={isPending || disabled}>
      {isPending && <Spinner />}
      {isPending ? t("Saving...") : label}
    </button>
  );
}

export function StaffSelect({
  staff,
  value,
  onChange,
  seniorOnly,
  label,
}: {
  staff: InvStaff[];
  value: string;
  onChange: (v: string) => void;
  seniorOnly?: boolean;
  label?: string;
}) {
  const t = useTranslation();
  const options = seniorOnly ? staff.filter((s) => s.isSenior) : staff;
  const hint = !seniorOnly
    ? undefined
    : options.length === 0
      ? t("No active Head Nurse, Assist. Head Nurse or Nursing Director on this branch's staff list. Add one under Staff first.")
      : t("Head Nurse, Assist. Head Nurse or Nursing Director");
  return (
    <Field label={label ?? t("Performed by")} required hint={hint}>
      <select className={INPUT_CLS} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("Select staff")}</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ResidentSelect({
  residents,
  value,
  onChange,
  required = true,
}: {
  residents: InvResident[];
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const t = useTranslation();
  return (
    <Field label={t("Resident")} required={required}>
      <select className={INPUT_CLS} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("Select resident")}</option>
        {residents.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.residentCode ? ` (${r.residentCode})` : ""}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ErrorNotice({ code }: { code: string | null }) {
  const t = useTranslation();
  if (!code) return null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {t(messageForCode(code))}
    </div>
  );
}

export function SuccessNotice({ data }: { data: Record<string, unknown> | null }) {
  const t = useTranslation();
  if (!data) return null;
  const ref = (data.txn_no ?? data.receipt_no ?? data.adjustment_no ?? data.transfer_no ?? data.request_no ?? "") as string;
  return (
    <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
      {t("Saved.")} {ref}
    </div>
  );
}

/** The confirm step of a soft rejection; the resubmit reuses the same key. */
export function ConfirmPanel({
  code,
  data,
  isPending,
  onConfirm,
  onCancel,
}: {
  code: string;
  data: unknown;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslation();
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return (
    <div role="alertdialog" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      <p className="font-medium">{t(messageForCode(code))}</p>
      {rows.length > 0 && (
        <ul className="list-disc pl-5 text-xs">
          {rows.slice(0, 10).map((r, i) => (
            <li key={i}>
              {r.line_no ? `${t("Line")} ${String(r.line_no)}` : ""}
              {r.before !== undefined ? ` ${t("Before")}: ${String(r.before)} → ${t("After")}: ${String(r.after)}` : ""}
              {r.reason ? ` (${String(r.reason)})` : ""}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" className={PRIMARY_BTN_CLS} disabled={isPending} onClick={onConfirm}>
          {isPending && <Spinner />}
          {t("Confirm and save")}
        </button>
        <button type="button" className={SECONDARY_BTN_CLS} disabled={isPending} onClick={onCancel}>
          {t("Go back and edit")}
        </button>
      </div>
    </div>
  );
}

export function FormStatus({
  state,
}: {
  state: {
    error: string | null;
    confirm: { code: string; data: unknown } | null;
    success: Record<string, unknown> | null;
    isPending: boolean;
    confirmAndResubmit: () => void;
    cancelConfirm: () => void;
  };
}) {
  return (
    <div className="space-y-2">
      <ErrorNotice code={state.error} />
      {state.confirm && (
        <ConfirmPanel
          code={state.confirm.code}
          data={state.confirm.data}
          isPending={state.isPending}
          onConfirm={state.confirmAndResubmit}
          onCancel={state.cancelConfirm}
        />
      )}
      <SuccessNotice data={state.success} />
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-fg-subtle">{text}</div>;
}
