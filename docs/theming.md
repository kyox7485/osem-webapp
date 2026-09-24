# Theming — Light / Dark / System

**Rule:** All new UI must support Light and Dark themes. Prefer semantic
theme tokens for shared surfaces/text/borders instead of hard-coded
light-only colours. New modules must be tested in Light, Dark and System
modes.

## How it works

| Piece | File | Job |
|---|---|---|
| Dark variant | `webapp/src/app/globals.css` | `@custom-variant dark (&:where(.dark, .dark *));` — `dark:` utilities follow the `.dark` class on `<html>`, **not** the OS media query. Without it an explicit Light choice can't beat a dark OS. |
| Tokens | `webapp/src/app/globals.css` | CSS variables on `:root` (light) and `.dark`, exposed as Tailwind colours via `@theme inline`. Also sets `color-scheme` so native controls (date/time pickers, `<select>` popups, scrollbars, checkboxes) match. |
| Pre-paint script | `webapp/src/components/theme-script.tsx` | Inline `<head>` script: reads `localStorage["osem_theme"]`, puts `.light`/`.dark` on `<html>` before first paint (no flash). `<html>` has `suppressHydrationWarning` because of this. |
| Provider | `webapp/src/components/theme-provider.tsx` | `useTheme()` → `{ theme, resolved, setTheme }`. Preference is read via `useSyncExternalStore`; the `<html>` class is applied imperatively on choice / OS change / other-tab change — never from a render/effect, so hydration can't flip the theme. |
| Toggle | `webapp/src/components/theme-toggle.tsx` | Header sun/moon button (left of the language switcher) opening a Light / Dark / System menu. |

Preference is per-browser (`localStorage`), not per-account — deliberate,
since a shared ward iPad and a personal laptop can reasonably differ. `system`
is the default and follows OS changes live.

## Token cheat-sheet

Light values are exactly the Tailwind grays the app used before tokens, so
converting a class never changes Light mode.

| Use for | Token utility | Replaces (light) |
|---|---|---|
| Page background | `bg-app` | `bg-gray-50` (page shell) |
| Card / panel / table body / secondary button | `bg-surface` | `bg-white` |
| Table header, subtle inset panel | `bg-surface-muted` | `bg-gray-50` |
| Neutral chip/badge, tab track, disabled field | `bg-surface-strong` | `bg-gray-100` |
| Modal, popover, dropdown menu, tooltip | `bg-elevated` | `bg-white` + shadow |
| Form control fill | `bg-input` | `bg-white` on inputs |
| Row / list-item hover | `hover:bg-hover` | `hover:bg-gray-50` |
| Selected / active item | `bg-selected text-selected-fg` | `bg-indigo-50 text-indigo-700` |
| Skeleton block, progress track | `bg-line` | `bg-gray-200` |
| Primary text, headings, cell values | `text-fg` | `text-gray-900/800` |
| Body text, form labels | `text-fg-secondary` | `text-gray-700` |
| Secondary / meta text | `text-fg-muted` | `text-gray-600` |
| Captions, helper text, table header text | `text-fg-subtle` | `text-gray-500` |
| Placeholders, icons, empty-state text | `text-fg-faint` | `text-gray-400` |
| Row dividers | `divide-line-subtle` / `border-line-subtle` | `*-gray-100` |
| Card / section border | `border-line` | `border-gray-200` |
| Input border, emphasized border | `border-line-strong` | `border-gray-300` |

Tables: `bg-surface` body, `bg-surface-muted` + `text-fg-subtle` header,
`divide-y divide-line-subtle` rows, `hover:bg-hover` row hover.

Inline styles / SVG: use the raw variables (`var(--line)`, `var(--fg-muted)`,
…) or a Tailwind class (`className="stroke-line-subtle"`), never a neutral hex.

## Coloured (status / clinical) colours

Hues carry meaning, so they stay Tailwind colours with an explicit `dark:`
partner, using one convention app-wide:

| Light | Dark partner |
|---|---|
| `bg-X-50` / `bg-X-100` (tinted chip, alert, flagged row) | `dark:bg-X-950/40` |
| `text-X-600` | `dark:text-X-400` |
| `text-X-700` / `text-X-800` | `dark:text-X-300` |
| `border-X-200` | `dark:border-X-900` |
| `hover:bg-X-50` | `dark:hover:bg-X-950/40` |

Solid fills (`bg-X-600 text-white` buttons, badges with counts) need no
partner. Overlays drawn **on top of the white body-chart images** (wound /
physio body diagrams) intentionally keep light styling in both themes.

## Don'ts

- Don't add `dark:bg-gray-*`/`dark:text-gray-*` pairs — use a token.
- Don't use `bg-black`/near-black for dark surfaces; tokens already define
  the dark hierarchy (app < surface < elevated).
- Don't key theme logic off `prefers-color-scheme` in components — use
  `dark:` or `useTheme().resolved`.
- Logos/artwork with black ink need a dark variant (`public/logo-dark.png`,
  swapped with `dark:hidden` / `hidden dark:block`).

## Testing a new module

Check it in **Light, Dark and System** (flip the OS setting while on
System): surfaces/text/borders readable, tables have visible dividers and
hover, modals/menus use `bg-elevated`, native inputs (date, time, select
popup) readable, status badges distinguishable.
