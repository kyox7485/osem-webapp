"use client";

import { COORDINATION_OPTIONS, type CoordinationScores } from "@/lib/physio-scoring";
import { ScoreSelect } from "../score-select";
import { CollapsibleCard } from "../collapsible-card";
import { useTranslation } from "@/components/language-provider";

type Props = {
  value: CoordinationScores;
  onChange: (value: CoordinationScores) => void;
};

export function CoordinationSection({ value, onChange }: Props) {
  const t = useTranslation();
  const assessedCount = Object.values(value).filter((v) => v !== null).length;

  return (
    <CollapsibleCard title={t("Coordination")} badge={assessedCount > 0 ? `${assessedCount} ${t("assessed")}` : null}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t("Upper Limb")}</h3>
          <div className="grid grid-cols-2 gap-2">
            <ScoreSelect
              label={t("Right")}
              value={value.upper_limb_right}
              onChange={(v) => onChange({ ...value, upper_limb_right: v })}
              options={COORDINATION_OPTIONS}
            />
            <ScoreSelect
              label={t("Left")}
              value={value.upper_limb_left}
              onChange={(v) => onChange({ ...value, upper_limb_left: v })}
              options={COORDINATION_OPTIONS}
            />
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t("Lower Limb")}</h3>
          <div className="grid grid-cols-2 gap-2">
            <ScoreSelect
              label={t("Right")}
              value={value.lower_limb_right}
              onChange={(v) => onChange({ ...value, lower_limb_right: v })}
              options={COORDINATION_OPTIONS}
            />
            <ScoreSelect
              label={t("Left")}
              value={value.lower_limb_left}
              onChange={(v) => onChange({ ...value, lower_limb_left: v })}
              options={COORDINATION_OPTIONS}
            />
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
}
