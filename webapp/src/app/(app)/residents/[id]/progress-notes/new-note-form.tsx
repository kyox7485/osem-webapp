"use client";

import { useState } from "react";
import { createProgressNote } from "./actions";
import type { LookupOption } from "@/lib/types";

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

export function NewNoteForm({
  residentId,
  staffOptions,
  onSaved,
}: {
  residentId: number;
  staffOptions: LookupOption[];
  // Called after a successful save -- the New entry tab uses this to
  // switch back to Review so the doctor sees the note they just added.
  onSaved?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formAction = createProgressNote.bind(null, residentId);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    const result = await formAction(formData);
    if (result?.error) {
      setError(result.error);
    } else {
      (document.getElementById("new-note-form") as HTMLFormElement)?.reset();
      onSaved?.();
    }
    setSubmitting(false);
  }

  return (
    <form id="new-note-form" action={handleSubmit} className="space-y-3 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <label className="block text-sm text-gray-700">
        Progress note <span className="text-red-500">*</span>
        <textarea name="progress_note" required rows={3} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700">
        Physical examination
        <textarea name="physical_examination" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700">
        Medical plan
        <textarea name="medical_plan" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700">
        Nursing plan
        <textarea name="nursing_plan" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700">
        Feeding plan
        <textarea name="feeding_plan" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700">
        Monitoring plan
        <textarea name="monitoring_plan" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700">
        Entered by <span className="text-red-500">*</span>
        <select name="staff_id" required defaultValue="" className={inputCls}>
          <option value="" disabled>Select who&apos;s entering this</option>
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
