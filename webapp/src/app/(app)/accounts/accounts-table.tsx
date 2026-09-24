"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/components/language-provider";

function formatBranch(branch: { locale: string | null; code: string } | null | undefined): string {
  if (!branch) return "--";
  return branch.locale ?? branch.code;
}

type AccountRow = {
  id: number;
  username: string;
  email: string;
  rights: string;
  status: string;
  tbl_branches: { locale: string | null; code: string } | { locale: string | null; code: string }[] | null;
};

export function AccountsTable({ accounts }: { accounts: AccountRow[] }) {
  const t = useTranslation();
  const router = useRouter();
  const [selected, setSelected] = useState<AccountRow | null>(null);

  function handleRowClick(account: AccountRow) {
    setSelected(account);
  }

  function handleEdit() {
    if (selected) {
      router.push(`/accounts/${selected.id}/edit`);
    }
    setSelected(null);
  }

  function handleClose() {
    setSelected(null);
  }

  return (
    <>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-fg-subtle">
            <tr>
              <th className="px-4 py-2 font-medium">{t("Username")}</th>
              <th className="px-4 py-2 font-medium">{t("Email")}</th>
              <th className="px-4 py-2 font-medium">{t("Branch")}</th>
              <th className="px-4 py-2 font-medium">{t("Rights")}</th>
              <th className="px-4 py-2 font-medium">{t("Status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {accounts.map((a) => {
              const branch = Array.isArray(a.tbl_branches) ? a.tbl_branches[0] : a.tbl_branches;
              return (
                <tr
                  key={a.id}
                  onClick={() => handleRowClick(a)}
                  className="cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                >
                  <td className="px-4 py-2 font-medium text-fg">{a.username}</td>
                  <td className="px-4 py-2 text-fg-muted">{a.email}</td>
                  <td className="px-4 py-2 text-fg-muted">{formatBranch(branch ?? null)}</td>
                  <td className="px-4 py-2 text-fg-muted">{t(a.rights)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.status === "ACTIVE" ? "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300" : "bg-surface-strong text-fg-secondary"
                      }`}
                    >
                      {t(a.status)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit confirmation modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={handleClose}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-elevated p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-fg">
              {t("Edit account")}
            </h2>
            <p className="mt-2 text-sm text-fg-muted">
              {t("Edit account information for")}{" "}
              <span className="font-medium text-fg">{selected.username}</span>?
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={handleClose}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-secondary hover:bg-hover transition-colors"
              >
                {t("Cancel")}
              </button>
              <button
                onClick={handleEdit}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
              >
                {t("Edit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
