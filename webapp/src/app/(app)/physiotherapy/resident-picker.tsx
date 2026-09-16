"use client";

import { useEffect, useState } from "react";
import { useNavPush } from "@/components/nav-loading";
import { usePhysioDirty } from "./physio-dirty-context";

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  residents: Resident[];
  currentResident: string;
};

// Switching resident while the New Entry form has unsaved changes would
// silently discard them (the form remounts fresh for the new resident), so
// this intercepts the change and asks the therapist first via the shared
// dirty-tracking context. When the form isn't dirty, switching is instant.
export function ResidentPicker({ residents, currentResident }: Props) {
  const push = useNavPush();
  const { isDirty, requestSave } = usePhysioDirty();

  const [displayValue, setDisplayValue] = useState(currentResident);
  const [pendingResident, setPendingResident] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Keep the visible selection in sync once the URL actually changes (a
  // completed switch, or a cancelled one snapping back).
  useEffect(() => {
    setDisplayValue(currentResident);
  }, [currentResident]);

  function navigateTo(residentId: string) {
    const params = new URLSearchParams();
    params.set("type", "ip");
    if (residentId) params.set("resident", residentId);
    push(`/physiotherapy?${params.toString()}`);
  }

  function handleChange(value: string) {
    setDisplayValue(value);
    if (!isDirty) {
      navigateTo(value);
      return;
    }
    setError("");
    setPendingResident(value);
  }

  function cancelSwitch() {
    setPendingResident(null);
    setError("");
    setDisplayValue(currentResident);
  }

  function discardAndSwitch() {
    const target = pendingResident!;
    setPendingResident(null);
    navigateTo(target);
  }

  async function saveAndSwitch() {
    if (!requestSave) {
      discardAndSwitch();
      return;
    }
    setSaving(true);
    setError("");
    const ok = await requestSave();
    setSaving(false);
    if (!ok) {
      setError("Couldn't save the current assessment. Fix the error above, or discard your changes to switch anyway.");
      return;
    }
    const target = pendingResident!;
    setPendingResident(null);
    navigateTo(target);
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <label htmlFor="resident-picker" className="mb-1 block text-sm font-medium text-gray-700">
        Resident
      </label>
      <select
        id="resident-picker"
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">Select resident</option>
        {residents.map((r) => (
          <option key={r.id} value={r.id}>
            {r.resident_name}
          </option>
        ))}
      </select>

      {pendingResident !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Unsaved changes</h3>
            <p className="mb-4 text-sm text-gray-600">
              This assessment has unsaved changes. Save it before switching resident?
            </p>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={cancelSwitch}
                disabled={saving}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={discardAndSwitch}
                disabled={saving}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Discard changes
              </button>
              <button
                type="button"
                onClick={saveAndSwitch}
                disabled={saving}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save & switch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
