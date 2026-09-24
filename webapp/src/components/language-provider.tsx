"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, LANGUAGE_COOKIE, type Language, type TranslateParams } from "@/lib/i18n/translate";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string, params?: TranslateParams) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

// initialLanguage comes from the server (cookie read in the root layout)
// so the first paint already matches -- no flash of the wrong language.
export function LanguageProvider({ initialLanguage, children }: { initialLanguage: Language; children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const router = useRouter();

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      document.cookie = `${LANGUAGE_COOKIE}=${next}; path=/; max-age=31536000`;
      // Server Components (page.tsx data-fetching, etc.) read the cookie
      // directly, so they need a refresh to pick up the new language too.
      router.refresh();
    },
    [router]
  );

  const t = useCallback((text: string, params?: TranslateParams) => translate(text, language, params), [language]);

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}

// Convenience for components that only need to translate, not switch.
export function useTranslation(): (text: string, params?: TranslateParams) => string {
  return useLanguage().t;
}
