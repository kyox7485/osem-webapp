"use client";

import type { LucideIcon } from "lucide-react";

// Segmented-pill tab control shared by every module (Clinical, Physiotherapy,
// resident Progress Notes, ...) so the many independent tab bars across the
// app read as one consistent pattern instead of each screen inventing its
// own underline style.

export function TabRow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`inline-flex flex-wrap items-center gap-1 rounded-xl bg-gray-100 p-1 ${className}`}>{children}</div>;
}

export function TabButton({
  active,
  onClick,
  children,
  size = "md",
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  size?: "md" | "sm";
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
        size === "sm" ? "px-3 py-1 text-[13px]" : "px-4 py-1.5 text-sm"
      } ${active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
    >
      {Icon && <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2} />}
      {children}
    </button>
  );
}
