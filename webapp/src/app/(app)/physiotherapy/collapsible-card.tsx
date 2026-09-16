"use client";

import { useState } from "react";

type Props = {
  title: string;
  defaultOpen?: boolean;
  badge?: string | null;
  children: React.ReactNode;
};

// Shared top-level collapsible section wrapper for Body Chart, Physical
// Examination, Functional Assessment, Balance and Coordination -- not every
// one of these is touched at every visit, so each collapses independently,
// closed by default unless it already carries data (e.g. carried forward
// from a previous note). Own open/closed state (seeded once) rather than
// deriving `open` live from props, so clearing the section's last value
// doesn't auto-collapse it out from under the therapist mid-edit.
export function CollapsibleCard({ title, defaultOpen = false, badge, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group rounded-md border border-gray-200 bg-white shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 hover:bg-gray-50">
        <span className="text-sm font-bold text-gray-900">{title}</span>
        <span className="flex items-center gap-2">
          {badge && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{badge}</span>
          )}
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="text-gray-400 transition-transform group-open:rotate-90"
          >
            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <div className="border-t border-gray-100 p-4">{children}</div>
    </details>
  );
}
