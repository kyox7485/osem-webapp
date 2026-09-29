// Status pill for stock requests. The label arrives already translated; the
// colours carry their dark: partner (docs/theming.md).
const TONE: Record<string, string> = {
  DRAFT: "bg-surface-strong text-fg-secondary",
  SUBMITTED: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  APPROVED: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  ORDERED: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300",
  PARTIALLY_RECEIVED: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
  RECEIVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  CLOSED: "bg-surface-strong text-fg-secondary",
  CANCELLED: "bg-surface-strong text-fg-subtle",
};

export function RequestStatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[status] ?? TONE.DRAFT}`}>{label}</span>;
}
