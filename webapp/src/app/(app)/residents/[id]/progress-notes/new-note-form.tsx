"use client";

import { useState } from "react";
import { createProgressNote } from "./actions";

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none";

export function NewNoteForm({ residentId }: { residentId: number }) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const formAction = createProgressNote.bind(null, residentId);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    const result = await formAction(formData);
    if (result?.error) {
      setError(result.error);
    } else {
      setOpen(false);
      (document.getElementById("new-note-form") as HTMLFormElement)?.reset();
    }
    setSubmitting(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        New progress note
      </button>
    );
  }

  return (
    <form id="new-note-form" action={handleSubmit} className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
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
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-gray-700">
          Feeding plan
          <input name="feeding_plan" className={inputCls} />
        </label>
        <label className="block text-sm text-gray-700">
          Monitoring plan
          <input name="monitoring_plan" className={inputCls} />
        </label>
      </div>
      <label className="block text-sm text-gray-700">
        Current medication regime
        <textarea name="current_medication_regime" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700">
        TCA notes
        <input name="tca_notes" placeholder="e.g. MOPD 1/12/2026, SOPD 21/11/2026" className={inputCls} />
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
