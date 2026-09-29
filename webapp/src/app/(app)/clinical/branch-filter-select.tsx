"use client";

import { useTranslation } from "@/components/language-provider";
import { useIsHqAdmin } from "@/components/admin-record-controls";
import type { LookupOption } from "@/lib/types";

type Props = {
  branches: LookupOption[];
  currentBranch: string;
  onChange: (branchId: string) => void;
  /** Unique per tab -- several filter bars render on the same page. */
  id?: string;
};

/**
 * Branch filter for the clinical tab filter bars, HQ ADMIN only.
 *
 * Renders nothing at all for any other login -- not a hidden-but-present
 * select, not a disabled one -- so each module's grid can size itself on
 * `useIsHqAdmin()` and a non-admin sees exactly the layout they had before.
 *
 * `onChange` receives "" for "All branches". Callers are expected to clear
 * their resident selection when the branch changes: the server repopulates
 * the resident list for the new branch, so a resident from the previous one
 * must not stay selected in it.
 */
export function BranchFilterSelect({ branches, currentBranch, onChange, id = "branch-filter" }: Props) {
  const t = useTranslation();
  const isHqAdmin = useIsHqAdmin();

  if (!isHqAdmin) return null;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-fg-secondary">
        {t("Branch")}
      </label>
      <select
        id={id}
        value={currentBranch}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">{t("All branches")}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
    </div>
  );
}
