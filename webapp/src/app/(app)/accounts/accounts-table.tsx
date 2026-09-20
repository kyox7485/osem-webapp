"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/components/language-provider";
import { formatBranch } from "@/lib/lookups";

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
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">{t("Username")}</th>
              <th className="px-4 py-2 font-medium">{t("Email")}</th>
              <th className="px-4 py-2 font-medium">{t("Branch")}</th>
              <th className="px-4 py-2 font-medium">{t("Rights")}</th>
              <th className="px-4 py-2 font-medium">{t("Status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {accounts.map((a) => {
              const branch = Array.isArray(a.tbl_branches) ? a.tbl_branches[0] : a.tbl_branches;
              return (
                <tr
                  key={a.id}
                  onClick={() => handleRowClick(a)}
                  className="cursor-pointer hover:bg-indigo-50 transition-colors"
                >
                  <td className="px-4 py-2 font-medium text-gray-900">{a.username}</td>
                  <td className="px-4 py-2 text-gray-600">{a.email}</td>
                  <td className="px-4 py-2 text-gray-600">{formatBranch(branch ?? null)}</td>
                  <td className="px-4 py-2 text-gray-600">{t(a.rights)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
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
            className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900">
              {t("Edit account")}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {t("Edit account information for")}{" "}
              <span className="font-medium text-gray-900">{selected.username}</span>?
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={handleClose}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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
