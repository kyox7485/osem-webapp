import { formatCell, type ReportResult } from "@/lib/inventory/reports/types";

// Read-only table for any ReportResult (already translated by the loader).
// Server component; negative quantities and amounts are red with a dark: partner.

const NUMERIC = new Set(["int", "qty", "money", "money4"]);

export function ReportTable({ report, truncatedText, emptyText }: { report: ReportResult; truncatedText: string; emptyText: string }) {
  if (report.rows.length === 0) {
    return <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-sm text-fg-subtle">{emptyText}</p>;
  }
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs text-fg-subtle">
            <tr>
              {report.columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-medium ${NUMERIC.has(c.kind) ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {report.rows.map((row, i) => (
              <tr key={i} className="hover:bg-hover">
                {report.columns.map((c) => {
                  const value = row[c.key] ?? null;
                  const numeric = NUMERIC.has(c.kind);
                  const negative = numeric && typeof value === "number" && value < 0;
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 ${numeric ? "text-right tabular-nums" : ""} ${negative ? "text-red-600 dark:text-red-400" : "text-fg-secondary"}`}
                    >
                      {formatCell(c.kind, value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {report.totals && (
            <tfoot>
              <tr className="border-t border-line bg-surface-muted font-semibold">
                {report.columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 text-fg ${NUMERIC.has(c.kind) ? "text-right tabular-nums" : ""}`}>
                    {formatCell(c.kind, report.totals?.[c.key] ?? null)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {report.truncated && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
          {truncatedText}
        </p>
      )}
      {report.notes.map((n, i) => (
        <p key={i} className="text-xs text-fg-subtle">
          {n}
        </p>
      ))}
    </div>
  );
}
