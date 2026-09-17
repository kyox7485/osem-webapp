"use client";

import { useLanguage } from "./language-provider";
import type { Language } from "@/lib/i18n/translate";

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      aria-label="Language"
      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    >
      <option value="en">🇬🇧 English</option>
      <option value="ms">🇲🇾 Bahasa Malaysia</option>
    </select>
  );
}
