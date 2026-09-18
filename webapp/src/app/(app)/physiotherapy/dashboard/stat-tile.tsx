import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatHours } from "./charts";

type Props = {
  label: string;
  hours: number;
  share?: number | null; // 0-100, % of the grand total this tile represents
  deltaPct: number | null; // vs previous period, null = no comparable prior data
  icon: LucideIcon;
  tint: string; // e.g. "bg-indigo-50 text-indigo-600"
  t: (text: string) => string;
};

export function StatTile({ label, hours, share, deltaPct, icon: Icon, tint, t }: Props) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tint}`}>
          <Icon className="h-4.5 w-4.5" strokeWidth={2} />
        </span>
        {deltaPct !== null && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
              deltaPct > 0.5
                ? "bg-emerald-50 text-emerald-700"
                : deltaPct < -0.5
                  ? "bg-gray-100 text-gray-600"
                  : "bg-gray-100 text-gray-500"
            }`}
          >
            {deltaPct > 0.5 ? <ArrowUp className="h-3 w-3" /> : deltaPct < -0.5 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {Math.abs(deltaPct).toFixed(0)}%
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900">{formatHours(hours)}</p>
      <p className="mt-0.5 text-xs text-gray-500">
        {label}
        {share !== null && share !== undefined && (
          <span className="text-gray-400">
            {" "}
            · {share.toFixed(0)}% {t("of total")}
          </span>
        )}
      </p>
    </div>
  );
}
