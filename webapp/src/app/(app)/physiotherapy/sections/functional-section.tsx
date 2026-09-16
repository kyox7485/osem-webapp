"use client";

import { FUNCTIONAL_OPTIONS, type FunctionalScores } from "@/lib/physio-scoring";
import { ScoreSelect } from "../score-select";
import { CollapsibleCard } from "../collapsible-card";

type Props = {
  value: FunctionalScores;
  onChange: (value: FunctionalScores) => void;
};

const ITEMS: [keyof FunctionalScores, string][] = [
  ["supine_to_side_lying", "Supine → Side lying"],
  ["side_lying_to_sitting", "Side lying → Sitting"],
  ["sitting_to_standing", "Sitting → Standing"],
  ["sit_at_edge_of_bed", "Sit at edge of bed"],
  ["ambulation", "Ambulation"],
];

export function FunctionalSection({ value, onChange }: Props) {
  const assessedCount = Object.values(value).filter((v) => v !== null).length;

  return (
    <CollapsibleCard title="Functional Assessment" badge={assessedCount > 0 ? `${assessedCount} assessed` : null}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ITEMS.map(([key, label]) => (
          <ScoreSelect
            key={key}
            label={label}
            value={value[key]}
            onChange={(v) => onChange({ ...value, [key]: v })}
            options={FUNCTIONAL_OPTIONS}
          />
        ))}
      </div>
    </CollapsibleCard>
  );
}
