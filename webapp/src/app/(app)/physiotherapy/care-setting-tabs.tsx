"use client";

import { useNavPush } from "@/components/nav-loading";
import type { PhysioCareSetting } from "@/lib/physio-scoring";
import { useTranslation } from "@/components/language-provider";
import { TabRow, TabButton } from "@/components/tabs";
import { BedDouble, DoorOpen } from "lucide-react";

type Props = {
  current: PhysioCareSetting;
};

export function CareSettingTabs({ current }: Props) {
  const push = useNavPush();
  const t = useTranslation();

  function switchTo(setting: PhysioCareSetting) {
    push(`/physiotherapy?type=${setting.toLowerCase()}`);
  }

  return (
    <TabRow>
      <TabButton icon={BedDouble} active={current === "IP"} onClick={() => switchTo("IP")}>
        {t("Inpatient")}
      </TabButton>
      <TabButton icon={DoorOpen} active={current === "OP"} onClick={() => switchTo("OP")}>
        {t("Outpatient")}
      </TabButton>
    </TabRow>
  );
}
