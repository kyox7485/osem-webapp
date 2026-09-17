"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "./language-provider";

export function SignOutButton() {
  const router = useRouter();
  const t = useTranslation();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button onClick={handleSignOut} className="text-gray-500 hover:text-gray-900">
      {t("Sign out")}
    </button>
  );
}
