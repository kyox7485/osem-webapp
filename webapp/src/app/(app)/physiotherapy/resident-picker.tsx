"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavPush } from "@/components/nav-loading";
import { usePhysioDirty } from "./physio-dirty-context";
import type { PhysioCareSetting } from "@/lib/physio-scoring";
import { useTranslation } from "@/components/language-provider";
import { Combobox } from "@/components/combobox";
import type { LookupOption } from "@/lib/types";

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  residents: Resident[];
  currentResident: string;
  careSetting: PhysioCareSetting;
  // "Resident" for IP, "Patient" for OP -- everything else about this
  // picker (dirty-check on switch, URL param, etc.) is identical between
  // the two care settings, only the source list and this label differ.
  label?: string;
};

// Switching resident while the New Entry form has unsaved changes would
// silently discard them (the form remounts fresh for the new resident), so
// this intercepts the change and asks the therapist first via the shared
// dirty-tracking context. When the form isn't dirty, switching is instant.
export function ResidentPicker({ residents, currentResident, careSetting, label }: Props) {
  const push = useNavPush();
  const t = useTranslation();
  const resolvedLabel = label ?? t("Resident");
  const { isDirty, requestSave } = usePhysioDirty();

  const [displayValue, setDisplayValue] = useState(currentResident);
  const [pendingResident, setPendingResident] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The list arrives already sorted by name from the page query, so the
  // combobox dropdown reads alphabetically without a client-side sort.
  const residentOptions = useMemo<LookupOption[]>(
    () => residents.map((r) => ({ id: r.id, label: r.resident_name })),
    [residents]
  );

  // Keep the visible selection in sync once the URL actually changes (a
  // completed switch, or a cancelled one snapping back).
  useEffect(() => {
    setDisplayValue(currentResident);
  }, [currentResident]);

  function navigateTo(residentId: string) {
    const params = new URLSearchParams();
    params.set("type", careSetting === "OP" ? "op" : "ip");
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
      setError(t("Couldn't save the current assessment. Fix the error above, or discard your changes to switch anyway."));
      return;
    }
    const target = pendingResident!;
    setPendingResident(null);
    navigateTo(target);
  }

  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <Combobox
        id="resident-picker"
        value={displayValue}
        onChange={handleChange}
        options={residentOptions}
        label={resolvedLabel}
        placeholder={t("Type to search...")}
        emptyMessage={`${t("No matching")} ${resolvedLabel.toLowerCase()}`}
      />

      {pendingResident !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-elevated p-6 shadow-xl">
            <h3 className="mb-2 text-sm font-bold text-fg">{t("Unsaved changes")}</h3>
            <p className="mb-4 text-sm text-fg-muted">
              {t("This assessment has unsaved changes. Save it before switching")} {resolvedLabel.toLowerCase()}?
            </p>
            {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={cancelSwitch}
                disabled={saving}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg-secondary hover:bg-hover disabled:opacity-50"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={discardAndSwitch}
                disabled={saving}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
              >
                {t("Discard changes")}
              </button>
              <button
                type="button"
                onClick={saveAndSwitch}
                disabled={saving}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? t("Saving...") : t("Save & switch")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
