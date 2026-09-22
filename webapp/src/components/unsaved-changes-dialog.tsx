"use client";

import { useEffect, useRef } from "react";
import { useDirtyFormDialogState } from "@/lib/dirty-form-context";
import { useTranslation } from "./language-provider";

/**
 * Single global instance, mounted once in the root layout. Driven entirely
 * by DirtyFormContext -- any module that wants to guard a navigation calls
 * `guardAction` (via useSafeNavigation / useGuardedNavigation) and this
 * dialog appears automatically; nothing else needs to render it.
 */
export function UnsavedChangesDialog() {
  const t = useTranslation();
  const { dialogOpen, dialogSaving, dialogError, resolveDialog } = useDirtyFormDialogState();
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialogOpen) saveButtonRef.current?.focus();
  }, [dialogOpen]);

  useEffect(() => {
    if (!dialogOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !dialogSaving) resolveDialog("cancel");
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialogOpen, dialogSaving, resolveDialog]);

  if (!dialogOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
      aria-describedby="unsaved-changes-description"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 id="unsaved-changes-title" className="mb-2 text-lg font-bold text-gray-900">
          {t("Unsaved changes")}
        </h2>
        <p id="unsaved-changes-description" className="mb-6 text-sm text-gray-700">
          {t("You have unsaved changes. What would you like to do?")}
        </p>

        {dialogError && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">
            {dialogError}
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => resolveDialog("cancel")}
            disabled={dialogSaving}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {t("Cancel")}
          </button>

          <button
            type="button"
            onClick={() => resolveDialog("discard")}
            disabled={dialogSaving}
            className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {t("Exit Without Saving")}
          </button>

          <button
            ref={saveButtonRef}
            type="button"
            onClick={() => resolveDialog("save")}
            disabled={dialogSaving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {dialogSaving ? (
              <>
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                {t("Saving...")}
              </>
            ) : (
              t("Save & Exit")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
