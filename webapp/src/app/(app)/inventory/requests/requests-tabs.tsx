"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { TabRow, TabButton } from "@/components/tabs";
import { SCROLL_TABROW_CLS, TAB_BTN_CLS } from "../components/form-bits";

type View = "SUGGESTED" | "LIST";

/** Suggested order | Requests toggle. A local state toggle, so it goes through guardedAction (CLAUDE.md). */
export function RequestsTabs({ suggested, list, initialView }: { suggested: ReactNode; list: ReactNode; initialView: View }) {
  const t = useTranslation();
  const { guardedAction } = useSafeNavigation();
  const [view, setView] = useState<View>(initialView);
  const switchTo = (v: View) => guardedAction(() => setView(v));

  return (
    <div className="space-y-3">
      <TabRow className={SCROLL_TABROW_CLS}>
        <TabButton className={TAB_BTN_CLS} size="sm" active={view === "SUGGESTED"} onClick={() => switchTo("SUGGESTED")}>
          {t("Suggested order")}
        </TabButton>
        <TabButton className={TAB_BTN_CLS} size="sm" active={view === "LIST"} onClick={() => switchTo("LIST")}>
          {t("Requests")}
        </TabButton>
      </TabRow>
      {view === "LIST" ? list : suggested}
    </div>
  );
}
