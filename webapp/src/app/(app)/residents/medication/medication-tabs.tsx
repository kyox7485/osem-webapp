"use client";

import { usePathname } from "next/navigation";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { ClipboardList, FileText, Package } from "lucide-react";

export function MedicationSubTabs() {
  const push = useNavPush();
  const pathname = usePathname();
  const t = useTranslation();
  const onCharts = pathname?.startsWith("/residents/medication/charts") ?? false;
  const onStock = pathname?.startsWith("/residents/medication/stock") ?? false;

  return (
    <TabRow>
      <TabButton
        size="sm"
        icon={ClipboardList}
        active={!onCharts && !onStock}
        onClick={() => push("/residents/medication/orders")}
      >
        {t("Orders")}
      </TabButton>
      <TabButton
        size="sm"
        icon={Package}
        active={onStock}
        onClick={() => push("/residents/medication/stock")}
      >
        {t("Stock")}
      </TabButton>
      <TabButton
        size="sm"
        icon={FileText}
        active={onCharts}
        onClick={() => push("/residents/medication/charts")}
      >
        {t("Charts")}
      </TabButton>
    </TabRow>
  );
}
