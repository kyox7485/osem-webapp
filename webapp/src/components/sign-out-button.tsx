"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "./language-provider";
import { useGuardedNavigation } from "@/lib/dirty-form-context";

export function SignOutButton({ collapsed }: { collapsed?: boolean } = {}) {
  const router = useRouter();
  const t = useTranslation();
  const guardAction = useGuardedNavigation();

  async function doSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleSignOut() {
    guardAction(() => { void doSignOut(); });
  }

  if (collapsed) {
    return (
      <button
        onClick={handleSignOut}
        aria-label={t("Sign out")}
        title={t("Sign out")}
        className="flex h-9 w-9 items-center justify-center rounded-md text-gray-400 dark:text-gray-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/40"
      >
        <LogOut className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      onClick={handleSignOut}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 dark:text-gray-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/40"
    >
      <LogOut className="h-4 w-4 shrink-0" />
      {t("Sign out")}
    </button>
  );
}
