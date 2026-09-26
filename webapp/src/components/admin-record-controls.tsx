"use client";

// HQ-ADMIN Edit / Delete buttons for any record row or card.
//
//   <AdminRecordControls kind="progress_note" id={note.id} />
//
// The edit dialog loads the record's editable columns from the server when
// it opens and submits only the fields that were actually changed.
//
// Renders NOTHING unless <AdminRecordProvider enabled> (set once in the
// (app) layout from isHqAdmin(account)) says this login is an HQ ADMIN.
// That is only the visual gate -- the Server Actions re-check isHqAdmin()
// themselves, so hiding the buttons is not what keeps other users out.
//
// Must stay free of server imports (CLAUDE.md footgun): it only imports the
// pure registry in lib/admin-records.ts and the "use server" actions.

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, X, TriangleAlert, CheckCircle2 } from "lucide-react";
import { useTranslation } from "@/components/language-provider";
import { useFormDirtyTracking } from "@/lib/use-form-dirty-tracking";
import {
  ADMIN_RECORDS,
  toKlInputValue,
  type AdminField,
  type AdminRecordKind,
} from "@/lib/admin-records";
import {
  adminDeleteRecordAction,
  adminGetRecordAction,
  adminStaffOptionsAction,
  adminUpdateRecordAction,
  type AdminFormValue,
} from "@/app/(app)/admin-record-actions";

// ─── Visibility context ───────────────────────────────────────────────────────

const AdminRecordContext = createContext(false);

// Per-record-kind values a config's `link` can derive from, e.g.
// { physio_assessment: { Assessment: 0.25, "Full Physio (1hr)": 1, ... } }.
// The (app) layout fills this from tbl_physio_treatment_types, so the physio
// edit dialog repopulates Credit hours from the same live values the entry
// form uses -- editing a binding in Supabase changes both, with no redeploy.
const LinkValuesContext = createContext<Partial<Record<AdminRecordKind, Record<string, number>>>>({});

export function AdminRecordProvider({
  enabled,
  linkValues = {},
  children,
}: {
  enabled: boolean;
  linkValues?: Partial<Record<AdminRecordKind, Record<string, number>>>;
  children: React.ReactNode;
}) {
  return (
    <AdminRecordContext.Provider value={enabled}>
      <LinkValuesContext.Provider value={linkValues}>{children}</LinkValuesContext.Provider>
    </AdminRecordContext.Provider>
  );
}

export function useIsHqAdmin(): boolean {
  return useContext(AdminRecordContext);
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const btnBase =
  "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";
const editBtn = `${btnBase} border-line-strong bg-surface text-fg-secondary hover:bg-hover hover:text-fg focus-visible:ring-indigo-500`;
const deleteBtn = `${btnBase} border-rose-200 bg-surface text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-500 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40`;
const inputCls =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40";

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// Stops a click on the controls from also toggling / navigating the card or
// clickable row they sit in.
function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

// ─── Value conversion ─────────────────────────────────────────────────────────

type FormValues = Record<string, AdminFormValue>;

function initialValue(field: AdminField, raw: unknown): AdminFormValue {
  switch (field.type) {
    case "boolean":
      return raw === true;
    case "multiselect":
      return Array.isArray(raw) ? raw.map(String) : [];
    case "datetime":
      return toKlInputValue(typeof raw === "string" ? raw : null);
    case "time":
      return typeof raw === "string" ? raw.slice(0, 5) : "";
    default:
      return raw === null || raw === undefined ? "" : String(raw);
  }
}

let staffOptionsCache: Promise<{ value: string; label: string }[]> | null = null;
function loadStaffOptions() {
  if (!staffOptionsCache) {
    staffOptionsCache = adminStaffOptionsAction().catch(() => {
      staffOptionsCache = null;
      return [];
    });
  }
  return staffOptionsCache;
}

// ─── Public component ─────────────────────────────────────────────────────────

type Props = {
  kind: AdminRecordKind;
  id: number;
  // Icon-only buttons for dense tables (still labelled for screen readers).
  compact?: boolean;
  className?: string;
  // Called after a successful delete, e.g. to close a detail view.
  onDeleted?: () => void;
};

export function AdminRecordControls({ kind, id, compact = false, className = "", onDeleted }: Props) {
  const enabled = useIsHqAdmin();
  const t = useTranslation();
  const [mode, setMode] = useState<"closed" | "edit" | "delete">("closed");
  const [toast, setToast] = useState<string | null>(null);
  const config = ADMIN_RECORDS[kind];

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!enabled) return null;

  const canEdit = config.fields.length > 0;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 ${className}`}
      onClick={stop}
      onKeyDown={stop}
      data-admin-controls
    >
      {canEdit && (
        <button
          type="button"
          className={editBtn}
          onClick={() => setMode("edit")}
          aria-label={t("Edit {record}", { record: t(config.label) })}
          title={compact ? t("Edit") : undefined}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          {!compact && t("Edit")}
        </button>
      )}
      <button
        type="button"
        className={deleteBtn}
        onClick={() => setMode("delete")}
        aria-label={t("Delete {record}", { record: t(config.label) })}
        title={compact ? t("Delete") : undefined}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        {!compact && t("Delete")}
      </button>

      {mode === "edit" &&
        createPortal(
          <EditDialog
            kind={kind}
            id={id}
            onClose={() => setMode("closed")}
            onSaved={() => {
              setMode("closed");
              setToast(t("Record updated"));
            }}
          />,
          document.body
        )}
      {mode === "delete" &&
        createPortal(
          <DeleteDialog
            kind={kind}
            id={id}
            onClose={() => setMode("closed")}
            onDeleted={() => {
              setMode("closed");
              setToast(t("Record deleted"));
              onDeleted?.();
            }}
          />,
          document.body
        )}
      {toast &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-lg dark:border-emerald-900/60 dark:bg-emerald-950/80 dark:text-emerald-200"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {toast}
          </div>,
          document.body
        )}
    </span>
  );
}

// ─── Dialog shell ─────────────────────────────────────────────────────────────

function DialogShell({
  titleId,
  onDismiss,
  busy,
  wide,
  children,
}: {
  titleId: string;
  onDismiss: () => void;
  busy: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Window capture phase + stopPropagation, so Escape closes only this
    // dialog and not a host modal underneath it (e.g. Stock History).
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!busy) onDismiss();
    }
    window.addEventListener("keydown", onKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [busy, onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onDismiss();
      }}
      onClick={stop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-full w-full flex-col rounded-lg border border-line bg-elevated shadow-xl ${wide ? "max-w-2xl" : "max-w-md"}`}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Edit dialog ──────────────────────────────────────────────────────────────

function EditDialog({
  kind,
  id,
  onClose,
  onSaved,
}: {
  kind: AdminRecordKind;
  id: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslation();
  const router = useRouter();
  const config = ADMIN_RECORDS[kind];
  const linkValues = useContext(LinkValuesContext)[kind];
  // null while the record is loading from the server.
  const [initial, setInitial] = useState<FormValues | null>(null);
  const [form, setForm] = useState<FormValues>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [staffOptions, setStaffOptions] = useState<{ value: string; label: string }[] | null>(null);
  const firstFieldRef = useRef<HTMLDivElement>(null);
  const titleId = `admin-edit-${kind}-${id}`;

  // Only the fields the admin actually touched are sent.
  function changedValues(): FormValues {
    if (!initial) return {};
    return Object.fromEntries(
      Object.entries(form).filter(([name, value]) => JSON.stringify(value) !== JSON.stringify(initial[name]))
    );
  }

  // save() is also the dirty-guard's "Save and leave" handler, which is
  // registered before markClean exists -- so it reaches markClean via a ref.
  const markCleanRef = useRef<() => void>(() => {});

  async function save() {
    const changes = changedValues();
    if (Object.keys(changes).length === 0) {
      markCleanRef.current();
      return { success: true };
    }
    const result = await adminUpdateRecordAction(kind, id, changes);
    if (result.success) {
      markCleanRef.current();
      router.refresh();
    }
    return result;
  }

  const { markDirty, markClean } = useFormDirtyTracking(`admin-edit-${kind}-${id}`, save);
  useEffect(() => {
    markCleanRef.current = markClean;
  }, [markClean]);

  // Applies the config's field link (e.g. physio credit hours following the
  // treatment type) to a candidate set of values. Run both when a field
  // changes and once when the record loads, so the linked field is already
  // correct before the admin touches anything.
  const applyLink = useCallback(
    (values: FormValues): FormValues => {
      const link = config.link;
      if (!link) return values;
      const selected = values[link.whenField];
      if (typeof selected !== "string" || !linkValues) return values;
      const next = link.valueFor(selected, linkValues);
      // Nothing known for this type (an empty or still-loading lookup) --
      // leave whatever the admin had rather than blanking the field.
      if (next === null) return values;
      return { ...values, [link.populateField]: next };
    },
    [config.link, linkValues]
  );

  useEffect(() => {
    let cancelled = false;
    adminGetRecordAction(kind, id).then((result) => {
      if (cancelled) return;
      if (!result.success || !result.values) {
        setLoadError(result.error ?? "Could not load the record");
        return;
      }
      const values = result.values;
      const loaded = applyLink(
        Object.fromEntries(config.fields.map((f) => [f.name, initialValue(f, values[f.name])]))
      );
      setInitial(loaded);
      setForm(loaded);
    });
    if (config.fields.some((f) => f.type === "staff")) {
      loadStaffOptions().then((opts) => {
        if (!cancelled) setStaffOptions(opts);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [kind, id, config.fields, applyLink]);

  useEffect(() => {
    if (initial) firstFieldRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
  }, [initial]);

  function setField(name: string, value: AdminFormValue) {
    setForm((prev) => applyLink({ ...prev, [name]: value }));
    markDirty();
  }

  function close() {
    markClean();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await save();
      if (result.success) onSaved();
      else setError(result.error ?? t("Could not save changes"));
    });
  }

  return (
    <DialogShell titleId={titleId} onDismiss={close} busy={isPending} wide>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-fg">
              {t("Edit {record}", { record: t(config.label) })}
            </h2>
            <p className="mt-0.5 text-xs text-fg-faint">{t("HQ administrator correction")}</p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={isPending}
            aria-label={t("Close")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div ref={firstFieldRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {config.source === "sheet" && (
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {t("This record is saved to the Google Sheet first, then synced to the app.")}
            </p>
          )}
          {loadError ? (
            <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
              {t(loadError)}
            </div>
          ) : !initial ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-faint" role="status">
              <Spinner />
              {t("Loading...")}
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {config.fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={form[field.name]}
                staffOptions={staffOptions}
                onChange={(v) => setField(field.name, v)}
                disabled={isPending}
              />
            ))}
          </div>
          )}
        </div>

        <div className="border-t border-line px-6 py-4">
          {error && (
            <div role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
              {t(error)}
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={close}
              disabled={isPending}
              className="h-10 rounded-md border border-line-strong bg-surface px-4 text-sm font-medium text-fg-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={isPending || !initial}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {isPending && <Spinner />}
              {isPending ? t("Saving...") : t("Save changes")}
            </button>
          </div>
        </div>
      </form>
    </DialogShell>
  );
}

function FieldInput({
  field,
  value,
  staffOptions,
  onChange,
  disabled,
}: {
  field: AdminField;
  value: AdminFormValue;
  staffOptions: { value: string; label: string }[] | null;
  onChange: (value: AdminFormValue) => void;
  disabled: boolean;
}) {
  const t = useTranslation();
  const id = `admin-field-${field.name}`;
  const wide = field.type === "textarea" || field.type === "multiselect";
  const label = (
    <label htmlFor={id} className="mb-1 block text-sm font-medium text-fg-secondary">
      {t(field.label)}
      {field.required && <span className="ml-0.5 text-rose-600 dark:text-rose-400" aria-hidden="true">*</span>}
    </label>
  );

  if (field.type === "boolean") {
    return (
      <label className="flex h-full items-center gap-2 pt-6 text-sm font-medium text-fg-secondary">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-line-strong text-indigo-600 focus:ring-indigo-500"
        />
        {t(field.label)}
      </label>
    );
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 block text-sm font-medium text-fg-secondary">{t(field.label)}</legend>
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((o) => {
            const on = selected.includes(o.value);
            return (
              <label
                key={o.value}
                className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors ${
                  on
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                    : "border-line-strong bg-surface text-fg-secondary hover:bg-hover"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={disabled}
                  onChange={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                />
                {t(o.label)}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  const text = typeof value === "string" ? value : "";
  let control: React.ReactNode;

  if (field.type === "textarea") {
    control = (
      <textarea id={id} rows={3} value={text} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={field.required} className={inputCls} />
    );
  } else if (field.type === "select" || field.type === "staff") {
    let options = field.type === "staff" ? staffOptions ?? [] : field.options ?? [];
    // Keep a current value that is no longer in the list (e.g. inactive staff).
    if (text && !options.some((o) => o.value === text)) options = [{ value: text, label: text }, ...options];
    control = (
      <select id={id} value={text} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={field.required} className={inputCls}>
        <option value="">{field.type === "staff" && staffOptions === null ? t("Loading...") : t("-- None --")}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {field.type === "staff" ? o.label : t(o.label)}
          </option>
        ))}
      </select>
    );
  } else {
    const type = field.type === "datetime" ? "datetime-local" : field.type === "number" ? "number" : field.type === "time" ? "time" : "text";
    control = (
      <input
        id={id}
        type={type}
        inputMode={field.type === "number" ? "decimal" : undefined}
        step={field.type === "number" ? "any" : undefined}
        min={field.min}
        max={field.max}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={field.required}
        className={inputCls}
      />
    );
  }

  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      {label}
      {control}
    </div>
  );
}

// ─── Delete dialog ────────────────────────────────────────────────────────────

function DeleteDialog({
  kind,
  id,
  onClose,
  onDeleted,
}: {
  kind: AdminRecordKind;
  id: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslation();
  const router = useRouter();
  const config = ADMIN_RECORDS[kind];
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = `admin-delete-${kind}-${id}`;

  useEffect(() => {
    // Safe default focus: Cancel, not the destructive button.
    cancelRef.current?.focus();
  }, []);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await adminDeleteRecordAction(kind, id);
      if (result.success) {
        router.refresh();
        onDeleted();
      } else {
        setError(result.error ?? t("Could not delete the record"));
      }
    });
  }

  return (
    <DialogShell titleId={titleId} onDismiss={onClose} busy={isPending}>
      <div className="p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300">
            <TriangleAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id={titleId} className="text-lg font-bold text-fg">
              {t("Delete {record}?", { record: t(config.label) })}
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              {t("This permanently removes the record for everyone. This cannot be undone.")}
            </p>
            {config.source === "sheet" && (
              <p className="mt-2 text-xs text-fg-faint">{t("The row is also removed from the Google Sheet.")}</p>
            )}
            {(kind === "wound_photo" || kind === "wound_session") && (
              <p className="mt-2 text-xs text-fg-faint">{t("Photos are moved to the Google Drive trash.")}</p>
            )}
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
            {t(error)}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="h-10 rounded-md border border-line-strong bg-surface px-4 text-sm font-medium text-fg-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-rose-600 px-4 text-sm font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {isPending ? <Spinner /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
            {isPending ? t("Deleting...") : t("Delete")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
