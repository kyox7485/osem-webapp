"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/**
 * A combobox option. `hint` is shown dimmed beside the label and is
 * searchable; `pinned` keeps the option listed whatever is typed (e.g. a
 * trailing "Others (specify below)").
 */
export type ComboboxOption = LookupOption & { hint?: string; pinned?: boolean };

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
  /**
   * Red asterisk + aria-required, and native form validation: submitting the
   * surrounding <form> with nothing selected is blocked with a browser bubble
   * on this field, like a required <select>.
   */
  required?: boolean;
  /**
   * Red asterisk + aria-required only, no native validation -- for fields the
   * caller already validates (disabled submit, server error codes) and that
   * were never browser-enforced. Don't switch these to `required`: it would
   * add a blocking check the form never had.
   */
  showRequired?: boolean;
  /** Renders a hidden input with this name carrying `value`, for FormData submits. */
  name?: string;
  disabled?: boolean;
  /**
   * Shows an × button that clears the selection -- for filters where ""
   * means "all" (pair it with a placeholder such as "All residents").
   */
  clearable?: boolean;
  /**
   * Reports the raw text in the box, including text that matches no option.
   * For pickers that can also create what the user typed ("add new supplier"),
   * where the option list alone cannot express the new value.
   */
  onQueryChange?: (query: string) => void;
  /**
   * Free-text mode: while no option is selected, the box shows this caller-
   * owned text (keep it in sync from onQueryChange). Lets a picker accept a
   * name that isn't on the list and restore it when the form reopens.
   */
  freeText?: string;
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
  showRequired,
  name,
  disabled,
  clearable,
  onQueryChange,
  freeText,
}: Props) {
  const t = useTranslation();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  const selected = options.find((o) => String(o.id) === value);

  // While an option is selected the input shows that option's label; typing
  // clears the selection first (see handleChange) so the user can search
  // without the old name snapping back on every keystroke.
  const [query, setQuery] = useState(selected ? selected.label : (freeText ?? ""));
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
    if (selected || !typedOver) setQuery(selected ? selected.label : (freeText ?? ""));
    setTypedOver(false);
  }
  // Free-text mode: follow the caller's text (e.g. a form reset clearing it).
  const [seenFreeText, setSeenFreeText] = useState(freeText);
  if (freeText !== seenFreeText) {
    setSeenFreeText(freeText);
    if (!selected && freeText !== undefined) setQuery(freeText);
  }

  // No cap on the list: with an empty box the user must be able to scroll to
  // every option, not just the first few.
  const visible = useMemo(() => {
    if (!hasQuery) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.pinned || o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query, hasQuery]);

  // Close the popup when a pointer press lands outside the whole widget.
  // pointerdown (not click) so a press on an option is handled by the option.
  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      const root = inputRef.current?.closest("[data-combobox-root]");
      // The list is portalled to <body>, so it is outside `root`.
      if (listRef.current?.contains(target)) return;
      if (root && !root.contains(target)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  // The list is portalled to <body> and positioned `fixed` against the
  // field, so no scrolling ancestor, overflow-x-auto table or modal can clip
  // it. It opens below the field, or above when there is more room there,
  // and its height is capped to the space actually visible -- measured
  // against the visual viewport so a phone's on-screen keyboard counts as
  // covered space. Re-placed on every scroll (capture phase: any ancestor),
  // resize and visual-viewport change while open.
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    function place() {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const GAP = 4;
      const MARGIN = 8;
      const IDEAL = 288;
      const viewTop = vv ? vv.offsetTop : 0;
      const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const viewLeft = vv ? vv.offsetLeft : 0;
      const viewWidth = vv ? vv.width : window.innerWidth;
      const below = viewBottom - r.bottom - GAP - MARGIN;
      const above = r.top - viewTop - GAP - MARGIN;
      const openUp = below < Math.min(IDEAL, 160) && above > below;
      const maxHeight = Math.max(96, Math.min(IDEAL, openUp ? above : below));
      const width = Math.min(Math.max(r.width, 224), viewWidth - MARGIN * 2);
      const left = Math.min(Math.max(r.left, viewLeft + MARGIN), viewLeft + viewWidth - MARGIN - width);
      setPopupStyle({
        position: "fixed",
        left,
        width,
        maxHeight,
        // Upward: anchor the list's bottom edge to the field so a short list
        // sits right above it instead of floating at the top of the space.
        ...(openUp
          ? { bottom: document.documentElement.clientHeight - r.top + GAP }
          : { top: r.bottom + GAP }),
      });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
    };
  }, [isOpen]);

  // Native validation for `required`: the visible input holds search text, not
  // the value, so its own `required` would pass on a half-typed name.
  const invalidMessage = t("Please select an option from the list.");
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !value ? invalidMessage : "");
  }, [required, value, invalidMessage]);

  // Picking an option changes no text the user typed, so React fires no
  // onChange and an ancestor's onChangeCapture (the app-wide dirty guard,
  // inventory's state.touch) would never hear about it -- a plain <select>
  // fired one. Emit a real input event so every such form keeps working
  // unchanged. Setting the value through the prototype setter bypasses
  // React's value tracker, so React treats it as a user edit; our own
  // handleChange ignores it via `emittingRef`.
  const emittingRef = useRef(false);
  function emitChange(text: string) {
    const el = inputRef.current;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return;
    emittingRef.current = true;
    try {
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } finally {
      emittingRef.current = false;
    }
  }

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
    emitChange(option.label);
  }

  function clear() {
    onChange("", "clear");
    setQuery("");
    onQueryChange?.("");
    setActiveIndex(-1);
    emitChange("");
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (emittingRef.current) return;
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
        {(required || showRequired) && <span className="text-red-500"> *</span>}
      </label>
      <div className="relative">
        {name && <input type="hidden" name={name} value={value} />}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-required={required || showRequired || undefined}
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

        {isOpen && visible.length > 0 && popupStyle && createPortal(
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={label}
            style={popupStyle}
            className="z-[100] overflow-auto overscroll-contain rounded-md border border-line bg-elevated py-1 shadow-lg"
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
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm text-fg max-md:min-h-11 ${
                  i === activeIndex ? "bg-indigo-50 dark:bg-indigo-950/40" : ""
                } ${String(o.id) === value ? "font-medium" : ""}`}
              >
                <span>{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-fg-faint">{o.hint}</span>}
              </li>
            ))}
          </ul>,
          document.body
        )}

        {showEmpty && <p className="mt-1 text-xs text-fg-faint">{emptyMessage ?? t("No matches found")}</p>}
      </div>
    </div>
  );
}
