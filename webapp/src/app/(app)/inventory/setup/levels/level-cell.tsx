"use client";

import { useState } from "react";
import { useTranslation } from "@/components/language-provider";
import { messageForCode, parseMoney } from "@/lib/inventory/core";
import { useInvSubmit } from "../../components/use-inv-submit";
import { SECONDARY_BTN_CLS, SMALL_INPUT_CLS, Spinner } from "../../components/form-bits";

/** One max-level override (base units). Placeholder shows the product default. */
export function LevelCell({
  locationId,
  productId,
  current,
  fallback,
}: {
  locationId: number;
  productId: number;
  current: number | null;
  fallback: number | null;
}) {
  const t = useTranslation();
  const [value, setValue] = useState(current === null ? "" : String(current));
  const state = useInvSubmit("inv_set_stock_level", `inv-level-${locationId}-${productId}`);
  const changed = value.trim() !== (current === null ? "" : String(current));

  return (
    <form
      className="flex items-center gap-1"
      onChangeCapture={state.touch}
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseMoney(value, false);
        if (n === undefined || n === null) return state.setError("INVALID_NUMBER");
        state.submit({ location_id: locationId, product_id: productId, max_qty: n });
      }}
    >
      <input
        className={`${SMALL_INPUT_CLS} w-24`}
        inputMode="decimal"
        value={value}
        placeholder={fallback === null ? "" : String(fallback)}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t("Max")}
      />
      {changed && (
        <button type="submit" className={SECONDARY_BTN_CLS} disabled={state.isPending}>
          {state.isPending ? <Spinner /> : t("Save")}
        </button>
      )}
      {state.error && <span className="text-xs text-red-600 dark:text-red-400">{t(messageForCode(state.error))}</span>}
      {state.success && !changed && <span className="text-xs text-emerald-700 dark:text-emerald-400">{t("Saved.")}</span>}
    </form>
  );
}
