"use client";

import { BALANCE_OPTIONS, type BalanceScores } from "@/lib/physio-scoring";
import { ScoreSelect } from "../score-select";

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
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-900">Balance</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ITEMS.map(([key, label]) => (
          <ScoreSelect
            key={key}
            label={label}
            value={value[key]}
            onChange={(v) => onChange({ ...value, [key]: v })}
            options={BALANCE_OPTIONS}
          />
        ))}
      </div>
    </div>
  );
}
