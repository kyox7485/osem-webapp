"use client";

import { useState } from "react";
import type { Staff, LookupOption } from "@/lib/types";
import { STAFF_ROLE_OPTIONS, DEPARTMENT_OPTIONS, STAFF_STATUS_OPTIONS } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { useFormDirtyTracking } from "@/lib/use-form-dirty-tracking";

type Props = {
  staff?: Staff;
  positions: LookupOption[];
  branches: LookupOption[];
  isAdmin?: boolean;
  action: (formData: FormData) => Promise<{ error?: string } | void>;
};

const inputCls =
  "mt-1 w-full rounded-md border border-line-strong bg-input px-3 py-1.5 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export function StaffForm({ staff, positions, branches, isAdmin, action }: Props) {
  const t = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formId = staff ? `staff-edit-${staff.StaffID}` : "staff-new";
  const { markDirty, markClean } = useFormDirtyTracking(formId, async () => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return { success: false, error: "Form not found" };
    return handleSubmit(new FormData(form));
  });

  async function handleSubmit(formData: FormData): Promise<{ success: boolean; error?: string }> {
    setSubmitting(true);
    setError(null);
    const result = await action(formData);
    if (result?.error) {
      setError(result.error);
      setSubmitting(false);
      return { success: false, error: result.error };
    }
    markClean();
    return { success: true };
  }

  return (
    <form id={formId} action={(fd) => { void handleSubmit(fd); }} onChangeCapture={markDirty} className="max-w-lg space-y-4 rounded-md border border-line bg-surface p-4 shadow-sm">
      {error && <p className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <label className="block text-sm text-fg-secondary">
        {t("Name")} <span className="text-red-500">*</span>
        <input name="staff_name" defaultValue={staff?.staff_name} required className={inputCls} />
      </label>

      <label className="block text-sm text-fg-secondary">
        {t("Position")} <span className="text-red-500">*</span>
        <select name="position_id" defaultValue={staff?.position_id ?? ""} required className={inputCls}>
          <option value="" disabled>{t("Select a position")}</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-fg-secondary">
        {t("Branch")} <span className="text-red-500">*</span>
        <select name="branch_id" defaultValue={staff?.branch_id ?? ""} required className={inputCls}>
          <option value="" disabled>{t("Select a branch")}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </label>

      {isAdmin ? (
        <label className="block text-sm text-fg-secondary">
          {t("Role")} <span className="text-red-500">*</span>
          <select name="role" defaultValue={staff?.role ?? ""} required className={inputCls}>
            <option value="" disabled>{t("Select a role")}</option>
            {STAFF_ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{t(r)}</option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="role" value="STAFF" />
      )}

      <label className="block text-sm text-fg-secondary">
        {t("Department")} <span className="text-red-500">*</span>
        <select name="department" defaultValue={staff?.department ?? ""} required className={inputCls}>
          <option value="" disabled>{t("Select a department")}</option>
          {DEPARTMENT_OPTIONS.map((d) => (
            <option key={d} value={d}>{t(d)}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-fg-secondary">
        {t("Status")}
        <select name="status" defaultValue={staff?.status ?? "ACTIVE"} className={inputCls}>
          {STAFF_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{t(s)}</option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? t("Saving...") : staff ? t("Save changes") : t("Create staff")}
      </button>
    </form>
  );
}
