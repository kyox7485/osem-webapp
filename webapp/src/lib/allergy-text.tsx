"use client";

// The allergy questionnaire's compile/parse pair, shared by every editor that
// writes `tbl_residents.allergy`.
//
// The column is a plain `text`, but it does NOT hold free text: it holds a
// machine-parsed, always-English string of the shape
//
//   Food allergy: Yes; Reaction: peanuts
//   Medicine allergy: No
//
// so a plain textarea over this column would orphan the questionnaire --
// parseAllergyText() would return null on the next read and the resident form
// would silently degrade to its raw-textarea fallback, losing the structured
// format on the next unrelated resident edit. Always round-trip through
// compileAllergy()/parseAllergyText().
//
// Client-safe by construction: no lib/lookups.ts, no lib/supabase/server.ts
// (CLAUDE.md's "never import server-only modules from a client component"
// footgun -- tsc will not catch a violation here, only `next build` will).

import { YesNoButtons } from "@/components/yes-no-buttons";

export type AllergyAnswers = {
  foodYN: "yes" | "no" | "";
  foodReaction: string;
  medYN: "yes" | "no" | "";
  medReaction: string;
};

export const EMPTY_ALLERGY: AllergyAnswers = {
  foodYN: "", foodReaction: "", medYN: "", medReaction: "",
};

export function compileAllergy(a: AllergyAnswers): string {
  const lines: string[] = [];
  if (a.foodYN) {
    const base = `Food allergy: ${a.foodYN === "yes" ? "Yes" : "No"}`;
    lines.push(a.foodYN === "yes" && a.foodReaction.trim()
      ? `${base}; Reaction: ${a.foodReaction.trim()}` : base);
  }
  if (a.medYN) {
    const base = `Medicine allergy: ${a.medYN === "yes" ? "Yes" : "No"}`;
    lines.push(a.medYN === "yes" && a.medReaction.trim()
      ? `${base}; Reaction: ${a.medReaction.trim()}` : base);
  }
  return lines.join("\n");
}

/** Returns null when the stored value is legacy/imported free text, not the compiled format. */
export function parseAllergyText(text: string): AllergyAnswers | null {
  const foodM = text.match(/^Food allergy: (Yes|No)(?:; Reaction: (.+))?$/m);
  const medM = text.match(/^Medicine allergy: (Yes|No)(?:; Reaction: (.+))?$/m);
  if (!foodM && !medM) return null;
  return {
    foodYN: foodM ? (foodM[1] === "Yes" ? "yes" : "no") : "",
    foodReaction: foodM?.[2]?.trim() ?? "",
    medYN: medM ? (medM[1] === "Yes" ? "yes" : "no") : "",
    medReaction: medM?.[2]?.trim() ?? "",
  };
}

const inputCls =
  "mt-1 w-full rounded-lg border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors";

export function AllergyQuestion({
  label,
  yn,
  reaction,
  reactionPlaceholder,
  onYN,
  onReaction,
  t,
}: {
  label: string;
  yn: "yes" | "no" | "";
  reaction: string;
  reactionPlaceholder: string;
  onYN: (v: "yes" | "no") => void;
  onReaction: (v: string) => void;
  t: (s: string) => string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-fg-secondary">{label}</p>
      <YesNoButtons value={yn} onChange={onYN} t={t} />
      {yn === "yes" && (
        <input
          type="text"
          value={reaction}
          onChange={(e) => onReaction(e.target.value)}
          placeholder={reactionPlaceholder}
          className={inputCls}
        />
      )}
    </div>
  );
}
