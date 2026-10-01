"use client";

import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import type { BranchOption } from "./callbell-tabs";

/**
 * Branch selector for the Call Bell page. Rendered only for all-branch
 * (HQ/admin) accounts; `branches` is already limited server-side to what the
 * account may see, so this can only narrow. Drives every tab via ?branch=.
 */
export function CallbellBranchPicker({
  branches,
  currentBranch,
  tab,
}: {
  branches: BranchOption[];
  currentBranch: number;
  /** Kept in the URL so switching branch while on the analytics tab stays there. */
  tab?: string;
}) {
  const push = useNavPush();
  const t = useTranslation();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label htmlFor="callbell-branch" className="text-sm font-medium text-fg-secondary">
        {t("Branch")}
      </label>
      <select
        id="callbell-branch"
        value={currentBranch}
        onChange={(e) => {
          const params = new URLSearchParams({ branch: e.target.value });
          if (tab) params.set("tab", tab);
          push(`/callbell?${params.toString()}`);
        }}
        className="w-full max-w-xs rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  );
}
