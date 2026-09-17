import { msDictionary } from "./translations";

export type Language = "en" | "ms";

// Not httpOnly -- the client-side switcher writes it directly via
// document.cookie so both server and client renders agree on language
// without a round trip.
export const LANGUAGE_COOKIE = "osem_lang";

// English text is the dictionary key, not a generated code -- lets any
// component wrap a literal in t("...") without inventing/looking up a key,
// and a missing Bahasa Malaysia entry harmlessly falls back to English
// instead of showing a broken key.
export function translate(text: string, language: Language): string {
  if (language !== "ms") return text;
  return msDictionary[text] ?? text;
}
