"use client";

import { Fragment, useState } from "react";
import { formatCell, type ReportResult } from "@/lib/inventory/reports/types";
import { StockItemDetailModal } from "./stock-detail-modal";

// Read-only table for any ReportResult (already translated by the loader).
// Server component; negative quantities and amounts are red with a dark: partner.

const NUMERIC = new Set(["int", "qty", "money", "money4"]);

export function ReportTable({
  report,
  truncatedText,
  emptyText,
  canQuickEdit = false,
}: {
  report: ReportResult;
  truncatedText: string;
  emptyText: string;
  /** MODERATOR/ADMIN only -- opening the product editor is a setup change. */
  canQuickEdit?: boolean;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const openRow = report.rows.find((r) => (r.id as number | undefined) === openId);
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
            {report.rows.map((row, i) => {
              // Group heading above the first row of each category. A category
              // name that is not a column of the report arrives as the hidden
              // `_group` field; reports without one render as a plain table.
              // The Fragment carries the row's key so the clickable <tr> and
              // its modal keep their identity.
              const group = row._group != null ? String(row._group) : null;
              const previous = report.rows[i - 1];
              const previousGroup = previous?._group != null ? String(previous._group) : null;
              const showGroup = group !== null && group !== previousGroup;
              return (
                <Fragment key={i}>
                  {showGroup && (
                    <tr className="bg-surface-muted">
                      <td colSpan={report.columns.length} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-fg">
                        {group}
                      </td>
                    </tr>
                  )}
                  <tr className="hover:bg-hover cursor-pointer" onClick={() => { if (row.id) setOpenId(Number(row.id)); }}>
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
                </Fragment>
              );
            })}
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
      {openRow && openRow.id && (
        <StockItemDetailModal
          productId={Number(openRow.id)}
          productName={String(openRow.product ?? "")}
          sku={String(openRow.sku ?? "")}
          categoryName={openRow._categoryName != null ? String(openRow._categoryName) : null}
          supplierName={openRow._supplierName != null ? String(openRow._supplierName) : null}
          isActive={openRow._isActive != null ? openRow._isActive === 1 : null}
          costPrice={typeof openRow._costPrice === "number" ? openRow._costPrice : null}
          sellingPrice={typeof openRow._sellingPrice === "number" ? openRow._sellingPrice : null}
          storeQty={typeof openRow.store === "number" ? openRow.store : 0}
          floorQty={typeof openRow.floor === "number" ? openRow.floor : 0}
          transitQty={typeof openRow.transit === "number" ? openRow.transit : 0}
          totalQty={typeof openRow.total === "number" ? openRow.total : 0}
          unit={String(openRow.unit ?? "")}
          onClose={() => setOpenId(null)}
          onQuickEdit={canQuickEdit ? () => { window.open(`/inventory/setup/products?product=${openRow.id}`, "_blank"); setOpenId(null); } : undefined}
        />
      )}
    </div>
  );
}
