"use client";

import { useTranslation } from "@/components/language-provider";
import { useSafeNavigation } from "@/lib/use-safe-navigation";

export function BackButton() {
  const { goBack } = useSafeNavigation();
  const t = useTranslation();
  return (
    <button
      type="button"
      onClick={goBack}
      className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-fg-subtle hover:text-fg"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 12.5L5.5 8l4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t("Back")}
    </button>
  );
}
