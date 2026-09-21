"use client";

import { usePathname } from "next/navigation";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { ClipboardList, FileText } from "lucide-react";

export function MedicationSubTabs() {
  const push = useNavPush();
  const pathname = usePathname();
  const t = useTranslation();
  const onCharts = pathname?.startsWith("/residents/medication/charts") ?? false;

  return (
    <TabRow>
      <TabButton
        size="sm"
        icon={ClipboardList}
        active={!onCharts}
        onClick={() => push("/residents/medication/orders")}
      >
        {t("Orders")}
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
