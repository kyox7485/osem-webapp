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
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";

const ICONS = { Users, Stethoscope, Activity, IdCard, ShieldCheck } satisfies Record<string, LucideIcon>;

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
  signOutSlot: React.ReactNode;
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
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 ${
        collapsed ? "w-[68px]" : "w-64"
      }`}
    >
      <div className={`relative flex flex-col items-center px-3 pt-4 pb-2 ${collapsed ? "gap-2" : ""}`}>
        {!collapsed && (
          <Link href="/" aria-label={homeLabel} className="shrink-0">
            <Image src="/logo.png" alt="" width={80} height={50} className="h-[70px] w-auto" priority />
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 ${
            collapsed ? "" : "absolute right-2 top-3"
          }`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
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
              } ${active ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
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
        <div className="border-t border-gray-200 px-3 py-3" title={collapsed ? `${footer.username} · ${t(footer.rights)} · ${footer.branchName}` : undefined}>
          {!collapsed && <div className="truncate text-xs text-gray-500">{footer.branchName}</div>}
          <div className={`flex items-center gap-2 ${collapsed ? "flex-col justify-center" : "justify-between pt-2"}`}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                {footer.initial}
              </span>
              {!collapsed && <span className="truncate text-sm font-medium text-gray-700">{footer.username}</span>}
            </div>
            {!collapsed && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {t(footer.rights)}
              </span>
            )}
          </div>
          <div className={collapsed ? "mt-2 flex justify-center text-xs text-gray-500 [&_button]:text-xs" : "mt-1 text-sm text-gray-500"}>
            {footer.signOutSlot}
          </div>
        </div>
      )}
    </aside>
  );
}
