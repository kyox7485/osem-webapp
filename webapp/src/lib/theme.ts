// Pure theme constants shared by ThemeProvider (client) and ThemeClassScript
// (server-rendered inline script). No server-only imports -- safe anywhere.

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "osem_theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}
