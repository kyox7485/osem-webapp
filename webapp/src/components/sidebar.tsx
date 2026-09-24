"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/components/language-provider";
import {
  Users,
  Stethoscope,
  Activity,
  IdCard,
  ShieldCheck,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";

const ICONS = { Users, Stethoscope, Activity, IdCard, ShieldCheck, Link2 } satisfies Record<string, LucideIcon>;

export type SidebarItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  // Soft icon-tile background + icon color -- one accent per module so the
  // rail reads as a set of distinct destinations, not a wall of grey text.
  tint: string;
};

export type SidebarFooterInfo = {
  branchName: string;
  rights: string;
  username: string;
  initial: string;
};

const STORAGE_KEY = "osem_sidebar_collapsed";

export function Sidebar({
  items,
  homeLabel,
  footer,
}: {
  items: SidebarItem[];
  homeLabel: string;
  footer?: SidebarFooterInfo;
}) {
  const pathname = usePathname();
  const t = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Reads the persisted collapse state once on mount -- server-rendered
    // markup has no access to localStorage, so this can't be an initial
    // useState value without a hydration mismatch.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private browsing / storage disabled -- fall back to expanded.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore -- collapse state just won't persist this session.
      }
      return next;
    });
  }

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 ${
        collapsed ? "w-[68px]" : "w-64"
      }`}
    >
      <div className={`relative flex flex-col items-center px-3 pt-4 pb-2 ${collapsed ? "gap-2" : ""}`}>
        {!collapsed && (
          // logo-dark.png is logo.png with only the black wordmark inverted to
          // white (brand colours untouched). Swapped in CSS, not JS, so the
          // right one shows on first paint with no hydration flash.
          <Link href="/" aria-label={homeLabel} className="shrink-0">
            <Image src="/logo.png" alt="" width={80} height={50} className="h-[70px] w-auto dark:hidden" priority />
            <Image src="/logo-dark.png" alt="" width={80} height={50} className="hidden h-[70px] w-auto dark:block" />
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-surface-strong hover:text-fg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40 ${
            collapsed ? "" : "absolute right-2 top-3"
          }`}
          aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              className={`flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/40 ${
                collapsed ? "justify-center px-0" : "justify-start px-2.5"
              } ${active ? "bg-selected text-selected-fg" : "text-fg-muted hover:bg-hover hover:text-fg"}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.tint}`}>
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {footer && (
        <div
          className="border-t border-line px-3 py-3"
          title={collapsed ? `${footer.username} · ${t(footer.rights)} · ${footer.branchName}` : undefined}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                {footer.initial}
              </span>
              <SignOutButton collapsed />
            </div>
          ) : (
            <>
              <div className="truncate text-xs text-fg-subtle">{footer.branchName}</div>
              <div className="flex items-center justify-between pt-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                    {footer.initial}
                  </span>
                  <span className="truncate text-sm font-medium text-fg-secondary">{footer.username}</span>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-full bg-surface-strong px-2 py-0.5 text-xs font-medium text-fg-secondary">
                  {t(footer.rights)}
                </span>
              </div>
              <div className="mt-2">
                <SignOutButton />
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
