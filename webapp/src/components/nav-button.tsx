"use client";

import { useNavPush } from "@/components/nav-loading";

type Props = {
  href: string;
  children: React.ReactNode;
  className?: string;
};

// Same idea as ClickableRow, for standalone "go to a page" buttons like
// "New resident" -- a plain <Link> doesn't show the shared NavLoadingProvider
// overlay on click, so this renders a button that pushes through it instead.
export function NavButton({ href, children, className }: Props) {
  const push = useNavPush();
  return (
    <button type="button" onClick={() => push(href)} className={className}>
      {children}
    </button>
  );
}
