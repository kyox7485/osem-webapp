"use client";

export function ThemeClassScript() {
  return (
    <script
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            try {
              const key = "osem_theme";
              const stored = localStorage.getItem(key);
              const theme = (stored === "light" || stored === "dark" || stored === "system") ? stored : "system";
              function resolve(t) {
                if (t === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                return t;
              }
              const resolved = resolve(theme);
              document.documentElement.classList.remove("light", "dark");
              document.documentElement.classList.add(resolved);
            } catch (e) {}
          })();
        `,
      }}
    />
  );
}
