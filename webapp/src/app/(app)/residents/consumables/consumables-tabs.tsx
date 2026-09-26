"use client";

import { usePathname } from "next/navigation";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { TabRow, TabButton } from "@/components/tabs";
import { ClipboardCheck, Truck } from "lucide-react";

export function ConsumablesSubTabs() {
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const pathname = usePathname();
  const t = useTranslation();
  const onRestock = pathname?.startsWith("/residents/consumables/restock") ?? false;

  // <button> tabs are invisible to the NavigationGuard click interceptor, so
  // every switch goes through guardedAction (a dirty count or restock review
  // is confirmed before being discarded).
  const go = (href: string) => guardedAction(() => push(href));

  return (
    <TabRow>
      <TabButton size="sm" icon={ClipboardCheck} active={!onRestock} onClick={() => go("/residents/consumables/inventory")}>
        {t("Inventory")}
      </TabButton>
      <TabButton size="sm" icon={Truck} active={onRestock} onClick={() => go("/residents/consumables/restock")}>
        {t("Restock")}
      </TabButton>
    </TabRow>
  );
}
