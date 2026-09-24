"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme, type Theme } from "@/components/theme-provider";
import { useTranslation } from "@/components/language-provider";

const OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

// Header theme control: a sun (light) / moon (dark) icon button that opens a
// Light / Dark / System menu. The icon reflects what is on screen and is
// swapped purely in CSS off the <html> .dark class, so it is correct on first
// paint (React only knows the stored preference after hydration).
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2];
  const label = t("Theme: {mode}", { mode: t(current.label) });

  useEffect(() => {
    if (!open) return;
    // Focus the selected option when the menu opens.
    itemRefs.current[OPTIONS.findIndex((o) => o.value === theme)]?.focus();
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // Only re-run when the menu opens/closes, not when the choice changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = (i + (e.key === "ArrowDown" ? 1 : -1) + OPTIONS.length) % OPTIONS.length;
    itemRefs.current[next]?.focus();
  }

  function choose(value: Theme) {
    setTheme(value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // 36px visual circle; the ::after pseudo-element widens the hit area
        // to 44px for touch (iPad) without enlarging the header row.
        className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-surface-muted text-fg-muted transition-colors duration-150 after:absolute after:-inset-1 after:content-[''] hover:bg-surface-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      >
        <Sun className="h-4 w-4 dark:hidden" strokeWidth={2} aria-hidden="true" />
        <Moon className="hidden h-4 w-4 dark:block" strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("Theme")}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-20 mt-2 w-40 rounded-lg border border-line bg-elevated p-1 shadow-lg"
        >
          {OPTIONS.map(({ value, label: optionLabel, icon: Icon }, i) => {
            const selected = theme === value;
            return (
              <button
                key={value}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => choose(value)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors duration-150 focus:outline-none focus-visible:bg-hover ${
                  selected ? "bg-selected font-medium text-selected-fg" : "text-fg-secondary hover:bg-hover hover:text-fg"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 text-left">{t(optionLabel)}</span>
                {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
