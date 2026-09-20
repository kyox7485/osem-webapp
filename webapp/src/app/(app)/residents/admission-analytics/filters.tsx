"use client";

import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import type { PeriodKey } from "./data";

type Props = {
  period: PeriodKey;
  from: string;
  to: string;
  branch: string;
  branches: { id: number; label: string }[];
};

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "year", label: "This year" },
  { key: "last-year", label: "Last year" },
  { key: "custom", label: "Custom" },
];

export function AnalyticsFilters({ period, from, to, branch, branches }: Props) {
  const push = useNavPush();
  const t = useTranslation();

  function navigate(next: Partial<Props>) {
    const merged = { period, from, to, branch, ...next };
    const params = new URLSearchParams();
    params.set("period", merged.period as string);
    if (merged.period === "custom") {
      if (merged.from) params.set("from", merged.from as string);
      if (merged.to) params.set("to", merged.to as string);
    }
    if (merged.branch) params.set("branch", merged.branch as string);
    push(`/residents/admission-analytics?${params.toString()}`);
  }

  const isCustom = period === "custom";

  return (
    <div className="mb-4 space-y-3 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <TabRow>
          {PERIODS.map((p) => (
            <TabButton key={p.key} size="sm" active={period === p.key} onClick={() => navigate({ period: p.key })}>
              {t(p.label)}
            </TabButton>
          ))}
        </TabRow>
      </div>

      <div className={`grid gap-3 ${isCustom ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"}`}>
        {isCustom && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">{t("From date")}</label>
              <input
                type="date"
                value={from}
                onChange={(e) => navigate({ from: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">{t("To date")}</label>
              <input
                type="date"
                value={to}
                onChange={(e) => navigate({ to: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">{t("Branch")}</label>
          <select
            value={branch}
            onChange={(e) => navigate({ branch: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">{t("All branches")}</option>
            {branches.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
