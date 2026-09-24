import { THEME_STORAGE_KEY } from "@/lib/theme";

// Runs synchronously in <head> before first paint (and before React
// hydrates), so a persisted Light/Dark/System choice is applied with no flash
// of the wrong theme. Must stay in sync with applyTheme() in theme-provider.
const script = `(function () {
  var theme = "system";
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (stored === "light" || stored === "dark" || stored === "system") theme = stored;
  } catch (e) {}
  var resolved = theme;
  if (theme === "system") {
    try {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) {
      resolved = "light";
    }
  }
  var root = document.documentElement;
  root.classList.remove(resolved === "dark" ? "light" : "dark");
  root.classList.add(resolved);
})();`;

export function ThemeClassScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
