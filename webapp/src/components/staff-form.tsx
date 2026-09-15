"use client";

import { useState } from "react";
import type { Staff, LookupOption } from "@/lib/types";
import { STAFF_ROLE_OPTIONS, STAFF_STATUS_OPTIONS } from "@/lib/types";

type Props = {
  staff?: Staff;
  positions: LookupOption[];
  branches: LookupOption[];
  action: (formData: FormData) => Promise<{ error?: string } | void>;
};

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export function StaffForm({ staff, positions, branches, action }: Props) {
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
    <form action={handleSubmit} className="max-w-lg space-y-4 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <label className="block text-sm text-gray-700">
        Name <span className="text-red-500">*</span>
        <input name="staff_name" defaultValue={staff?.staff_name} required className={inputCls} />
      </label>

      <label className="block text-sm text-gray-700">
        Position <span className="text-red-500">*</span>
        <select name="position_id" defaultValue={staff?.position_id ?? ""} required className={inputCls}>
          <option value="" disabled>Select a position</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-gray-700">
        Branch <span className="text-red-500">*</span>
        <select name="branch_id" defaultValue={staff?.branch_id ?? ""} required className={inputCls}>
          <option value="" disabled>Select a branch</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-gray-700">
        Role <span className="text-red-500">*</span>
        <select name="role" defaultValue={staff?.role ?? ""} required className={inputCls}>
          <option value="" disabled>Select a role</option>
          {STAFF_ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-gray-700">
        Status
        <select name="status" defaultValue={staff?.status ?? "ACTIVE"} className={inputCls}>
          {STAFF_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? "Saving..." : staff ? "Save changes" : "Create staff"}
      </button>
    </form>
  );
}
