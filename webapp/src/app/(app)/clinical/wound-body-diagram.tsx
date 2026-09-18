"use client";

import { useTranslation } from "@/components/language-provider";

// Reuses the same front/right-side/back/left-side illustration and
// percentage-hotspot technique as the physiotherapy module's BodyDiagram
// (webapp/src/app/(app)/physiotherapy/body-diagram.tsx), but with its own
// hotspot set: pressure-injury/wound documentation sites (Braden/Norton
// bony prominences -- occiput, ears, shoulder blades, sacrum, coccyx,
// ischial tuberosities, heels, etc.) rather than physio's joints/limbs.
// Coordinates for sites the two diagrams share (elbow/hip/knee/ankle) are
// copied from BodyDiagram's calibrated values; the wound-specific
// additions were placed by eye against the same public/body-chart.png and
// may need a small nudge once seen live -- see BodyDiagram's own comments
// noting the same iterative tuning was needed there.
//
// Only labels present in this map get a diagram hotspot. Any
// tbl_wound_body_parts row without a matching key here (e.g. a future
// custom label an admin adds) simply won't appear on the diagram --
// callers should offer those as a fallback chip list instead, so adding a
// lookup row can never silently "lose" a body part.
export const WOUND_REGION_POSITIONS: Record<string, { x: number; y: number }> = {
  // Front panel (0-25%) -- Groin sits too close to Abdomen/Hip in this
  // artwork's compressed vertical scale (same issue as the back-panel
  // pelvis cluster below), so it's left unmapped and picked via the
  // fallback chip list instead.
  Chest: { x: 17.19, y: 28.5 },
  Abdomen: { x: 17.19, y: 35.94 },
  "Right Elbow": { x: 8.79, y: 38.41 },
  "Left Elbow": { x: 25.59, y: 38.41 },
  "Right Hip": { x: 13.35, y: 42.75 },
  "Left Hip": { x: 21.03, y: 42.75 },
  "Right Knee": { x: 14.78, y: 73.11 },
  "Left Knee": { x: 19.53, y: 73.11 },
  "Right Ankle": { x: 15.17, y: 90.46 },
  "Left Ankle": { x: 19.08, y: 90.46 },

  // Right-side profile panel (25-50%)
  "Right Ear": { x: 41.5, y: 5.5 },

  // Back panel (50-75%) -- the 4-view illustration is wide and short (not
  // tall), so the vertical space available per body region is much more
  // compressed than the x/y percentages suggest: testing found a 7% y-gap
  // between two hotspots is only ~12px in the actually rendered image,
  // well inside a 28px tap target. Rather than shrink every hit target
  // app-wide, only sites with real separation get a diagram hotspot here;
  // Right/Left Shoulder Blade, Spine / Upper Back, Right/Left Ischial
  // Tuberosity and Right/Left Buttock all sit too close to Sacrum/Coccyx
  // in this artwork to be reliably tappable, so they're left unmapped on
  // purpose and picked via the fallback chip list instead (still one tap,
  // just not on the diagram).
  "Back of Head": { x: 61.85, y: 6.5 },
  Sacrum: { x: 61.85, y: 40 },
  Coccyx: { x: 61.85, y: 53 },
  "Right Heel": { x: 63.5, y: 95 },
  "Left Heel": { x: 60.2, y: 95 },

  // Left-side profile panel (75-100%)
  "Left Ear": { x: 82, y: 5.5 },
};

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
        src="/body-chart.png"
        alt={t("Body chart (front, side and back views)")}
        className="block w-full select-none"
        draggable={false}
      />
      {mapped.map((part) => {
        const pos = WOUND_REGION_POSITIONS[part.label];
        const count = photoCountByLabel[part.label] ?? 0;
        const hasPhotos = count > 0;
        return (
          <button
            key={part.label}
            type="button"
            onClick={() => onSelectPart(part)}
            title={t(part.label)}
            aria-label={t(part.label)}
            className="group absolute flex items-center justify-center rounded-full"
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              width: 22,
              height: 22,
              transform: "translate(-50%, -50%)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              className={`flex items-center justify-center rounded-full border transition-colors ${
                hasPhotos
                  ? "border-red-700 bg-red-600 text-[10px] font-bold text-white"
                  : "border-red-400 bg-red-100/80 group-hover:bg-red-300"
              }`}
              style={{ width: hasPhotos ? 18 : 12, height: hasPhotos ? 18 : 12 }}
            >
              {hasPhotos ? count : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
