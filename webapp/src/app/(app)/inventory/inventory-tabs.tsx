"use client";

import { usePathname } from "next/navigation";
import {
  Boxes,
  ClipboardList,
  PackagePlus,
  PackageMinus,
  ArrowLeftRight,
  Settings,
  ShoppingCart,
  ListChecks,
  Receipt,
  CalendarCheck,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { TabRow, TabButton } from "@/components/tabs";
import { SCROLL_TABROW_CLS, TAB_BTN_CLS } from "./components/form-bits";
import { INV_TIER, type InvBranch } from "@/lib/inventory/core";
import { ScannerSetupNote } from "./components/scanner-note";

type Tab = { href: string; label: string; icon: LucideIcon; minRank: number };

const TABS: Tab[] = [
  { href: "/inventory/stock", label: "Stock", icon: Boxes, minRank: INV_TIER.VIEW },
  { href: "/inventory/transactions", label: "Transactions", icon: ClipboardList, minRank: INV_TIER.VIEW },
  { href: "/inventory/receive", label: "Receive", icon: PackagePlus, minRank: INV_TIER.RECEIPT },
  { href: "/inventory/issue", label: "Issue", icon: PackageMinus, minRank: INV_TIER.ISSUE },
  { href: "/inventory/transfers", label: "Transfers", icon: ArrowLeftRight, minRank: INV_TIER.TRANSFER },
  { href: "/inventory/counts", label: "Counts", icon: ListChecks, minRank: INV_TIER.COUNT },
  { href: "/inventory/charges", label: "Charges", icon: Receipt, minRank: INV_TIER.VIEW_CHARGES },
  { href: "/inventory/month-end", label: "Month-end", icon: CalendarCheck, minRank: INV_TIER.PERIOD_LOCK },
  { href: "/inventory/requests", label: "Stock requests", icon: ShoppingCart, minRank: INV_TIER.STOCK_REQUEST },
  { href: "/inventory/reports", label: "Reports", icon: BarChart3, minRank: INV_TIER.VIEW },
  { href: "/inventory/setup/products", label: "Setup", icon: Settings, minRank: INV_TIER.VIEW },
];

/**
 * Module tabs + branch picker. <button> tabs are invisible to the global <a>
 * click interceptor, so every switch goes through guardedAction (CLAUDE.md).
 * The branch travels as ?branch= and pages key their module on it.
 */
export function InventoryTabs({ rank, branches, branchId }: { rank: number; branches: InvBranch[]; branchId: number | null }) {
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const pathname = usePathname() ?? "";
  const t = useTranslation();
  const go = (href: string, branch = branchId) => guardedAction(() => push(branch ? `${href}?branch=${branch}` : href));
  const active = (href: string) =>
    href.startsWith("/inventory/setup") ? pathname.startsWith("/inventory/setup") : pathname.startsWith(href);

  return (
    <div className="mb-6 flex flex-col gap-3">
      <TabRow className={SCROLL_TABROW_CLS}>
        {TABS.filter((tab) => rank >= tab.minRank).map((tab) => (
          <TabButton className={TAB_BTN_CLS} key={tab.href} size="sm" icon={tab.icon} active={active(tab.href)} onClick={() => go(tab.href)}>
            {t(tab.label)}
          </TabButton>
        ))}
      </TabRow>
      {branches.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          {t("Branch")}
          <select
            className="rounded-md border border-line-strong bg-input px-2 py-1 text-sm text-fg max-md:min-h-11 max-md:text-base"
            value={branchId ?? ""}
            onChange={(e) => go(pathname, Number(e.target.value))}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function SetupSubTabs({ branchId }: { branchId: number | null }) {
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const pathname = usePathname() ?? "";
  const t = useTranslation();
  const items = [
    { href: "/inventory/setup/products", label: "Products" },
    { href: "/inventory/setup/suppliers", label: "Suppliers" },
    { href: "/inventory/setup/levels", label: "Max levels" },
  ];
  return (
    <div className="mb-4">
      <TabRow className={SCROLL_TABROW_CLS}>
        {items.map((i) => (
          <TabButton
            className={TAB_BTN_CLS}
            key={i.href}
            size="sm"
            active={pathname.startsWith(i.href)}
            onClick={() => guardedAction(() => push(branchId ? `${i.href}?branch=${branchId}` : i.href))}
          >
            {t(i.label)}
          </TabButton>
        ))}
      </TabRow>
      <ScannerSetupNote />
    </div>
  );
}
