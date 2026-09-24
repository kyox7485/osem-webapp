import type { PatientTypeKey, WorkloadRow } from "./data";
import { totalHours } from "./data";
import { StackedBar, formatHours } from "./charts";
import { WorkloadBar } from "./charts";

type Props = {
  therapists: WorkloadRow[];
  weeks: number;
  emptyLabel: string;
  columnLabels: { therapist: string; branches: string; mix: string; workload: string; total: string };
  t: (text: string) => string;
  labels: Record<PatientTypeKey, string>;
};

// "Therapist strength" panel: for each therapist, their patient-type mix
// (what kind of work they mostly do) side by side with their workload
// against the 45hr/week baseline (how much of it, and whether that's
// currently overtime or under baseline).
export function TherapistTable({ therapists, weeks, emptyLabel, columnLabels, t, labels }: Props) {
  if (therapists.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <th className="py-2 pr-3">{columnLabels.therapist}</th>
            <th className="py-2 pr-3">{columnLabels.mix}</th>
            <th className="w-48 py-2 pr-3">{columnLabels.workload}</th>
            <th className="py-2 pl-3 text-right">{columnLabels.total}</th>
          </tr>
        </thead>
        <tbody>
          {therapists.map((th, index) => {
            const total = totalHours(th.totals);
            const avgWeekly = total / weeks;
            return (
              <tr key={th.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                <td className="py-3 pr-3 align-top">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{th.name}</p>
                  {th.branches.length > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">{th.branches.join(", ")}</p>}
                </td>
                <td className="w-56 py-3 pr-3 align-top">
                  {/* The first row has nothing above it to pop the tooltip
                      into inside this scrollable table, so it flips below
                      the bar instead -- every other row still opens above. */}
                  <StackedBar label="" totals={th.totals} labels={labels} tooltipPosition={index === 0 ? "bottom" : "top"} />
                </td>
                <td className="py-3 pr-3 align-top">
                  <WorkloadBar avgWeeklyHours={avgWeekly} baseline={th.baselineHours} t={t} />
                </td>
                <td className="py-3 pl-3 text-right align-top font-semibold text-gray-900 dark:text-gray-100">{formatHours(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
