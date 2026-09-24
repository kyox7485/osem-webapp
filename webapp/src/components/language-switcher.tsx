"use client";

import { useLanguage } from "./language-provider";
import type { Language } from "@/lib/i18n/translate";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      aria-label={t("Language")}
      className="cursor-pointer rounded-full border border-line bg-surface-muted px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-strong focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
    >
      <option value="en">🇬🇧 English</option>
      <option value="ms">🇲🇾 Bahasa Malaysia</option>
    </select>
  );
}
