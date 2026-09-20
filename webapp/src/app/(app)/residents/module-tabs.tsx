"use client";

import { usePathname } from "next/navigation";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { Users, BarChart3 } from "lucide-react";

export function ResidentsModuleTabs() {
  const push = useNavPush();
  const pathname = usePathname();
  const t = useTranslation();
  const onAnalytics = pathname?.startsWith("/residents/admission-analytics") ?? false;

  return (
    <TabRow>
      <TabButton icon={Users} active={!onAnalytics} onClick={() => push("/residents")}>
        {t("Resident's Particular")}
      </TabButton>
      <TabButton icon={BarChart3} active={onAnalytics} onClick={() => push("/residents/admission-analytics")}>
        {t("Admission Analytics")}
      </TabButton>
    </TabRow>
  );
}
