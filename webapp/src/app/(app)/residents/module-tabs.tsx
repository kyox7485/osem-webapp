"use client";

import { usePathname } from "next/navigation";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { Users, BarChart3, Pill } from "lucide-react";

export function ResidentsModuleTabs() {
  const push = useNavPush();
  const pathname = usePathname();
  const t = useTranslation();
  const onAnalytics = pathname?.startsWith("/residents/admission-analytics") ?? false;
  const onMedication = pathname?.startsWith("/residents/medication") ?? false;

  return (
    <TabRow>
      <TabButton icon={Users} active={!onAnalytics && !onMedication} onClick={() => push("/residents")}>
        {t("Resident's Particular")}
      </TabButton>
      <TabButton icon={Pill} active={onMedication} onClick={() => push("/residents/medication")}>
        {t("Medication")}
      </TabButton>
      <TabButton icon={BarChart3} active={onAnalytics} onClick={() => push("/residents/admission-analytics")}>
        {t("Admission Analytics")}
      </TabButton>
    </TabRow>
  );
}
