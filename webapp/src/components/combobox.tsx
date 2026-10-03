"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import type { LookupOption } from "@/lib/types";

// Long lists make a plain <select> unusable -- the user has to scroll through
// every entry to find one name. This is a filterable text input with a
// dropdown of matches instead: either scroll the full list, or type a few
// letters to narrow it down.
//
// Filtering is substring-on-label (and on the optional hint, e.g. a resident
// ID), case-insensitive. Option ids stay the canonical values -- the filter
// text is never persisted, so a search term never reaches the database.

const INPUT_CLS =
  "w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export type ComboboxChangeReason = "select" | "clear" | "type";

/** A combobox option; `hint` is shown dimmed beside the label and is searchable. */
export type ComboboxOption = LookupOption & { hint?: string };

type Props = {
  /** Selected option id as a string ("" = nothing selected). */
  value: string;
  /**
   * `reason` says why: "select" (an option was picked), "clear" (the ×
   * button), or "type" (typing/backspacing over the selected label, which
   * deselects it while the user searches). URL-driven filters usually ignore
   * "type" so a search doesn't navigate away mid-keystroke.
   */
  onChange: (id: string, reason: ComboboxChangeReason) => void;
  options: ComboboxOption[];
  /** Accessible name for the input; also used as the visible label. */
  label: string;
  placeholder?: string;
  /** Rendered under the field when the search matches nothing. */
  emptyMessage?: string;
  id?: string;
  className?: string;
  /** Replaces the default input classes, e.g. for compact table-row pickers. */
  inputClassName?: string;
  /**
   * Keep `label` as the input's accessible name but render no visible label
   * text -- for layouts that already say what the field is (a card heading,
   * a placeholder, a toolbar row) and would grow an extra line otherwise.
   */
  hideLabel?: boolean;
  /** Marks the field required (red asterisk + aria-required). Validation stays with the caller. */
  required?: boolean;
  disabled?: boolean;
  /**
   * Shows an × button that clears the selection -- for filters where ""
   * means "all" (pair it with a placeholder such as "All residents").
   */
  clearable?: boolean;
  /**
   * Position the dropdown with `position: fixed` so it escapes a scrolling
   * ancestor (e.g. a table inside `overflow-x-auto`) that would otherwise clip
   * it. Opens upward when there is more room above the field.
   */
  fixedPopup?: boolean;
  /**
   * Reports the raw text in the box, including text that matches no option.
   * For pickers that can also create what the user typed ("add new supplier"),
   * where the option list alone cannot express the new value.
   */
  onQueryChange?: (query: string) => void;
};

/**
 * Accessible single-select combobox.
 *
 * Follows the WAI-ARIA combobox pattern: the input owns
 * `role="combobox"` with `aria-expanded`/`aria-controls`/`aria-activedescendant`,
 * and the popup is a `role="listbox"` of `role="option"` children. The active
 * option is tracked with `activeDescendant` and scrolled into view rather than
 * moving real DOM focus, so typing keeps working while arrowing through.
 */
export function Combobox({
  value,
  onChange,
  options,
  label,
  placeholder,
  emptyMessage,
  id,
  className,
  inputClassName,
  hideLabel,
  required,
  disabled,
  clearable,
  fixedPopup,
  onQueryChange,
}: Props) {
  const t = useTranslation();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  const selected = options.find((o) => String(o.id) === value);

  // While an option is selected the input shows that option's label; typing
  // clears the selection first (see handleChange) so the user can search
  // without the old name snapping back on every keystroke.
  const [query, setQuery] = useState(selected ? selected.label : "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // True once the user has typed something that isn't the selected label, so
  // we can tell "no selection yet" apart from "typed a query that matched
  // nothing" and decide whether to show the empty message.
  const hasQuery = query !== "" && query !== selected?.label;

  // Mirror an external change to `value` (a completed switch remounts this
  // picker, but a parent reset or back-navigation can also move it under us).
  // Adjusting during render rather than in an effect: React re-runs this
  // component immediately without committing the stale query to the DOM, so
  // the input never flickers the old label. This is the documented
  // "adjusting state when a prop changes" pattern.
  // `typedOver` marks a deselection the user caused by typing over the
  // selected label: that one must keep the text they just typed.
  const [seenSelectedId, setSeenSelectedId] = useState(selected?.id);
  const [typedOver, setTypedOver] = useState(false);
  if (selected?.id !== seenSelectedId) {
    setSeenSelectedId(selected?.id);
    if (selected || !typedOver) setQuery(selected ? selected.label : "");
    setTypedOver(false);
  }

  // No cap on the list: with an empty box the user must be able to scroll to
  // every option, not just the first few.
  const visible = useMemo(() => {
    if (!hasQuery) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query, hasQuery]);

  // Close the popup when a pointer press lands outside the whole widget.
  // pointerdown (not click) so a press on an option is handled by the option.
  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(e: PointerEvent) {
      const root = inputRef.current?.closest("[data-combobox-root]");
      if (root && !root.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  // fixedPopup: track the input's viewport position while open, including
  // while any ancestor scrolls (capture phase catches every scroll event).
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!fixedPopup || !isOpen) return;
    function place() {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const openUp = below < 240 && r.top > below;
      setPopupStyle({
        position: "fixed",
        left: r.left,
        width: r.width,
        ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [fixedPopup, isOpen]);

  // Keep the arrowed-to option scrolled into view inside the listbox.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function commit(option: ComboboxOption) {
    onChange(String(option.id), "select");
    setQuery(option.label);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function clear() {
    onChange("", "clear");
    setQuery("");
    onQueryChange?.("");
    setActiveIndex(-1);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    setQuery(text);
    setIsOpen(true);
    setActiveIndex(-1);
    onQueryChange?.(text);
    // Typing over an existing selection invalidates it -- otherwise the old
    // patient would stay selected while the user searches for a different one.
    if (selected) {
      setTypedOver(true);
      onChange("", "type");
    }
  }

  // Leaving the field without picking drops the half-typed search, so the box
  // never shows a name that isn't actually selected. Pickers that use the raw
  // text themselves (onQueryChange) keep it.
  function handleBlur() {
    setTypedOver(false);
    setIsOpen(false);
    setActiveIndex(-1);
    if (!onQueryChange) setQuery(selected ? selected.label : "");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (visible.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      // Wrap around so arrowing past either end lands on the other end.
      setActiveIndex((i) => (i + delta + visible.length) % visible.length);
      return;
    }

    if (e.key === "Enter") {
      // Only intercept Enter when it would pick something; otherwise the key
      // falls through so a surrounding form can still submit.
      if (isOpen && activeIndex >= 0 && visible[activeIndex]) {
        e.preventDefault();
        commit(visible[activeIndex]);
      }
      return;
    }

    if (e.key === "Escape") {
      if (isOpen) {
        e.stopPropagation();
        setIsOpen(false);
        setActiveIndex(-1);
      }
      return;
    }

    if (e.key === "Backspace" && selected) {
      onChange("", "type");
      setQuery("");
    }
  }

  const showEmpty = isOpen && hasQuery && visible.length === 0;
  const showClear = clearable && !disabled && (selected || query !== "");
  const activeId =
    activeIndex >= 0 && visible[activeIndex] ? `${listboxId}-opt-${visible[activeIndex].id}` : undefined;

  return (
    <div data-combobox-root className={className}>
      <label
        htmlFor={inputId}
        className={`mb-1 block text-sm font-medium text-fg-secondary ${hideLabel ? "sr-only" : ""}`}
      >
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-required={required || undefined}
          value={query}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          onBlur={handleBlur}
          placeholder={placeholder ?? t("Type to search...")}
          autoComplete="off"
          className={`${inputClassName ?? INPUT_CLS} disabled:cursor-not-allowed disabled:bg-surface-strong ${
            clearable ? "pr-8" : ""
          }`}
        />

        {showClear && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("Clear selection")}
            // Same mousedown trick as the options: keep focus off the button
            // so the input's blur doesn't fire mid-clear.
            onMouseDown={(e) => {
              e.preventDefault();
              clear();
            }}
            className="absolute inset-y-0 right-0 flex items-center px-2.5 text-fg-faint hover:text-fg-muted"
          >
            ×
          </button>
        )}

        {isOpen && visible.length > 0 && (
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={label}
            style={fixedPopup ? (popupStyle ?? undefined) : undefined}
            className={`${
              fixedPopup ? "z-50" : "absolute z-30 mt-1 w-full"
            } max-h-60 min-w-[14rem] overflow-auto rounded-md border border-line bg-elevated py-1 shadow-lg`}
          >
            {visible.map((o, i) => (
              <li
                key={o.id}
                id={`${listboxId}-opt-${o.id}`}
                role="option"
                aria-selected={String(o.id) === value}
                // onMouseDown, not onClick: blur fires on mouse-up and would
                // close the popup before the click landed. Preventing the
                // default on mousedown keeps focus (and so the open state).
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(o);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm text-fg ${
                  i === activeIndex ? "bg-indigo-50 dark:bg-indigo-950/40" : ""
                } ${String(o.id) === value ? "font-medium" : ""}`}
              >
                <span>{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-fg-faint">{o.hint}</span>}
              </li>
            ))}
          </ul>
        )}

        {showEmpty && <p className="mt-1 text-xs text-fg-faint">{emptyMessage ?? t("No matches found")}</p>}
      </div>
    </div>
  );
}
