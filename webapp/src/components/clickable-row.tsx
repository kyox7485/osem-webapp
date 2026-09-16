"use client";

import { useNavPush } from "@/components/nav-loading";

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
// pages. Routed through useNavPush (not router.push directly) so the shared
// NavLoadingProvider overlay shows while the detail page loads.
export function ClickableRow({ href, children, className }: Props) {
  const push = useNavPush();
  return (
    <tr
      onClick={() => push(href)}
      className={`cursor-pointer ${className ?? ""}`}
    >
      {children}
    </tr>
  );
}
