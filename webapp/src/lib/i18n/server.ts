import { cookies } from "next/headers";
import { translate, LANGUAGE_COOKIE, type Language } from "./translate";

export async function getServerLanguage(): Promise<Language> {
  const store = await cookies();
  return store.get(LANGUAGE_COOKIE)?.value === "ms" ? "ms" : "en";
}

// For Server Components -- gives both the resolved language (to pass down
// to a client LanguageProvider as its initial value) and a ready-to-use t().
export async function getServerTranslator(): Promise<{ language: Language; t: (text: string) => string }> {
  const language = await getServerLanguage();
  return { language, t: (text: string) => translate(text, language) };
}
