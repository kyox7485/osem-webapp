"use client";

import { BALANCE_OPTIONS, type BalanceScores } from "@/lib/physio-scoring";
import { ScoreSelect } from "../score-select";
import { CollapsibleCard } from "../collapsible-card";
import { useTranslation } from "@/components/language-provider";

type Props = {
  value: BalanceScores;
  onChange: (value: BalanceScores) => void;
};

// No Right/Left -- balance is assessed as a whole, not per side.
const ITEMS: [keyof BalanceScores, string][] = [
  ["sitting_static", "Sitting - Static"],
  ["sitting_dynamic", "Sitting - Dynamic"],
  ["standing_static", "Standing - Static"],
  ["standing_dynamic", "Standing - Dynamic"],
];

export function BalanceSection({ value, onChange }: Props) {
  const t = useTranslation();
  const assessedCount = Object.values(value).filter((v) => v !== null).length;

  return (
    <CollapsibleCard title={t("Balance")} badge={assessedCount > 0 ? `${assessedCount} ${t("assessed")}` : null}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ITEMS.map(([key, label]) => (
          <ScoreSelect
            key={key}
            label={t(label)}
            value={value[key]}
            onChange={(v) => onChange({ ...value, [key]: v })}
            options={BALANCE_OPTIONS}
          />
        ))}
      </div>
    </CollapsibleCard>
  );
}
