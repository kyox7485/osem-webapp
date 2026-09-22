"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useGuardedNavigation } from "./dirty-form-context";

/**
 * For module components that need to guard their own in-app navigation:
 * route changes, sub-tab switches, resident switches, closing a modal, etc.
 *
 * If no form is dirty, the guarded action/navigation runs immediately.
 * If one is, the global unsaved-changes dialog opens first; the action only
 * runs once the user picks Save & Exit (after a successful save) or Exit
 * Without Saving.
 */
export function useSafeNavigation() {
  const router = useRouter();
  const guardAction = useGuardedNavigation();

  const navigateTo = useCallback(
    (path: string) => {
      guardAction(() => router.push(path));
    },
    [guardAction, router]
  );

  const goBack = useCallback(() => {
    guardAction(() => router.back());
  }, [guardAction, router]);

  /** Guard any other action that would abandon the current form -- a
   * sub-tab switch, closing a modal, changing the selected resident, etc. */
  const guardedAction = useCallback(
    (action: () => void) => {
      guardAction(action);
    },
    [guardAction]
  );

  return { navigateTo, goBack, guardedAction };
}
