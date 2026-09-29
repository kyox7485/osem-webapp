import type { ReactNode } from "react";
import { filterLabel, type FilterKey, type ReportKey, type ReportParams } from "@/lib/inventory/reports/types";
import type { FilterOption } from "@/lib/inventory/reports/filter-options";

// Server-rendered GET form: the filters live in the URL (shareable, and the
// page re-renders on the server). No client state, so nothing to guard for
// unsaved changes. Theme tokens only; the class strings are spelled out here
// because this is a server component (form-bits is a client module).

const INPUT =
  "w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const BUTTON =
  "inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700";
const LINK_BUTTON =
  "inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-fg-secondary hover:bg-hover";

type T = (text: string) => string;

function FieldBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-fg-secondary">{label}</span>
      {children}
    </label>
  );
}

/** Filters whose option labels come from the database (names) and must not be translated. */
const DATA_LABELS = new Set<FilterKey>(["category", "supplier", "month"]);
/** Selects that always carry a value, so they get no "All" entry. */
const ALWAYS_SET = new Set<FilterKey>(["status", "view"]);

export function ReportFilters({
  report,
  filters,
  params,
  options,
  branchId,
  action,
  hidden = {},
  requiredRange,
  rangeError,
  t,
}: {
  report: ReportKey;
  filters: FilterKey[];
  params: ReportParams;
  options: Partial<Record<FilterKey, FilterOption[]>>;
  branchId: number;
  action: string;
  /** extra hidden fields, e.g. the active tab */
  hidden?: Record<string, string>;
  requiredRange: boolean;
  rangeError: string | null;
  t: T;
}) {
  return (
    <form method="get" action={action} className="space-y-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <input type="hidden" name="branch" value={branchId} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {filters.map((key) => {
          const label = t(filterLabel(report, key));
          if (key === "q") {
            return (
              <FieldBox key={key} label={label}>
                <input type="search" name="q" defaultValue={params.q} maxLength={60} className={INPUT} autoComplete="off" />
              </FieldBox>
            );
          }
          if (key === "from" || key === "to") {
            return (
              <FieldBox key={key} label={label}>
                <input type="date" name={key} defaultValue={params[key]} required={requiredRange} className={INPUT} />
              </FieldBox>
            );
          }
          if (key === "month" && !options.month) {
            return (
              <FieldBox key={key} label={label}>
                <input type="month" name="month" defaultValue={params.month} className={INPUT} />
              </FieldBox>
            );
          }
          const list = options[key] ?? [];
          const raw = params[key];
          const current = raw === null || raw === undefined ? "" : String(raw);
          return (
            <FieldBox key={key} label={label}>
              <select name={key} defaultValue={current} className={INPUT}>
                {!ALWAYS_SET.has(key) && <option value="">{key === "month" ? t("Current value only") : t("All")}</option>}
                {list.map((o) => (
                  <option key={o.value} value={o.value}>
                    {DATA_LABELS.has(key) ? o.label : t(o.label)}
                  </option>
                ))}
              </select>
            </FieldBox>
          );
        })}
      </div>
      {rangeError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {rangeError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={BUTTON}>
          {t("Apply filters")}
        </button>
        <a href={`${action}?${new URLSearchParams({ branch: String(branchId), ...hidden }).toString()}`} className={LINK_BUTTON}>
          {t("Reset")}
        </a>
      </div>
    </form>
  );
}
