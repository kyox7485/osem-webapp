"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/components/language-provider";
import type { LookupOption } from "@/lib/types";

// Long lists make a plain <select> unusable -- the user has to scroll through
// every entry to find one name. This is a filterable text input with a
// dropdown of matches instead: type two letters, pick from a short list.
//
// Filtering is substring-on-label, case-insensitive. Option ids stay the
// canonical values -- the filter text is never persisted, so a search term
// never reaches the database.
const MAX_VISIBLE = 30;

const INPUT_CLS =
  "w-full rounded-md border border-line-strong bg-input px-3 py-2 text-sm text-fg focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

type Props = {
  /** Selected option id as a string ("" = nothing selected). */
  value: string;
  onChange: (id: string) => void;
  options: LookupOption[];
  /** Accessible name for the input; also used as the visible label. */
  label: string;
  placeholder?: string;
  /** Rendered under the field when the search matches nothing. */
  emptyMessage?: string;
  id?: string;
  className?: string;
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
  const [seenSelectedId, setSeenSelectedId] = useState(selected?.id);
  if (selected?.id !== seenSelectedId) {
    setSeenSelectedId(selected?.id);
    setQuery(selected ? selected.label : "");
  }

  const matches = useMemo(() => {
    if (!hasQuery) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, hasQuery]);

  const visible = matches.slice(0, MAX_VISIBLE);

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

  // Keep the arrowed-to option scrolled into view inside the listbox.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function commit(option: LookupOption) {
    onChange(String(option.id));
    setQuery(option.label);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    setQuery(text);
    setIsOpen(true);
    setActiveIndex(-1);
    // Typing over an existing selection invalidates it -- otherwise the old
    // patient would stay selected while the user searches for a different one.
    if (selected) onChange("");
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
      onChange("");
      setQuery("");
    }
  }

  const showEmpty = isOpen && hasQuery && matches.length === 0;
  const activeId =
    activeIndex >= 0 && visible[activeIndex] ? `${listboxId}-opt-${visible[activeIndex].id}` : undefined;

  return (
    <div data-combobox-root className={className}>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-fg-secondary">
        {label}
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
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder ?? t("Type to search...")}
          autoComplete="off"
          className={INPUT_CLS}
        />

        {isOpen && visible.length > 0 && (
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-elevated py-1 shadow-lg"
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
                className={`cursor-pointer px-3 py-2 text-sm text-fg ${
                  i === activeIndex ? "bg-indigo-50 dark:bg-indigo-950/40" : ""
                }`}
              >
                {o.label}
              </li>
            ))}
          </ul>
        )}

        {showEmpty && <p className="mt-1 text-xs text-fg-faint">{emptyMessage ?? t("No matches found")}</p>}
      </div>
    </div>
  );
}
