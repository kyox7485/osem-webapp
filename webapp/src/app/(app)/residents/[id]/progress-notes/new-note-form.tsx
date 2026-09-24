"use client";

import { useState } from "react";
import { createProgressNote } from "./actions";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import { useFormDirtyTracking } from "@/lib/use-form-dirty-tracking";

const inputCls =
  "mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

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
  const t = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [staffIdOther, setStaffIdOther] = useState("");
  const formAction = createProgressNote.bind(null, residentId);
  const { markDirty, markClean } = useFormDirtyTracking(`resident-progress-note-new-${residentId}`, async () => {
    const form = document.getElementById("new-note-form") as HTMLFormElement | null;
    if (!form) return { success: false, error: "Form not found" };
    return submitForm(new FormData(form));
  });

  async function submitForm(formData: FormData): Promise<{ success: boolean; error?: string }> {
    setSubmitting(true);
    setError(null);
    const result = await formAction(formData);
    if (result?.error) {
      setError(result.error);
      setSubmitting(false);
      return { success: false, error: result.error };
    }
    (document.getElementById("new-note-form") as HTMLFormElement)?.reset();
    setStaffId("");
    setStaffIdOther("");
    markClean();
    onSaved?.();
    setSubmitting(false);
    return { success: true };
  }

  async function handleSubmit(formData: FormData) {
    await submitForm(formData);
  }

  return (
    <form id="new-note-form" action={handleSubmit} onChangeCapture={markDirty} className="space-y-3 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
      {error && <p className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-600 dark:text-red-300">{error}</p>}

      <label className="block text-sm text-gray-700 dark:text-gray-300">
        {t("Progress note")} <span className="text-red-500">*</span>
        <textarea name="progress_note" required rows={3} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        {t("Physical examination")}
        <textarea name="physical_examination" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        {t("Medical plan")}
        <textarea name="medical_plan" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        {t("Nursing plan")}
        <textarea name="nursing_plan" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        {t("Feeding plan")}
        <textarea name="feeding_plan" rows={2} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        {t("Monitoring plan")}
        <textarea name="monitoring_plan" rows={2} className={inputCls} />
      </label>

      <div className="block text-sm text-gray-700 dark:text-gray-300">
        {t("Entered by")} <span className="text-red-500">*</span>
        <input type="hidden" name="staff_id" value={staffId} />
        <input type="hidden" name="staff_id_other" value={staffIdOther} />
        <div className="mt-1">
          <StaffPickerWithOther
            value={staffId}
            otherName={staffIdOther}
            onValueChange={(v) => { setStaffId(v); if (v !== OTHERS_SENTINEL) setStaffIdOther(""); }}
            onOtherNameChange={setStaffIdOther}
            staffOptions={staffOptions}
            required
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? t("Saving...") : t("Save")}
      </button>
    </form>
  );
}
