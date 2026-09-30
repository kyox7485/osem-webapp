// Shared constants and UI primitives for medication order forms.
// Imported by both the standalone order form and the admission medications section.

export const DOSAGE_FORM_OPTIONS = [
  "Tablet", "Capsule", "Powder", "Syrup", "Cream", "Ointment", "Lotion",
  "Gel", "Patch", "Ear Drop", "Eye Drop", "S/C Injection", "I/M Injection", "Neb.", "Inhaler",
];

export const UNIT_OPTIONS = [
  "Tablet", "Capsule", "ml", "Sachet", "Unit", "Application", "Ampoule", "Puff", "Drop",
];

export const FREQUENCY_OPTIONS = [
  "OD", "BD", "TDS", "QID", "ON", "EOD", "Every 3 Days", "PRN", "Selected Days", "Others",
];

export const DAY_OPTIONS = [
  "Everyday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

export const TIME_SLOTS = [
  "1200AM", "0100AM", "0200AM", "0300AM", "0400AM", "0500AM",
  "0600AM", "0700AM", "0800AM", "0900AM", "1000AM", "1100AM",
  "1200PM", "0100PM", "0200PM", "0300PM", "0400PM", "0500PM",
  "0600PM", "0700PM", "0800PM", "0900PM", "1000PM", "1100PM",
];

export const FREQ_TIME_DEFAULTS: Record<string, string[]> = {
  OD:  ["0800AM"],
  BD:  ["0800AM", "0600PM"],
  TDS: ["0800AM", "1200PM", "0600PM"],
  QID: ["0800AM", "1200PM", "0600PM", "1000PM"],
  ON:  ["1000PM"],
};

export const DOSAGE_FORM_TO_UNIT_MAP: Record<string, string> = {
  "Tablet": "Tablet",
  "Capsule": "Capsule",
  "Powder": "Sachet",
  "Syrup": "ml",
  "Cream": "Application",
  "Ointment": "Application",
  "Lotion": "Application",
  "Gel": "Application",
  "Patch": "Unit",
  "Ear Drop": "Drop",
  "Eye Drop": "Drop",
  "S/C Injection": "Unit",
  "I/M Injection": "Unit",
  "Neb.": "Unit",
  "Inhaler": "Puff",
  "Others": "Unit",
};

export function getDefaultUnitForDosageForm(dosageForm: string): string | null {
  return DOSAGE_FORM_TO_UNIT_MAP[dosageForm] ?? null;
}

export const medInputCls =
  "w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg placeholder-fg-faint focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-surface-muted disabled:text-fg-faint";

export const medLabelCls = "block text-xs font-medium text-fg-muted mb-1";

export function ToggleGroup({
  options,
  value,
  onChange,
  disabled,
  t,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  t: (text: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          disabled={disabled}
          className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50
            ${value === opt
              ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
              : "border-line-strong bg-surface text-fg-muted hover:bg-hover"
            }`}
        >
          {t(opt)}
        </button>
      ))}
    </div>
  );
}

export function ChipSelector({
  options,
  selected,
  onToggle,
  disabled,
  t,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  disabled?: boolean;
  t: (text: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isSelected = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            disabled={disabled}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40
              ${isSelected
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-line bg-surface text-fg-muted hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
              }`}
          >
            {t(opt)}
          </button>
        );
      })}
    </div>
  );
}
