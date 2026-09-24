"use client";

// Compact inline sparkline + a roomier chart for the history modal, sharing
// one geometry core so a point sits in the same place in both.
//
// Drawn in real pixel space (measured via ResizeObserver) rather than a
// stretched viewBox: a `<circle>` inside a `preserveAspectRatio="none"`
// viewBox renders as an ellipse, and faking the radius back with `rx` is
// guesswork that breaks the moment the card resizes. Measuring means the
// markers stay round, the stroke widths stay true, and the hit targets can
// be derived from the same coordinates the dots are drawn at.
//
// Interaction is deliberately NOT hover-only. Desktop gets hover, but every
// point is a real <button> sized to the full height of the hit strip:
// focusable, keyboard-activatable, and comfortably past the 44px touch
// target on an iPhone / iPad Mini / iPad Pro. The selected point's detail
// renders in normal flow beneath the chart rather than in a floating
// tooltip, so it can never be clipped by the modal.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/components/language-provider";

export type VitalKind = "BP" | "HR" | "Temp" | "SpO2" | "DXT";

export type ChartPoint = {
  id: string;
  /** Date (daily average) or date + time (DXT) -- already formatted for display. */
  label: string;
  primary: number | null;
  /** Diastolic, BP only. */
  secondary?: number | null;
  /** A daily average vs an actual reading -- drives the tooltip wording. */
  isDailyAverage: boolean;
  remark?: string | null;
};

/**
 * Hover is a temporary preview; a tap/click is a commitment. Keeping the two
 * in separate pieces of state is what lets a desktop user sweep the trend and
 * still find the latest reading underneath on mouse-out, while a touch user
 * keeps the point they chose.
 */
export type VitalPointSelection = {
  /** The point under the pointer, or null when the pointer is elsewhere. */
  hoveredId: string | null;
  /** The point the user committed to by tapping, clicking or tabbing to. */
  selectedId: string | null;
};

/**
 * The point whose value should be shown: the explicit choice if there is
 * one, otherwise the newest reading. This is the fallback for both modes --
 * with no interaction the card shows the latest data, exactly as before.
 */
export function resolveActivePointId(
  points: ChartPoint[],
  selection: VitalPointSelection
): string | null {
  const ids = new Set(points.map((p) => p.id));
  if (selection.hoveredId && ids.has(selection.hoveredId)) return selection.hoveredId;
  if (selection.selectedId && ids.has(selection.selectedId)) return selection.selectedId;
  return points[points.length - 1]?.id ?? null;
}

export const VITAL_UNITS: Record<VitalKind, string> = {
  BP: "mmHg",
  HR: "bpm",
  Temp: "°C",
  SpO2: "%",
  DXT: "mmol/L",
};

export function formatVitalValue(kind: VitalKind, point: ChartPoint): string {
  if (kind === "BP") {
    if (point.primary === null) return "--";
    return `${point.primary}/${point.secondary ?? "--"}`;
  }
  return point.primary === null ? "--" : String(point.primary);
}

// Smallest comfortable touch strip. Anything below this is a mis-tap magnet
// on a phone held in one hand.
const MIN_HIT_PX = 44;

type Props = {
  kind: VitalKind;
  points: ChartPoint[];
  /** True on the main page's 5-card row; false for the history modal. */
  compact?: boolean;
  title?: string;
  emptyText?: string;
  /**
   * Lifts selection out of the chart so a parent can render the active
   * point's value alongside it. Omit it and the chart keeps its own state
   * and behaves exactly as before -- which is how the history modal uses it.
   */
  selection?: VitalPointSelection;
  onSelectionChange?: (next: VitalPointSelection) => void;
};

type Size = { width: number; height: number };

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

export function InteractiveVitalChart({
  kind,
  points,
  compact = false,
  title,
  emptyText,
  selection,
  onSelectionChange,
}: Props) {
  const t = useTranslation();
  const controlled = selection !== undefined && onSelectionChange !== undefined;
  // Only used when the parent isn't driving selection (the history modal).
  const [local, setLocal] = useState<VitalPointSelection>({ hoveredId: null, selectedId: null });
  const active = controlled ? selection : local;
  const setActive = useCallback(
    (next: VitalPointSelection) => (controlled ? onSelectionChange(next) : setLocal(next)),
    [controlled, onSelectionChange]
  );
  const [wrapRef, size] = useElementWidth<HTMLDivElement>();

  const selected = useMemo(
    () => points.find((p) => p.id === resolveActivePointId(points, active)) ?? points[points.length - 1] ?? null,
    [points, active]
  );

  // Value bounds across every plotted number, systolic through diastolic.
  const bounds = useMemo(() => {
    const values: number[] = [];
    for (const p of points) {
      if (p.primary !== null) values.push(p.primary);
      if (typeof p.secondary === "number") values.push(p.secondary);
    }
    if (values.length === 0) return { min: 0, max: 1 };
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      // A flat line is real data, not an error -- pad it so it draws through
      // the middle of the plot instead of hugging an edge.
      const pad = Math.max(Math.abs(min) * 0.05, 1);
      min -= pad;
      max += pad;
    }
    return { min, max };
  }, [points]);

  if (points.length === 0 || !selected) {
    if (compact) {
      return (
        <div className="flex min-h-24 flex-col justify-between rounded-lg border border-dashed border-line p-3">
          <span className="text-xs font-semibold tracking-wide text-fg-subtle">{title ?? kind}</span>
          <span className="text-lg font-semibold text-fg-faint">--</span>
          <span className="text-[11px] text-fg-faint">{emptyText ?? t("No readings in this period")}</span>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center">
        <p className="text-sm text-fg-faint">{emptyText ?? t("No readings in this period")}</p>
      </div>
    );
  }

  const width = size.width;
  const height = size.height;
  const ready = width > 0 && height > 0;

  // Padding leaves room for the marker radius at the extremes so the top and
  // bottom dots aren't half-clipped.
  const padX = 6;
  const padY = 8;
  const x = (i: number) => (points.length === 1 ? width / 2 : padX + (i / (points.length - 1)) * (width - padX * 2));
  const y = (v: number) => height - padY - ((v - bounds.min) / (bounds.max - bounds.min)) * (height - padY * 2);

  // Each point owns a slice of the strip centred on its x, clamped to the
  // edges, so the first and last points get full targets too.
  const hitWidth = points.length > 1 ? (width - padX * 2) / (points.length - 1) : width;

  const isSelected = (p: ChartPoint) => p.id === selected.id;
  const newestId = points[points.length - 1].id;

  // Positioned once, in index order, so the paths, the markers and the hit
  // strip all read from the same coordinates and can't drift apart.
  const plot = points.map((p, i) => ({
    point: p,
    x: x(i),
    y: p.primary === null ? null : y(p.primary),
    yDiastolic: kind === "BP" && typeof p.secondary === "number" ? y(p.secondary) : null,
  }));

  const pathFrom = (ys: Array<number | null>) => {
    let d = "";
    let started = false;
    for (const [i, py] of ys.entries()) {
      if (py === null) continue;
      d += `${started ? "L" : "M"}${plot[i].x},${py}`;
      started = true;
    }
    return d;
  };

  const primaryPath = pathFrom(plot.map((p) => p.y));
  const secondaryPath = kind === "BP" ? pathFrom(plot.map((p) => p.yDiastolic)) : "";

  // Where the selected point sits, for the vertical guide. -1 when the
  // selection went stale because the data changed under it.
  const selectedIndex = plot.findIndex((p) => p.point.id === selected.id);

  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div ref={wrapRef} className={compact ? "h-10 w-full" : "h-44 w-full sm:h-52"}>
        {ready && (
          <svg width={width} height={height} role="img" aria-label={title ?? kind} className="block">
            {/* Faint guides give the eye something to read slope against
                without adding axis furniture to a compact card. */}
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1={0}
                x2={width}
                y1={height * f}
                y2={height * f}
                className="stroke-line-subtle"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            ))}

            {!compact && selectedIndex >= 0 && plot[selectedIndex].y !== null && (
              <line
                x1={plot[selectedIndex].x}
                x2={plot[selectedIndex].x}
                y1={0}
                y2={height}
                className="stroke-indigo-400/50 dark:stroke-indigo-300/40"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {secondaryPath && (
              <path
                d={secondaryPath}
                fill="none"
                className="text-teal-500 dark:text-teal-400"
                stroke="currentColor"
                strokeWidth={compact ? 1.25 : 1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            <path
              d={primaryPath}
              fill="none"
              className="text-indigo-500 dark:text-indigo-400"
              stroke="currentColor"
              strokeWidth={compact ? 1.25 : 1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {plot.map(({ point: p, x: px, y: py, yDiastolic }) => {
              if (py === null) return null;
              const active = isSelected(p);
              return (
                <g key={p.id}>
                  {yDiastolic !== null && (
                    <circle
                      cx={px}
                      cy={yDiastolic}
                      r={active ? 3.5 : 2.25}
                      className={
                        active
                          ? "fill-teal-500 stroke-surface dark:fill-teal-300 dark:stroke-elevated"
                          : "fill-teal-400/80 dark:fill-teal-300/80"
                      }
                      strokeWidth={active ? 1.5 : 0}
                    />
                  )}
                  <circle
                    cx={px}
                    cy={py}
                    r={active ? 3.5 : 2.25}
                    className={
                      active
                        ? "fill-indigo-500 stroke-surface dark:fill-indigo-300 dark:stroke-elevated"
                        : p.id === newestId
                          ? "fill-indigo-400 dark:fill-indigo-300"
                          : "fill-indigo-400/70 dark:fill-indigo-300/70"
                    }
                    strokeWidth={active ? 1.5 : 0}
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* One real button per point, sitting directly under its marker. The
          strip is full-width and the buttons divide it evenly, so the tap
          target is always at least MIN_HIT_PX tall no matter how dense the
          data is.

          The strip is the chart's pointer surface, so pointer-out has to
          clear the hover -- leaving a stale point pinned would keep showing
          its value once the mouse moved onto the card's own text. A tap
          (pointer: coarse) has no hover to speak of, so it only commits. */}
      <div
        className="flex"
        style={{ minHeight: compact ? 16 : MIN_HIT_PX }}
        role={compact ? undefined : "group"}
        onPointerLeave={() => setActive({ ...active, hoveredId: null })}
        onPointerCancel={() => setActive({ ...active, hoveredId: null })}
      >
        {points.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive({ ...active, selectedId: p.id })}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") setActive({ ...active, hoveredId: p.id });
            }}
            onFocus={() => setActive({ ...active, selectedId: p.id })}
            aria-pressed={compact ? undefined : isSelected(p)}
            style={{ width: hitWidth, maxWidth: width }}
            className={`min-w-0 shrink rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              compact ? "h-4" : "h-11"
            } ${isSelected(p) ? "bg-indigo-500/10" : "hover:bg-hover"}`}
          >
            <span className="sr-only">
              {p.label} — {formatVitalValue(kind, p)} {VITAL_UNITS[kind]}
              {p.remark ? ` — ${p.remark}` : ""}
            </span>
          </button>
        ))}
      </div>

      {/* Detail panel, in normal flow rather than a floating tooltip: it
          can't be clipped by the modal, and a touch user sees exactly what
          a hover user sees. */}
      <figcaption>
        {compact ? (
          <>
            <div className="truncate text-[11px] font-medium text-fg-subtle">{selected.label}</div>
            {selected.remark ? (
              <div className="truncate text-[11px] italic text-fg-muted">{selected.remark}</div>
            ) : (
              <div className="truncate text-[11px] text-fg-faint">
                {selected.isDailyAverage ? t("Daily average") : t("Actual reading")}
              </div>
            )}
          </>
        ) : (
          <div
            className={`rounded-lg border p-3 transition-colors ${
              selected.isDailyAverage
                ? "border-line bg-surface-muted"
                : "border-indigo-200 bg-indigo-50/60 dark:border-indigo-900 dark:bg-indigo-950/30"
            }`}
          >
            <div className="text-xs font-medium text-fg-subtle">{selected.label}</div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-semibold text-fg">{title ?? kind}</span>
              {selected.primary !== null && (
                <>
                  <span className="text-lg font-bold tabular-nums text-fg">
                    {formatVitalValue(kind, selected)}
                  </span>
                  <span className="text-xs text-fg-muted">{VITAL_UNITS[kind]}</span>
                </>
              )}
            </div>
            <div className="mt-0.5 text-xs text-fg-muted">
              {selected.remark ? (
                <span className="italic">{selected.remark}</span>
              ) : selected.isDailyAverage ? (
                t("Daily average")
              ) : (
                t("Actual reading")
              )}
            </div>
          </div>
        )}
      </figcaption>
    </figure>
  );
}
