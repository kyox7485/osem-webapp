"use client";

import { useTranslation } from "@/components/language-provider";
import { useNavPush } from "@/components/nav-loading";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { Field, INPUT_CLS } from "../components/form-bits";
import { Combobox } from "@/components/combobox";

/** Month + resident filter; a navigation, not a form, so it goes through guardedAction (CLAUDE.md). */
export function ChargesFilters({
  branchId,
  month,
  residentId,
  residents,
}: {
  branchId: number;
  month: string;
  residentId: number | null;
  residents: { id: number; label: string }[];
}) {
  const t = useTranslation();
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();

  function go(nextMonth: string, nextResident: number | null) {
    const qs = new URLSearchParams({ tab: "charges", branch: String(branchId), month: nextMonth });
    if (nextResident) qs.set("resident", String(nextResident));
    guardedAction(() => push(`/inventory/charges?${qs.toString()}`));
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label={t("Month")}>
        <input
          type="month"
          className={INPUT_CLS}
          value={month}
          onChange={(e) => e.target.value && go(e.target.value, residentId)}
        />
      </Field>
      <Combobox
        label={t("Resident")}
        inputClassName={INPUT_CLS}
        value={residentId ? String(residentId) : ""}
        // A navigation per pick or clear; typing alone is just searching.
        onChange={(id, reason) => {
          if (reason !== "type") go(month, id ? Number(id) : null);
        }}
        options={residents}
        placeholder={t("All residents")}
        clearable
        emptyMessage={t("No matching resident")}
      />
    </div>
  );
}
