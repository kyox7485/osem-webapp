"use client";

import { Combobox } from "@/components/combobox";
import { useTranslation } from "@/components/language-provider";
import type { LookupOption } from "@/lib/types";

export const OTHERS_SENTINEL = "__others__";

const BASE_CLS =
  "w-full rounded-md border border-line-strong bg-input text-fg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-surface-strong";

type Props = {
  id?: string;
  value: string;
  otherName: string;
  onValueChange: (v: string) => void;
  onOtherNameChange: (v: string) => void;
  staffOptions: LookupOption[];
  disabled?: boolean;
  required?: boolean;
  /** Input classes; defaults to the standard field style. */
  className?: string;
  /**
   * Accessible name. Callers render their own visible label (pointing at
   * `id`), so this one stays screen-reader only. Defaults to "Staff".
   */
  label?: string;
};

/**
 * Staff picker (see docs/staff-pickers.md): scroll the roster, type to narrow
 * it, or type a name that isn't on the roster.
 *
 * A typed name with no exact roster match is reported exactly as the old
 * "Others (specify below)" choice was -- value OTHERS_SENTINEL plus the name
 * via onOtherNameChange -- so callers' validation and payloads are unchanged.
 * A typed name that matches a roster entry exactly (case-insensitive) selects
 * that staff member instead.
 */
export function StaffPickerWithOther({
  id,
  value,
  otherName,
  onValueChange,
  onOtherNameChange,
  staffOptions,
  disabled,
  required,
  className,
  label,
}: Props) {
  const t = useTranslation();
  const isOthers = value === OTHERS_SENTINEL;

  function handleQuery(text: string) {
    const name = text.trim();
    const match = name ? staffOptions.find((s) => s.label.trim().toLowerCase() === name.toLowerCase()) : undefined;
    if (match) {
      onValueChange(String(match.id));
      onOtherNameChange("");
    } else if (name) {
      onValueChange(OTHERS_SENTINEL);
      onOtherNameChange(text);
    } else {
      onValueChange("");
      onOtherNameChange("");
    }
  }

  return (
    <div className="space-y-1">
      <Combobox
        id={id}
        hideLabel
        label={label ?? t("Staff")}
        value={value}
        // A pick or the clear button; typing is handled by handleQuery, which
        // decides between "roster match" and "name not on the list".
        onChange={(v, reason) => {
          if (reason === "type") return;
          onValueChange(v);
          onOtherNameChange("");
        }}
        onQueryChange={handleQuery}
        freeText={isOthers ? otherName : ""}
        options={staffOptions}
        placeholder={t("Select or type a name")}
        emptyMessage={t("Not on the staff list -- the name will be saved as typed")}
        disabled={disabled}
        required={required}
        inputClassName={className ?? BASE_CLS}
      />
      {isOthers && otherName.trim() && (
        <p className="text-xs text-fg-subtle">{t("Not on the staff list -- the name will be saved as typed")}</p>
      )}
    </div>
  );
}
