"use client";

import { useState } from "react";
import type { UserAccount, LookupOption } from "@/lib/types";
import { RIGHTS_OPTIONS, STAFF_STATUS_OPTIONS } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";

type Props = {
  account?: UserAccount;
  branches: LookupOption[];
  action: (formData: FormData) => Promise<{ error?: string } | void>;
};

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export function AccountForm({ account, branches, action }: Props) {
  const t = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await action(formData);
      if (result?.error) {
        setError(result.error);
        setSubmitting(false);
      }
      // On success the server action redirects; stay in submitting state until navigation
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form action={handleSubmit} className="max-w-lg space-y-4 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {!account && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {t("Creating this sends an email invite so the person sets their own password.")}
        </p>
      )}

      <label className="block text-sm text-gray-700">
        {t("Email")} <span className="text-red-500">*</span>
        <input name="email" type="email" defaultValue={account?.email} required className={inputCls} />
      </label>

      <label className="block text-sm text-gray-700">
        {t("Username")} <span className="text-red-500">*</span>
        <input name="username" defaultValue={account?.username} required className={inputCls} />
      </label>

      <label className="block text-sm text-gray-700">
        {t("Branch")} <span className="text-red-500">*</span>
        <select name="branch_id" defaultValue={account?.branch_id ?? ""} required className={inputCls}>
          <option value="" disabled>{t("Select a branch")}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-gray-700">
        {t("Rights")} <span className="text-red-500">*</span>
        <select name="rights" defaultValue={account?.rights ?? ""} required className={inputCls}>
          <option value="" disabled>{t("Select rights")}</option>
          {RIGHTS_OPTIONS.map((r) => (
            <option key={r} value={r}>{t(r)}</option>
          ))}
        </select>
      </label>

      {account && (
        <label className="block text-sm text-gray-700">
          {t("Status")}
          <select name="status" defaultValue={account.status} className={inputCls}>
            {STAFF_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{t(s)}</option>
            ))}
          </select>
        </label>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? t("Saving...") : account ? t("Save changes") : t("Create account & send invite")}
      </button>
    </form>
  );
}
