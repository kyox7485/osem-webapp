"use client";

import { usePathname } from "next/navigation";
import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { ClipboardList, BarChart3 } from "lucide-react";

// Top-level switch between the day-to-day assessment workflow (Inpatient /
// Outpatient tabs + entry forms) and the workload analytics dashboard. Kept
// separate from CareSettingTabs (IP/OP) since it's a different axis -- which
// screen, not which patient population.
export function PhysioModuleTabs({ showAnalytics = true }: { showAnalytics?: boolean }) {
  const push = useNavPush();
  const pathname = usePathname();
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const onDashboard = pathname?.startsWith("/physiotherapy/dashboard") ?? false;

  return (
    <TabRow>
      <TabButton icon={ClipboardList} active={!onDashboard} onClick={() => guardedAction(() => push("/physiotherapy"))}>
        {t("Assessments")}
      </TabButton>
      {showAnalytics && (
        <TabButton icon={BarChart3} active={onDashboard} onClick={() => guardedAction(() => push("/physiotherapy/dashboard"))}>
          {t("Analytics")}
        </TabButton>
      )}
    </TabRow>
  );
}
