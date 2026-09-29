"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { TabRow, TabButton } from "@/components/tabs";

type View = "INVOICE" | "TRANSFER";

/** Supplier invoice | Branch transfer toggle, plus the awaiting-receipt notice. */
export function ReceiveTabs({
  invoice,
  transfers,
  pendingCount,
}: {
  invoice: ReactNode;
  /** null when the user may not receive branch transfers. */
  transfers: ReactNode | null;
  pendingCount: number;
}) {
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [view, setView] = useState<View>("INVOICE");
  const switchTo = (v: View) => guardedAction(() => setView(v));

  return (
    <div className="space-y-3">
      {transfers !== null && pendingCount > 0 && view !== "TRANSFER" && (
        <button
          type="button"
          onClick={() => switchTo("TRANSFER")}
          className="w-full cursor-pointer rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-left text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
        >
          {pendingCount === 1
            ? t("{count} branch transfer awaiting receipt", { count: pendingCount })
            : t("{count} branch transfers awaiting receipt", { count: pendingCount })}
        </button>
      )}
      {transfers !== null && (
        <TabRow>
          <TabButton size="sm" active={view === "INVOICE"} onClick={() => switchTo("INVOICE")}>
            {t("Supplier invoice")}
          </TabButton>
          <TabButton size="sm" active={view === "TRANSFER"} onClick={() => switchTo("TRANSFER")}>
            {t("Branch transfer")}
          </TabButton>
        </TabRow>
      )}
      {view === "TRANSFER" && transfers !== null ? transfers : invoice}
    </div>
  );
}
