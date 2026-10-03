"use client";

import { useMemo } from "react";
import { Combobox } from "@/components/combobox";
import { useTranslation } from "@/components/language-provider";

type Props = {
  residents: { id: number | string; resident_name: string }[];
  value: string;
  onChange: (id: string) => void;
  /** Defaults to "Resident". */
  label?: string;
  /**
   * Filter mode (URL-driven filters, where "" usually means every resident):
   * the text is the placeholder and the field gets a clear (×) button.
   * Typing over the current pick does not report "" here -- only a new pick
   * or the × button does -- so a URL-driven filter never navigates mid-search.
   */
  filterPlaceholder?: string;
  required?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
  id?: string;
  className?: string;
  inputClassName?: string;
};

/**
 * The resident picker used across Clinical: scroll the full list or type part
 * of a name to narrow it. Selection callbacks fire no native change event, so
 * a form relying on onChangeCapture for its dirty guard must mark itself
 * dirty in `onChange`.
 */
export function ResidentCombobox({ residents, value, onChange, label, filterPlaceholder, ...rest }: Props) {
  const t = useTranslation();
  const options = useMemo(() => residents.map((r) => ({ id: r.id, label: r.resident_name })), [residents]);
  return (
    <Combobox
      {...rest}
      label={label ?? t("Resident")}
      value={value}
      onChange={(id, reason) => {
        if (filterPlaceholder !== undefined && reason === "type") return;
        onChange(id);
      }}
      options={options}
      placeholder={filterPlaceholder}
      clearable={filterPlaceholder !== undefined}
      emptyMessage={t("No matching resident")}
    />
  );
}
