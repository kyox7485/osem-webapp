"use client";

import { useTranslation } from "@/components/language-provider";

/**
 * The shared query-result banner for the Clinical tabs.
 *
 * `error` is a Postgres/Supabase error string shown verbatim in red.
 * `truncated` is set by the page when a query hit its row cap, so a bounded
 * list is never mistaken for the complete one.
 *
 * Every clinical module renders its error the same way, so the two states
 * live here rather than being repeated per tab.
 */
export function ResultNotice({ error, truncated }: { error?: string | null; truncated?: boolean }) {
  const t = useTranslation();
  if (!error && !truncated) return null;

  return (
    <>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {truncated && (
        <p className="text-sm text-fg-secondary">
          {t("Showing the most recent entries only. Narrow the date range or pick a resident to see older ones.")}
        </p>
      )}
    </>
  );
}
