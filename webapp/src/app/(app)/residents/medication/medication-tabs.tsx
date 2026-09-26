"use client";

import { usePathname } from "next/navigation";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { TabRow, TabButton } from "@/components/tabs";
import { ClipboardList, FileText, Package, ShoppingCart } from "lucide-react";

export function MedicationSubTabs() {
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const pathname = usePathname();
  const t = useTranslation();
  const onCharts = pathname?.startsWith("/residents/medication/charts") ?? false;
  const onStock = pathname?.startsWith("/residents/medication/stock") ?? false;
  const onPurchase = pathname?.startsWith("/residents/medication/purchase") ?? false;

  // These are <button> tabs, not <a> links, so the app-wide NavigationGuard
  // click interceptor cannot see them — every switch must go through
  // guardedAction so a dirty form (e.g. an edited Purchase review) is
  // confirmed before being discarded. push() is kept inside the guard so the
  // loading overlay still shows once the user confirms.
  const go = (href: string) => guardedAction(() => push(href));

  return (
    <TabRow>
      <TabButton
        size="sm"
        icon={ClipboardList}
        active={!onCharts && !onStock && !onPurchase}
        onClick={() => go("/residents/medication/orders")}
      >
        {t("Orders")}
      </TabButton>
      <TabButton
        size="sm"
        icon={Package}
        active={onStock}
        onClick={() => go("/residents/medication/stock")}
      >
        {t("Stock")}
      </TabButton>
      <TabButton
        size="sm"
        icon={FileText}
        active={onCharts}
        onClick={() => go("/residents/medication/charts")}
      >
        {t("Charts")}
      </TabButton>
      <TabButton
        size="sm"
        icon={ShoppingCart}
        active={onPurchase}
        onClick={() => go("/residents/medication/purchase")}
      >
        {t("Purchase")}
      </TabButton>
    </TabRow>
  );
}
