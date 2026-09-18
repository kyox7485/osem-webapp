"use client";

import { useTranslation } from "@/components/language-provider";

// Front/back only -- public/body-chart-wound.png is a dedicated 2-view
// (front + back, side by side) chart supplied for this module, at 922x807.
// Not derived from the physiotherapy module's 4-view body-chart.png (see
// webapp/src/app/(app)/physiotherapy/body-diagram.tsx) -- that one's crop
// wasn't liked, so this is its own asset now. Side-profile views were
// dropped entirely: a wound's left/right side is already conveyed by the
// Left/Right split in the label (e.g. "Left Leg"), so a third camera angle
// wasn't pulling its weight and only added crowded, easy-to-mistap dots.
//
// Every region here except Hand and Leg is a round dot, sized to match the
// capsules' visual weight (see DOT_SIZE below) rather than the small tap
// target this started as. Hand and Leg are drawn as an elongated capsule --
// one dot per limb was too small a target and didn't reflect that "Hand"
// and "Leg" are used as catch-all buckets for the whole limb, not just the
// extremity -- so the capsule spans the distal ~60% of the limb (a point
// 40% of the way from shoulder/hip to fingertip/ankle, down to the
// fingertip/ankle itself), covering the forearm+hand or shin+ankle+foot
// area where most photos are actually taken.
//
// Coordinates are percentages of the full image; picked against a
// percentage grid overlaid on body-chart-wound.png. Nudge if they look off
// once seen live against real device widths.
type Dot = { kind: "dot"; x: number; y: number };
type Capsule = { kind: "capsule"; x1: number; y1: number; x2: number; y2: number };
type Spot = Dot | Capsule;

export const WOUND_REGION_POSITIONS: Record<string, Spot[]> = {
  Head: [
    { kind: "dot", x: 26, y: 8.7 }, // front
    { kind: "dot", x: 74.9, y: 6.8 }, // back
  ],
  Neck: [
    { kind: "dot", x: 26, y: 19 },
    { kind: "dot", x: 74.8, y: 17 },
  ],
  Shoulder: [
    { kind: "dot", x: 16.3, y: 26 }, // front, patient's right
    { kind: "dot", x: 35.8, y: 26 }, // front, patient's left
    { kind: "dot", x: 86.9, y: 24.8 }, // back, patient's right (left/right flips on the back panel)
    { kind: "dot", x: 62.5, y: 24.8 }, // back, patient's left
  ],
  Chest: [{ kind: "dot", x: 26, y: 29 }],
  Abdomen: [{ kind: "dot", x: 26, y: 41 }],
  Back: [{ kind: "dot", x: 74.9, y: 28.5 }],
  Sacrum: [{ kind: "dot", x: 74.9, y: 45.2 }],
  "Right Hand": [
    { kind: "capsule", x1: 11.3, y1: 38.64, x2: 3.8, y2: 57.6 }, // front
    { kind: "capsule", x1: 91.02, y1: 37.92, x2: 97.2, y2: 57.6 }, // back (right/left flips on the back panel)
  ],
  "Left Hand": [
    { kind: "capsule", x1: 39.8, y1: 39.04, x2: 45.8, y2: 58.6 }, // front
    { kind: "capsule", x1: 58.58, y1: 37.92, x2: 52.7, y2: 57.6 }, // back
  ],
  // Legs are deliberately drawn dead vertical (x1 === x2, a straight 90°
  // capsule) rather than following the hip->ankle diagonal like the arms
  // do -- the legs taper inward toward the ankle in this artwork, so a
  // capsule angled to match that taper pinches the gap between the two
  // legs down to almost nothing at the bottom. A straight vertical capsule
  // sized off the (wider) hip position keeps a consistent, comfortable gap
  // between the left and right hotspots along their whole length.
  "Right Leg": [
    { kind: "capsule", x1: 20, y1: 66.84, x2: 20, y2: 92.1 }, // front
    { kind: "capsule", x1: 80, y1: 69.06, x2: 80, y2: 92.1 }, // back (right/left flips on the back panel)
  ],
  "Left Leg": [
    { kind: "capsule", x1: 29, y1: 66.84, x2: 29, y2: 92.1 }, // front
    { kind: "capsule", x1: 70, y1: 69.06, x2: 70, y2: 92.1 }, // back
  ],
};

// The displayed image's height is this much taller than its width (807/922
// natural pixel ratio), so a raw diagonal between two x%/y% points isn't
// isotropic -- y needs this scale factor before computing capsule length/angle
// in "percent of width" units.
const IMAGE_ASPECT = 807 / 922;

// Round-dot hit box / visible-circle sizes, tuned to read at roughly the
// same visual weight as the 26px-thick capsules next to them.
const DOT_HIT_SIZE = 34;
const DOT_VISIBLE_SIZE = { empty: 22, withPhotos: 30 };

export type WoundBodyPart = { id: number | string; label: string };

type Props = {
  bodyParts: WoundBodyPart[];
  photoCountByLabel: Record<string, number>;
  onSelectPart: (part: WoundBodyPart) => void;
};

export function WoundBodyDiagram({ bodyParts, photoCountByLabel, onSelectPart }: Props) {
  const t = useTranslation();
  const mapped = bodyParts.filter((p) => WOUND_REGION_POSITIONS[p.label]);

  return (
    <div className="relative mx-auto w-full max-w-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/body-chart-wound.png"
        alt={t("Body chart (front and back views)")}
        className="block w-full select-none"
        draggable={false}
      />
      {mapped.flatMap((part) => {
        const spots = WOUND_REGION_POSITIONS[part.label];
        const count = photoCountByLabel[part.label] ?? 0;
        const hasPhotos = count > 0;
        const badgeClass = hasPhotos
          ? "border-red-700 bg-red-600 text-[10px] font-bold text-white"
          : "border-red-400 bg-red-100/80 group-hover:bg-red-300";

        return spots.map((spot, i) => {
          const key = `${part.label}-${i}`;
          if (spot.kind === "dot") {
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectPart(part)}
                title={t(part.label)}
                aria-label={t(part.label)}
                className="group absolute flex items-center justify-center rounded-full"
                style={{
                  left: `${spot.x}%`,
                  top: `${spot.y}%`,
                  width: DOT_HIT_SIZE,
                  height: DOT_HIT_SIZE,
                  transform: "translate(-50%, -50%)",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span
                  className={`flex items-center justify-center rounded-full border transition-colors ${badgeClass}`}
                  style={{
                    width: hasPhotos ? DOT_VISIBLE_SIZE.withPhotos : DOT_VISIBLE_SIZE.empty,
                    height: hasPhotos ? DOT_VISIBLE_SIZE.withPhotos : DOT_VISIBLE_SIZE.empty,
                  }}
                >
                  {hasPhotos ? count : null}
                </span>
              </button>
            );
          }

          const dx = spot.x2 - spot.x1;
          const dy = (spot.y2 - spot.y1) * IMAGE_ASPECT;
          const lengthPct = Math.sqrt(dx * dx + dy * dy);
          const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectPart(part)}
              title={t(part.label)}
              aria-label={t(part.label)}
              className="group absolute"
              style={{
                left: `${spot.x1}%`,
                top: `${spot.y1}%`,
                width: `${lengthPct}%`,
                height: 26,
                transform: `translateY(-50%) rotate(${angleDeg}deg)`,
                transformOrigin: "left center",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span
                className={`block h-full w-full rounded-full border transition-colors ${
                  hasPhotos ? "border-red-700 bg-red-600/70" : "border-red-400 bg-red-100/50 group-hover:bg-red-300/70"
                }`}
              />
              {hasPhotos && (
                <span
                  className="absolute left-1/2 top-1/2 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-red-700 bg-red-600 text-[10px] font-bold text-white"
                  style={{ transform: `translate(-50%, -50%) rotate(${-angleDeg}deg)` }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        });
      })}
    </div>
  );
}
