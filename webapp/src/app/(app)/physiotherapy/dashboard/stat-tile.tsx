import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatHours } from "./charts";

type Props = {
  label: string;
  hours: number;
  share?: number | null; // 0-100, % of the grand total this tile represents
  deltaPct: number | null; // vs previous period, null = no comparable prior data
  icon: LucideIcon;
  tint: string; // e.g. "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400"
  t: (text: string) => string;
};

export function StatTile({ label, hours, share, deltaPct, icon: Icon, tint, t }: Props) {
  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tint}`}>
          <Icon className="h-4.5 w-4.5" strokeWidth={2} />
        </span>
        {deltaPct !== null && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
              deltaPct > 0.5
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                : deltaPct < -0.5
                  ? "bg-surface-strong text-fg-muted"
                  : "bg-surface-strong text-fg-subtle"
            }`}
          >
            {deltaPct > 0.5 ? <ArrowUp className="h-3 w-3" /> : deltaPct < -0.5 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {Math.abs(deltaPct).toFixed(0)}%
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-fg">{formatHours(hours)}</p>
      <p className="mt-0.5 text-xs text-fg-subtle">
        {label}
        {share !== null && share !== undefined && (
          <span className="text-fg-faint">
            {" "}
            · {share.toFixed(0)}% {t("of total")}
          </span>
        )}
      </p>
    </div>
  );
}
