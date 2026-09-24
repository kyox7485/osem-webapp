"use client";

import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import type { PeriodKey } from "./data";

type Props = {
  period: PeriodKey;
  start: string;
  end: string;
  branch: string; // "" = all
  view: "team" | "individual";
  therapist: string; // "" = all
  branches: { id: number; label: string }[];
  therapists: { id: string; label: string }[];
};

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "Last 3 months" },
  { key: "custom", label: "Custom" },
];

export function DashboardFilters({ period, start, end, branch, view, therapist, branches, therapists }: Props) {
  const push = useNavPush();
  const t = useTranslation();

  function navigate(next: Partial<Props>) {
    const merged = { period, start, end, branch, view, therapist, ...next };
    const params = new URLSearchParams();
    params.set("period", merged.period as string);
    if (merged.period === "custom") {
      if (merged.start) params.set("start", merged.start as string);
      if (merged.end) params.set("end", merged.end as string);
    }
    if (merged.branch) params.set("branch", merged.branch as string);
    params.set("view", merged.view as string);
    if (merged.view === "individual" && merged.therapist) params.set("therapist", merged.therapist as string);
    push(`/physiotherapy/dashboard?${params.toString()}`);
  }

  return (
    <div className="mb-4 space-y-3 rounded-md border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabRow>
          {PERIODS.map((p) => (
            <TabButton key={p.key} size="sm" active={period === p.key} onClick={() => navigate({ period: p.key })}>
              {t(p.label)}
            </TabButton>
          ))}
        </TabRow>

        <TabRow>
          <TabButton size="sm" active={view === "team"} onClick={() => navigate({ view: "team", therapist: "" })}>
            {t("Team view")}
          </TabButton>
          <TabButton size="sm" active={view === "individual"} onClick={() => navigate({ view: "individual", therapist: "" })}>
            {t("Individual view")}
          </TabButton>
        </TabRow>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {period === "custom" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-secondary">{t("Start date")}</label>
              <input
                type="date"
                value={start}
                onChange={(e) => navigate({ start: e.target.value })}
                className="w-full rounded-md border border-line-strong bg-input text-fg px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-secondary">{t("End date")}</label>
              <input
                type="date"
                value={end}
                onChange={(e) => navigate({ end: e.target.value })}
                className="w-full rounded-md border border-line-strong bg-input text-fg px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-secondary">{t("Branch")}</label>
          <select
            value={branch}
            onChange={(e) => navigate({ branch: e.target.value })}
            className="w-full rounded-md border border-line-strong bg-input text-fg px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">{t("All branches")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        {view === "individual" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-secondary">{t("Therapist")}</label>
            <select
              value={therapist}
              onChange={(e) => navigate({ therapist: e.target.value })}
              className="w-full rounded-md border border-line-strong bg-input text-fg px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">{t("Select therapist")}</option>
              {therapists.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
