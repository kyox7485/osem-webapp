"use client";

import { useNavPush } from "@/components/nav-loading";
import type { PhysioCareSetting } from "@/lib/physio-scoring";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { BedDouble, DoorOpen } from "lucide-react";

type Props = {
  current: PhysioCareSetting;
  showOp?: boolean;
};

export function CareSettingTabs({ current, showOp = true }: Props) {
  const push = useNavPush();
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();

  function switchTo(setting: PhysioCareSetting) {
    guardedAction(() => push(`/physiotherapy?type=${setting.toLowerCase()}`));
  }

  return (
    <TabRow>
      <TabButton icon={BedDouble} active={current === "IP"} onClick={() => switchTo("IP")}>
        {t("Inpatient")}
      </TabButton>
      {showOp && (
        <TabButton icon={DoorOpen} active={current === "OP"} onClick={() => switchTo("OP")}>
          {t("Outpatient")}
        </TabButton>
      )}
    </TabRow>
  );
}
