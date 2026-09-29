"use client";

import { useTranslation } from "@/components/language-provider";
import { formatQty, type InvCountLineView } from "@/lib/inventory/core";
import { SMALL_INPUT_CLS } from "../../components/form-bits";

const VARIANCE_CLS = {
  neg: "font-semibold text-red-700 dark:text-red-300",
  pos: "font-semibold text-emerald-700 dark:text-emerald-300",
  zero: "text-fg-subtle",
};

export function FoundBadge() {
  const t = useTranslation();
  return (
    <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
      {t("Found")}
    </span>
  );
}

/**
 * Read-only sheet. With `showVariance` (reviewers, and closed counts) it adds
 * expected / posted since start / variance; otherwise only what was counted,
 * so a counter never sees the book quantity. `notes` + `onNote` make the
 * per-line note editable (review screen), variance lines only.
 */
export function CountLinesTable({
  lines,
  showVariance,
  notes,
  onNote,
  onlyVariance,
}: {
  lines: InvCountLineView[];
  showVariance: boolean;
  notes?: Record<number, string>;
  onNote?: (lineId: number, value: string) => void;
  onlyVariance?: boolean;
}) {
  const t = useTranslation();
  const shown = onlyVariance ? lines.filter((l) => (l.variance ?? 0) !== 0) : lines;
  const hasResidents = lines.some((l) => l.residentName !== null);
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-surface-strong text-left text-xs text-fg-subtle">
          <tr>
            <th className="px-3 py-2 font-medium">{t("Product")}</th>
            <th className="px-3 py-2 font-medium">{t("SKU")}</th>
            {hasResidents && <th className="px-3 py-2 font-medium">{t("Resident")}</th>}
            {showVariance && <th className="px-3 py-2 text-right font-medium">{t("Expected")}</th>}
            {showVariance && <th className="px-3 py-2 text-right font-medium">{t("Posted since start")}</th>}
            <th className="px-3 py-2 text-right font-medium">{t("Counted")}</th>
            {showVariance && <th className="px-3 py-2 text-right font-medium">{t("Variance")}</th>}
            {showVariance && <th className="px-3 py-2 font-medium">{t("Note")}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {shown.map((l) => {
            const v = l.variance ?? 0;
            const editable = onNote !== undefined && v !== 0;
            return (
              <tr key={l.id}>
                <td className="px-3 py-2 text-fg">
                  {l.name}
                  {l.isFound && <FoundBadge />}
                </td>
                <td className="px-3 py-2 text-fg-subtle">{l.sku}</td>
                {hasResidents && <td className="px-3 py-2 text-fg-secondary">{l.residentName ?? ""}</td>}
                {showVariance && (
                  <td className="px-3 py-2 text-right text-fg-secondary">
                    {formatQty(l.expected)} {l.uomCode}
                  </td>
                )}
                {showVariance && <td className="px-3 py-2 text-right text-fg-subtle">{formatQty(l.postedSince)}</td>}
                <td className="px-3 py-2 text-right text-fg">
                  {formatQty(l.physical)} {l.uomCode}
                </td>
                {showVariance && (
                  <td className={`px-3 py-2 text-right ${v < 0 ? VARIANCE_CLS.neg : v > 0 ? VARIANCE_CLS.pos : VARIANCE_CLS.zero}`}>
                    {v > 0 ? "+" : ""}
                    {formatQty(v)}
                  </td>
                )}
                {showVariance && (
                  <td className="min-w-48 px-3 py-2">
                    {editable ? (
                      <input
                        className={SMALL_INPUT_CLS}
                        maxLength={500}
                        aria-label={`${t("Note")} ${l.name}`}
                        value={notes?.[l.id] ?? ""}
                        onChange={(e) => onNote?.(l.id, e.target.value)}
                      />
                    ) : (
                      <span className="text-fg-secondary">{l.note ?? ""}</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
