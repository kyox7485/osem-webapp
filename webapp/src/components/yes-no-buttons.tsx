"use client";

// Shared Yes/No control for the admission and assessment questionnaires
// (allergy questions, assessment symptoms). Extracted so the resident form and
// the inline progress-note editors render the identical control.

export function YesNoButtons({
  value,
  onChange,
  t,
}: {
  value: "yes" | "no" | "";
  onChange: (v: "yes" | "no") => void;
  t: (s: string) => string;
}) {
  return (
    <div className="mt-1.5 flex gap-2">
      {(["yes", "no"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`min-w-[72px] cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            value === opt
              ? opt === "yes"
                ? "border-green-500 bg-green-50 text-green-700 shadow-sm dark:bg-green-950/40 dark:text-green-300"
                : "border-fg-faint bg-surface-strong text-fg-secondary shadow-sm"
              : "border-line-strong bg-surface text-fg-subtle hover:border-fg-faint hover:bg-hover"
          }`}
        >
          {opt === "yes" ? t("Yes") : t("No")}
        </button>
      ))}
    </div>
  );
}