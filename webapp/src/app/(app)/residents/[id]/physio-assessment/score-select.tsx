"use client";

import type { ScoreOption } from "@/lib/physio-scoring";

type Props = {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  options: ScoreOption[];
  id?: string;
};

// Generic nullable-score dropdown -- always has a blank "Not assessed" first
// option that maps to `null`, never to 0. Used for every Power/Tone/ROM/
// Reflexes/Balance/Coordination/Functional field in this module.
export function ScoreSelect({ label, value, onChange, options, id }: Props) {
  return (
    <label className="block text-xs text-gray-500">
      {label}
      <select
        id={id}
        value={value === null ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">Not assessed</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
