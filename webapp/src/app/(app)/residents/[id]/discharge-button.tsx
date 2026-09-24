"use client";

import { useState, useTransition } from "react";
import { dischargeResident } from "../actions";
import { useTranslation } from "@/components/language-provider";

type StaffOption = { id: number | string; label: string };

export function DischargeButton({
  residentId,
  allStaff,
}: {
  residentId: number;
  allStaff: StaffOption[];
}) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [staffValue, setStaffValue] = useState("");

  const isOthers = staffValue === "__others__";

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await dischargeResident(residentId, formData);
      if (result?.error) setError(result.error);
    });
  }

  const inputCls =
    "w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700"
      >
        {t("Discharge")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !isPending && setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 mb-4 sm:mb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t("Discharge resident")}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("Complete the details below to record the discharge.")}</p>

            <form action={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t("Status")}</label>
                <select name="status" defaultValue="DISCHARGED" className={inputCls}>
                  <option value="DISCHARGED">{t("DISCHARGED")}</option>
                  <option value="DECEASED">{t("DECEASED")}</option>
                  <option value="TRANSFERRED OUT">{t("TRANSFERRED OUT")}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t("Discharge date")} <span className="text-red-500">*</span>
                </label>
                <input
                  name="discharge_date"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().split("T")[0]}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t("Recorded by")} <span className="text-red-500">*</span>
                </label>
                <select
                  name="discharged_by"
                  value={staffValue}
                  onChange={(e) => setStaffValue(e.target.value)}
                  required={!isOthers}
                  className={inputCls}
                >
                  <option value="" disabled>{t("Select staff")}</option>
                  {allStaff.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                  <option value="__others__">{t("Others")}</option>
                </select>
                {isOthers && (
                  <input
                    name="discharged_by_other"
                    type="text"
                    required
                    placeholder={t("Enter name")}
                    className={`${inputCls} mt-2`}
                  />
                )}
              </div>

              {error && (
                <p className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                  {error}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      {t("Saving...")}
                    </span>
                  ) : t("Confirm discharge")}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="flex-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60 disabled:opacity-50 transition-colors"
                >
                  {t("Cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
