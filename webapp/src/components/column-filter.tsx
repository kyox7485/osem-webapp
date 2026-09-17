"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useFilterNavigation } from "@/components/filter-pending";
import { useTranslation } from "@/components/language-provider";

type Option = { value: string; label: string };

type TextFilterProps = {
  type: "text";
  label: string;
  paramName: string;
  placeholder?: string;
};

type SelectFilterProps = {
  type: "select";
  label: string;
  paramName: string;
  options: Option[];
  // Which options are selected when the URL has no param for this column at
  // all -- e.g. Status defaults to ["ACTIVE"], Branch/Position default to
  // "everything" (all option values).
  defaultValues: string[];
};

type Props = TextFilterProps | SelectFilterProps;

// Excel-style column header filter: a small chevron that opens a popover --
// a text box for free-text columns, a checkbox list for enum columns.
// Reads/writes the filter as a URL search param so results stay a
// shareable link and the actual filtering logic lives in the server
// component that owns the query. The popover renders through a portal into
// document.body (positioned from the trigger's bounding rect) rather than
// as a normal absolutely-positioned child, because table wrappers commonly
// use overflow-hidden for rounded corners, which would otherwise clip it.
export function ColumnFilter(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const startNavigation = useFilterNavigation();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const rawValue = searchParams.get(props.paramName); // null = param absent

  const effectiveSelected =
    props.type === "select" ? (rawValue !== null ? rawValue.split(",").filter(Boolean) : props.defaultValues) : [];

  const isActive =
    props.type === "text" ? !!rawValue : effectiveSelected.length !== props.options.length;

  const [textDraft, setTextDraft] = useState(rawValue ?? "");
  const [selectedDraft, setSelectedDraft] = useState<string[]>(effectiveSelected);

  const POPOVER_WIDTH = 224; // w-56

  function openPopover() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Anchor from the left, but flip to right-aligned when that would
      // overflow the viewport (common for the last column in a table).
      const overflowsRight = rect.left + POPOVER_WIDTH > window.innerWidth - 8;
      const left = overflowsRight ? Math.max(8, rect.right - POPOVER_WIDTH) : rect.left;
      setCoords({ top: rect.bottom + 4, left });
    }
    setTextDraft(rawValue ?? "");
    setSelectedDraft(effectiveSelected);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function pushParams(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    mutate(next);
    startNavigation(() => router.push(`${pathname}?${next.toString()}`));
    setOpen(false);
  }

  function handleApply() {
    if (props.type === "text") {
      pushParams((next) => {
        const trimmed = textDraft.trim();
        if (trimmed) next.set(props.paramName, trimmed);
        else next.delete(props.paramName);
      });
    } else {
      pushParams((next) => {
        const sortedSelected = [...selectedDraft].sort().join(",");
        const sortedDefault = [...props.defaultValues].sort().join(",");
        if (sortedSelected === sortedDefault) {
          next.delete(props.paramName);
        } else {
          // still set the param even when empty, so an intentional "select
          // nothing" reads back as an explicit empty set, not "use default"
          next.set(props.paramName, selectedDraft.join(","));
        }
      });
    }
  }

  function handleClear() {
    pushParams((next) => next.delete(props.paramName));
  }

  function toggleOption(value: string) {
    setSelectedDraft((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div className="inline-flex items-center gap-1">
      <span>{props.label}</span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${t("Filter")} ${props.label}`}
        className={`rounded p-0.5 transition-colors hover:bg-gray-200 ${isActive ? "text-indigo-600" : "text-gray-400"}`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 3h8M3.5 6h5M5 9h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      {mounted && open &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-50 w-56 rounded-md border border-gray-200 bg-white p-3 text-left font-normal normal-case tracking-normal text-gray-900 shadow-lg"
          >
            {props.type === "text" ? (
              <input
                autoFocus
                type="text"
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleApply()}
                placeholder={props.placeholder}
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {props.options.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedDraft.includes(o.value)}
                      onChange={() => toggleOption(o.value)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/40"
                    />
                    <span className="break-words">{o.label}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-3 flex justify-between gap-2">
              <button
                type="button"
                onClick={handleClear}
                className="text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                {t("Clear")}
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
              >
                {t("Apply")}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
