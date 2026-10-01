"use client";

import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import type { PeriodKey } from "./data";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "custom", label: "Custom" },
];

/**
 * Dashboard filter bar: branch + date range, driven entirely through the URL
 * so every metric on the page re-aggregates server-side. `branches` is already
 * limited server-side to the account's permitted branches (DEMO excluded).
 */
export function AnalyticsFilters({
  period,
  from,
  to,
  branch,
  branches,
}: {
  period: PeriodKey;
  from: string;
  to: string;
  branch: number;
  branches: { id: number; label: string }[];
}) {
  const push = useNavPush();
  const t = useTranslation();

  function navigate(next: Partial<{ period: PeriodKey; from: string; to: string }>) {
    const merged = { period, from, to, ...next };
    const params = new URLSearchParams({ tab: "dashboard", branch: String(branch) });
    params.set("period", merged.period);
    if (merged.period === "custom") {
      if (merged.from) params.set("from", merged.from);
      if (merged.to) params.set("to", merged.to);
    }
    push(`/callbell?${params.toString()}`);
  }

  const isCustom = period === "custom";

  return (
    <div className="mb-4 space-y-3 rounded-md border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <TabRow>
          {PERIODS.map((p) => (
            <TabButton key={p.key} size="sm" active={period === p.key} onClick={() => navigate({ period: p.key })}>
              {t(p.label)}
            </TabButton>
          ))}
        </TabRow>

        <div className="flex min-w-[200px] flex-1 items-center gap-2">
          <label htmlFor="cb-analytics-branch" className="text-sm font-medium text-fg-secondary">
            {t("Branch")}
          </label>
          <select
            id="cb-analytics-branch"
            value={branch}
            onChange={(e) => {
              const params = new URLSearchParams({ tab: "dashboard", branch: e.target.value, period });
              if (period === "custom") {
                if (from) params.set("from", from);
                if (to) params.set("to", to);
              }
              push(`/callbell?${params.toString()}`);
            }}
            className="w-full max-w-xs rounded-md border border-line-strong bg-input px-3 py-1.5 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isCustom && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:max-w-xl">
          <div>
            <label htmlFor="cb-analytics-from" className="mb-1 block text-xs font-medium text-fg-secondary">
              {t("From date")}
            </label>
            <input
              id="cb-analytics-from"
              type="date"
              value={from}
              onChange={(e) => navigate({ from: e.target.value })}
              className="w-full rounded-md border border-line-strong bg-input px-2.5 py-1.5 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="cb-analytics-to" className="mb-1 block text-xs font-medium text-fg-secondary">
              {t("To date")}
            </label>
            <input
              id="cb-analytics-to"
              type="date"
              value={to}
              onChange={(e) => navigate({ to: e.target.value })}
              className="w-full rounded-md border border-line-strong bg-input px-2.5 py-1.5 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
      )}
    </div>
  );
}