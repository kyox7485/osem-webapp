"use client";

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
  className?: string;
};

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
}: Props) {
  const t = useTranslation();
  const isOthers = value === OTHERS_SENTINEL;
  const cls = className ?? BASE_CLS;

  return (
    <div className="space-y-2">
      <select
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
        required={required}
        className={cls}
      >
        <option value="">{t("Select staff")}</option>
        {staffOptions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
        <option value={OTHERS_SENTINEL}>{t("Others (specify below)")}</option>
      </select>
      {isOthers && (
        <input
          type="text"
          value={otherName}
          onChange={(e) => onOtherNameChange(e.target.value)}
          placeholder={t("Enter name...")}
          required={required}
          className={BASE_CLS}
        />
      )}
    </div>
  );
}
