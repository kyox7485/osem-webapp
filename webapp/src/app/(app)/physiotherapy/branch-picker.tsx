"use client";

import { useState } from "react";
import { useNavPush } from "@/components/nav-loading";
import { usePhysioDirty } from "./physio-dirty-context";
import { useTranslation } from "@/components/language-provider";
import type { LookupOption } from "@/lib/types";

type Props = {
  branches: LookupOption[];
  currentBranch: string;
};

/**
 * Branch filter for the physiotherapy patient list.
 *
 * Shown only when the account can cover more than one branch (an HQ/PHY
 * account). Unlike the clinical tabs this is NOT gated on isHqAdmin(): a
 * physiotherapist at a PHY hub legitimately covers every NUR branch and
 * needs the same narrowing aid -- `branches` is already restricted server-
 * side to what this account may see (getPhysioIpBranchIds / own branch), so
 * the dropdown can only ever narrow.
 *
 * Uses the same dirty-form guard as ResidentPicker: switching branch
 * remounts the assessment form exactly as switching patient does, so an
 * in-progress assessment must be confirmed rather than silently discarded.
 */
export function BranchPicker({ branches, currentBranch }: Props) {
  const push = useNavPush();
  const t = useTranslation();
  const { isDirty, requestSave } = usePhysioDirty();

  // No effect syncing this back from `currentBranch`: the page keys this
  // component on the branch, so a completed switch remounts it with the new
  // value already in place, and a cancelled one snaps back via
  // cancelSwitch(). ResidentPicker does need the effect because it is not
  // keyed; this one deliberately avoids that.
  const [displayValue, setDisplayValue] = useState(currentBranch);
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function navigateTo(branchId: string) {
    const params = new URLSearchParams();
    params.set("type", "ip");
    if (branchId) params.set("branch", branchId);
    push(`/physiotherapy?${params.toString()}`);
  }

  function handleChange(value: string) {
    setDisplayValue(value);
    if (!isDirty) {
      navigateTo(value);
      return;
    }
    setError("");
    setPendingBranch(value);
  }

  function cancelSwitch() {
    setPendingBranch(null);
    setError("");
    setDisplayValue(currentBranch);
  }

  function discardAndSwitch() {
    const target = pendingBranch!;
    setPendingBranch(null);
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
    const target = pendingBranch!;
    setPendingBranch(null);
    navigateTo(target);
  }

  // One branch (or none) means there is nothing to narrow to.
  if (branches.length <= 1) return null;

  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <label htmlFor="branch-picker" className="mb-1 block text-sm font-medium text-fg-secondary">
        {t("Branch")}
      </label>
      <select
        id="branch-picker"
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full max-w-md rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">{t("All branches")}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>

      {pendingBranch !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-elevated p-6 shadow-xl">
            <h3 className="mb-2 text-sm font-bold text-fg">{t("Unsaved changes")}</h3>
            <p className="mb-4 text-sm text-fg-muted">
              {t("This assessment has unsaved changes. Save it before switching")} {t("Branch").toLowerCase()}?
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
