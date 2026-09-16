"use client";

import { useState } from "react";

type Props = {
  title: string;
  badge?: string | null;
  children: React.ReactNode;
};

// Shared collapsible section wrapper -- used both for the top-level blocks
// (Body Chart, Physical Examination, Functional Assessment, Balance,
// Coordination) and for the nested groups inside Physical Examination
// (Upper/Lower Limb, and each body part within them). Always starts closed,
// even when it already carries data (e.g. carried forward from a previous
// note) -- the therapist expands only what they mean to look at or edit.
// Independent per-instance open state (not derived from props on every
// render) means toggling one block/region never affects its parent or
// siblings, and clearing its last value doesn't auto-collapse it out from
// under the therapist mid-edit.
export function CollapsibleCard({ title, badge, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <details
      open={open}
      // currentTarget, not target -- Physical Examination nests further
      // collapsible groups (Limb, then Region) inside this one, and a
      // toggle on one of those can reach this handler; e.target would then
      // be the nested element that actually toggled, incorrectly flipping
      // this card's own state (e.g. collapsing a body part would also
      // collapse the whole Physical Examination card above it).
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
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
