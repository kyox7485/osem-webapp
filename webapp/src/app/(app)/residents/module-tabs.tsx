"use client";

import { usePathname } from "next/navigation";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { TabRow, TabButton } from "@/components/tabs";
import { Users, BarChart3, Pill, Package } from "lucide-react";

export function ResidentsModuleTabs() {
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const pathname = usePathname();
  const t = useTranslation();
  const onAnalytics = pathname?.startsWith("/residents/admission-analytics") ?? false;
  const onMedication = pathname?.startsWith("/residents/medication") ?? false;
  const onConsumables = pathname?.startsWith("/residents/consumables") ?? false;

  // <button> tabs, so the app-wide NavigationGuard click interceptor cannot
  // see them — route through guardedAction so a dirty form is confirmed
  // before its unsaved edits are abandoned.
  const go = (href: string) => guardedAction(() => push(href));

  return (
    <TabRow>
      <TabButton icon={Users} active={!onAnalytics && !onMedication && !onConsumables} onClick={() => go("/residents")}>
        {t("Resident's Particular")}
      </TabButton>
      <TabButton icon={Pill} active={onMedication} onClick={() => go("/residents/medication")}>
        {t("Medication")}
      </TabButton>
      <TabButton icon={Package} active={onConsumables} onClick={() => go("/residents/consumables")}>
        {t("Consumables")}
      </TabButton>
      <TabButton icon={BarChart3} active={onAnalytics} onClick={() => go("/residents/admission-analytics")}>
        {t("Admission Analytics")}
      </TabButton>
    </TabRow>
  );
}
