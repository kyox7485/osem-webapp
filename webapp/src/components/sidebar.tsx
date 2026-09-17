"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

const STORAGE_KEY = "osem_sidebar_collapsed";

export function Sidebar({ items, homeLabel }: { items: SidebarItem[]; homeLabel: string }) {
  const pathname = usePathname();
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
        collapsed ? "w-[68px]" : "w-[68px] md:w-64"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-4">
        <Link href="/" className="flex min-w-0 items-center gap-2 overflow-hidden" aria-label={homeLabel}>
          <Image src="/logo.png" alt="" width={32} height={20} className="h-7 w-auto shrink-0" priority />
          {!collapsed && <span className="hidden truncate text-sm font-semibold text-gray-900 md:inline">OSEM</span>}
        </Link>
        <button
          type="button"
          onClick={toggle}
          className="ml-auto shrink-0 cursor-pointer rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
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
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/40 ${
                active ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.tint}`}>
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              {!collapsed && <span className="hidden truncate md:inline">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
