"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGuardedNavigation } from "@/lib/dirty-form-context";

/**
 * App-wide interceptor for plain in-app navigation: sidebar links, "Back to
 * list" links, breadcrumbs, etc. Mounted once near the root so no individual
 * nav component has to know about the dirty-form system.
 *
 * It does NOT cover sub-tab switches implemented as local React state
 * (e.g. "Review Notes" / "New Entry" toggles) -- those don't produce a real
 * <a> click, so those modules call `guardedAction` from `useSafeNavigation`
 * directly around their own tab-switch handler.
 */
export function NavigationGuard() {
  const router = useRouter();
  const guardAction = useGuardedNavigation();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.dataset.skipUnsavedGuard !== undefined) return;

      const href = anchor.getAttribute("href") || "";
      // Only guard same-origin, in-app navigations -- not "#anchor" links,
      // mailto:/tel:, or external URLs.
      if (!href.startsWith("/") || href.startsWith("//")) return;

      e.preventDefault();
      guardAction(() => router.push(href));
    }

    // Capture phase so this runs before Next.js Link's own click handler,
    // which bails out when it sees `event.defaultPrevented`.
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [guardAction, router]);

  return null;
}
