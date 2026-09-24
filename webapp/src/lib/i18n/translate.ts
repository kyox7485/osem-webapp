import { msDictionary } from "./translations";

export type Language = "en" | "ms";

// Not httpOnly -- the client-side switcher writes it directly via
// document.cookie so both server and client renders agree on language
// without a round trip.
export const LANGUAGE_COOKIE = "osem_lang";

/**
 * Values to substitute into a translated string's `{placeholder}` tokens,
 * e.g. translate("Showing {count} residents", "ms", { count: 5 }).
 * The dictionary key (English text) keeps the placeholder names, so the
 * Bahasa Malaysia entry can reorder them freely (grammar differs) without
 * touching the call site.
 */
export type TranslateParams = Record<string, string | number>;

function interpolate(text: string, params?: TranslateParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

// English text is the dictionary key, not a generated code -- lets any
// component wrap a literal in t("...") without inventing/looking up a key,
// and a missing Bahasa Malaysia entry harmlessly falls back to English
// instead of showing a broken key.
export function translate(text: string, language: Language, params?: TranslateParams): string {
  const resolved = language === "ms" ? msDictionary[text] ?? text : text;
  return interpolate(resolved, params);
}
