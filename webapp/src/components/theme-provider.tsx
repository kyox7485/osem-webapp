"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, isTheme, type ResolvedTheme, type Theme } from "@/lib/theme";

export type { Theme, ResolvedTheme };

// The user's preference lives in localStorage (THEME_STORAGE_KEY); the
// resolved theme is expressed as exactly one of .light/.dark on <html>.
//
// Ownership of that class:
//  - ThemeClassScript sets it before first paint (no flash on load).
//  - applyTheme() below updates it on an explicit choice, an OS change while
//    on "system", or a change made in another tab.
// React state is only used to render the toggle -- it is deliberately NOT
// what applies the class, because during hydration React renders with the
// server snapshot ("system"), and syncing the DOM from that would briefly
// flip the page to the wrong theme.

// In-memory fallback so the toggle still works when storage is unavailable
// (private browsing / blocked site data) -- the choice just won't persist.
let memoryTheme: Theme = "system";
const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage blocked -- fall through to the in-memory value.
  }
  return memoryTheme;
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? systemTheme() : theme;
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove(resolved === "dark" ? "light" : "dark");
  root.classList.add(resolved);
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribeTheme(onChange: () => void) {
  listeners.add(onChange);
  // Keep other open tabs in sync with a choice made here.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    applyTheme(resolve(readTheme()));
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeSystem(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  // Follow the OS live while the preference is "system".
  const onMediaChange = () => {
    if (readTheme() === "system") applyTheme(systemTheme());
    onChange();
  };
  media.addEventListener("change", onMediaChange);
  return () => media.removeEventListener("change", onMediaChange);
}

type ThemeContextValue = {
  /** The user's preference: "light" | "dark" | "system". */
  theme: Theme;
  /** What is actually on screen right now. */
  resolved: ResolvedTheme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as Theme);
  const system = useSyncExternalStore(subscribeSystem, systemTheme, () => "light" as ResolvedTheme);
  const resolved: ResolvedTheme = theme === "system" ? system : theme;

  const setTheme = useCallback((next: Theme) => {
    memoryTheme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked -- the in-memory value still drives this session.
    }
    applyTheme(resolve(next));
    emit();
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
