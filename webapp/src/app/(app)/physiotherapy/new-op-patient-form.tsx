"use client";

import { useEffect, useRef, useState } from "react";
import { useNavPush } from "@/components/nav-loading";
import { createOpPatient } from "./actions";
import { useTranslation } from "@/components/language-provider";

const fieldCls =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

// Quick-register modal for a walk-in outpatient, opened from the
// Outpatient tab next to the patient picker -- a physiotherapist
// shouldn't have to leave Physiotherapy (or go through the Residents
// module, which OP patients aren't part of) just to add a name.
export function NewOpPatientForm() {
  const push = useNavPush();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [icNumber, setIcNumber] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<"" | "M" | "F">("");
  const [contact, setContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPatientName("");
    setIcNumber("");
    setAge("");
    setGender("");
    setContact("");
    setError("");
  }

  function close() {
    reset();
    setOpen(false);
  }

  // Focus the first field as soon as the modal opens, and let Escape close
  // it -- same expectations as any other dialog in the app.
  useEffect(() => {
    if (!open) return;
    nameInputRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!patientName.trim()) {
      setError(t("Patient name is required"));
      return;
    }

    setSaving(true);
    const result = await createOpPatient({
      patientName,
      icNumber: icNumber.trim() || null,
      age: age ? parseInt(age, 10) : null,
      gender: gender || null,
      contact: contact.trim() || null,
    });
    setSaving(false);

    if (!result.success || !result.id) {
      setError(result.error || t("Failed to register patient"));
      return;
    }

    close();
    push(`/physiotherapy?type=op&resident=${result.id}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        + {t("New patient")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="new-op-patient-title" className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 id="new-op-patient-title" className="mb-4 text-sm font-bold text-gray-900">
              {t("Register new outpatient")}
            </h3>

            <form onSubmit={handleSubmit}>
              {error && <div className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-800">{error}</div>}

              {/* Every field the same width, one per row -- easier to scan
                  and consistent regardless of how long a label is. */}
              <div className="space-y-3">
                <label className="block text-sm text-gray-700">
                  {t("Patient name")}
                  <input
                    ref={nameInputRef}
                    type="text"
                    required
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className={fieldCls}
                  />
                </label>

                <label className="block text-sm text-gray-700">
                  {t("IC No. / Passport No.")}
                  <input type="text" value={icNumber} onChange={(e) => setIcNumber(e.target.value)} className={fieldCls} />
                </label>

                <label className="block text-sm text-gray-700">
                  {t("Age")}
                  <input
                    type="number"
                    min={0}
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    className={fieldCls}
                  />
                </label>

                <label className="block text-sm text-gray-700">
                  {t("Gender")}
                  <select value={gender} onChange={(e) => setGender(e.target.value as "" | "M" | "F")} className={fieldCls}>
                    <option value="">--</option>
                    <option value="M">M</option>
                    <option value="F">F</option>
                  </select>
                </label>

                <label className="block text-sm text-gray-700">
                  {t("Contact")}
                  <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} className={fieldCls} />
                </label>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={saving}
                  className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? t("Registering...") : t("Register patient")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
