"use client";

import { useState } from "react";
import type { UserAccount, LookupOption } from "@/lib/types";
import { STAFF_ROLE_OPTIONS, STAFF_STATUS_OPTIONS } from "@/lib/types";

type Props = {
  account?: UserAccount;
  branches: LookupOption[];
  action: (formData: FormData) => Promise<{ error?: string } | void>;
};

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none";

export function AccountForm({ account, branches, action }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    const result = await action(formData);
    if (result?.error) {
      setError(result.error);
      setSubmitting(false);
    }
  }

  return (
    <form action={handleSubmit} className="max-w-lg space-y-4 rounded-md border border-gray-200 bg-white p-4">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {!account && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
          Creating this sends an email invite so the person sets their own password.
        </p>
      )}

      <label className="block text-sm text-gray-700">
        Email <span className="text-red-500">*</span>
        <input name="email" type="email" defaultValue={account?.email} required className={inputCls} />
      </label>

      <label className="block text-sm text-gray-700">
        Username <span className="text-red-500">*</span>
        <input name="username" defaultValue={account?.username} required className={inputCls} />
      </label>

      <label className="block text-sm text-gray-700">
        Branch <span className="text-red-500">*</span>
        <select name="branch_id" defaultValue={account?.branch_id ?? ""} required className={inputCls}>
          <option value="" disabled>Select a branch</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-gray-700">
        Rights <span className="text-red-500">*</span>
        <select name="rights" defaultValue={account?.rights ?? ""} required className={inputCls}>
          <option value="" disabled>Select rights</option>
          {STAFF_ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>

      {account && (
        <label className="block text-sm text-gray-700">
          Status
          <select name="status" defaultValue={account.status} className={inputCls}>
            {STAFF_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {submitting ? "Saving..." : account ? "Save changes" : "Create account & send invite"}
      </button>
    </form>
  );
}
