"use client";

import { useRouter } from "next/navigation";

type Props = {
  href: string;
  children: React.ReactNode;
  className?: string;
};

// Whole-row navigation for list tables -- clicking anywhere in the row (not
// just the name cell) opens the detail page. Row still degrades to a plain
// tr with a click handler rather than an anchor, so this trades away
// keyboard/middle-click/ctrl-click support for a much larger, lower-effort
// click target, which is the tradeoff asked for on these internal list
// pages.
export function ClickableRow({ href, children, className }: Props) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href)}
      className={`cursor-pointer ${className ?? ""}`}
    >
      {children}
    </tr>
  );
}
