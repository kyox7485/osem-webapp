"use client";

import { useNavPush } from "@/components/nav-loading";
import type { PhysioCareSetting } from "@/lib/physio-scoring";
import { useTranslation } from "@/components/language-provider";

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
    <div className="mb-4 flex gap-1 border-b border-gray-200">
      <TabButton active={current === "IP"} onClick={() => switchTo("IP")}>
        {t("Inpatient")}
      </TabButton>
      <TabButton active={current === "OP"} onClick={() => switchTo("OP")}>
        {t("Outpatient")}
      </TabButton>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800"
      }`}
    >
      {children}
    </button>
  );
}
