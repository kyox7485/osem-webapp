// Status pill for stock counts. The label arrives already translated; the
// colours carry their dark: partner (docs/theming.md).
const TONE: Record<string, string> = {
  IN_PROGRESS: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  SUBMITTED: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  CLOSED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  CANCELLED: "bg-surface-strong text-fg-subtle",
};

export function CountStatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[status] ?? TONE.CANCELLED}`}>{label}</span>;
}
