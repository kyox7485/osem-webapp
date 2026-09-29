"use client";

import { useNavPush } from "@/components/nav-loading";
import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";
import { TabRow, TabButton } from "@/components/tabs";
import { SCROLL_TABROW_CLS, TAB_BTN_CLS } from "./form-bits";

export type SubTabItem = { key: string; label: string };

/**
 * Sub-tab row for a master inventory page. The active tab lives in ?tab= so
 * old routes can deep-link; the server renders only the active panel. Button
 * tabs are invisible to the global <a> interceptor, so the switch goes through
 * guardedAction (CLAUDE.md).
 */
export function SubTabs({ basePath, items, active, branchId }: { basePath: string; items: SubTabItem[]; active: string; branchId: number | null }) {
  const push = useNavPush();
  const { guardedAction } = useSafeNavigation();
  const t = useTranslation();
  const go = (key: string) => {
    const qs = new URLSearchParams({ tab: key });
    if (branchId) qs.set("branch", String(branchId));
    guardedAction(() => push(`${basePath}?${qs.toString()}`));
  };
  if (items.length < 2) return null;
  return (
    <div className="mb-4">
      <TabRow className={SCROLL_TABROW_CLS}>
        {items.map((i) => (
          <TabButton className={TAB_BTN_CLS} key={i.key} size="sm" active={i.key === active} onClick={() => go(i.key)}>
            {t(i.label)}
          </TabButton>
        ))}
      </TabRow>
    </div>
  );
}
