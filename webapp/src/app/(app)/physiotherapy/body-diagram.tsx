"use client";

// Anatomical body chart backed by a real front/side/back illustration
// (public/body-chart.png), showing 4 views: front, right side, back, left
// side. Hotspots are positioned as percentages over the image. The major
// paired joints (shoulder, elbow, hip, knee, ankle) each get a hotspot on
// every view they're visible in, so e.g. shoulder swelling can be noted
// from the front, the back, or the side, not just one angle.
export type BodyRegion = { name: string; side: "R" | "L" | null; x: number; y: number };

export const FRONT_REGIONS: BodyRegion[] = [
  { name: "Head", side: null, x: 17.19, y: 6.82 },
  { name: "Neck", side: null, x: 17.19, y: 18.59 },
  { name: "Right Shoulder", side: "R", x: 10.74, y: 22.92 },
  { name: "Left Shoulder", side: "L", x: 23.63, y: 22.92 },
  { name: "Chest", side: null, x: 17.19, y: 28.50 },
  { name: "Right Upper Arm", side: "R", x: 9.77, y: 30.36 },
  { name: "Left Upper Arm", side: "L", x: 24.61, y: 30.36 },
  { name: "Abdomen", side: null, x: 17.19, y: 35.94 },
  { name: "Right Elbow", side: "R", x: 8.79, y: 38.41 },
  { name: "Left Elbow", side: "L", x: 25.59, y: 38.41 },
  { name: "Right Hip", side: "R", x: 13.35, y: 42.75 },
  { name: "Left Hip", side: "L", x: 21.03, y: 42.75 },
  { name: "Right Forearm", side: "R", x: 7.62, y: 46.47 },
  { name: "Left Forearm", side: "L", x: 26.76, y: 46.47 },
  { name: "Right Hand", side: "R", x: 5.53, y: 55.14 },
  { name: "Left Hand", side: "L", x: 28.84, y: 55.14 },
  { name: "Right Thigh", side: "R", x: 14.06, y: 57.87 },
  { name: "Left Thigh", side: "L", x: 20.31, y: 57.87 },
  { name: "Right Knee", side: "R", x: 14.78, y: 73.11 },
  { name: "Left Knee", side: "L", x: 19.53, y: 73.11 },
  { name: "Right Lower Leg", side: "R", x: 14.84, y: 81.16 },
  { name: "Left Lower Leg", side: "L", x: 19.53, y: 81.16 },
  { name: "Right Ankle", side: "R", x: 15.17, y: 90.46 },
  { name: "Left Ankle", side: "L", x: 19.08, y: 90.46 },
  { name: "Right Foot", side: "R", x: 14.65, y: 96.03 },
  { name: "Left Foot", side: "L", x: 18.88, y: 96.03 },
];

export const BACK_REGIONS: BodyRegion[] = [
  { name: "Upper Back", side: null, x: 61.85, y: 30.98 },
  { name: "Lower Back", side: null, x: 61.85, y: 47.09 },
];

// Same joints as FRONT_REGIONS but tapped from the back-view figure --
// lets a finding note e.g. the back of a shoulder or knee, not just the
// front. Named "<Joint> (Back)" so front and back stay separate entries.
export const BACK_LIMB_REGIONS: BodyRegion[] = [
  { name: "Right Shoulder (Back)", side: "R", x: 67.06, y: 22.30 },
  { name: "Left Shoulder (Back)", side: "L", x: 56.64, y: 22.30 },
  { name: "Right Elbow (Back)", side: "R", x: 69.66, y: 38.41 },
  { name: "Left Elbow (Back)", side: "L", x: 54.04, y: 38.41 },
  { name: "Right Hip (Back)", side: "R", x: 65.17, y: 42.75 },
  { name: "Left Hip (Back)", side: "L", x: 58.53, y: 42.75 },
  { name: "Right Knee (Back)", side: "R", x: 63.93, y: 73.11 },
  { name: "Left Knee (Back)", side: "L", x: 59.77, y: 73.11 },
  { name: "Right Ankle (Back)", side: "R", x: 63.54, y: 90.46 },
  { name: "Left Ankle (Back)", side: "L", x: 60.16, y: 90.46 },
];

// The two side-view figures each show only one side of the body. By the
// rotation order the artwork is drawn in (front -> right side -> back ->
// left side), the panel right after the front figure is the right side,
// and the panel after the back figure is the left side -- so each hosts
// only the hotspots for its own side, named "<Joint> (Side)".
export const SIDE_REGIONS: BodyRegion[] = [
  { name: "Right Shoulder (Side)", side: "R", x: 40.36, y: 19.21 },
  { name: "Left Shoulder (Side)", side: "L", x: 82.16, y: 19.21 },
  { name: "Right Elbow (Side)", side: "R", x: 39.39, y: 34.08 },
  { name: "Left Elbow (Side)", side: "L", x: 83.14, y: 34.08 },
  { name: "Right Hand (Side)", side: "R", x: 39.39, y: 57.00 },
  { name: "Left Hand (Side)", side: "L", x: 83.14, y: 57.00 },
  { name: "Right Hip (Side)", side: "R", x: 37.44, y: 35.32 },
  { name: "Left Hip (Side)", side: "L", x: 85.09, y: 35.32 },
  { name: "Right Knee (Side)", side: "R", x: 38.41, y: 74.35 },
  { name: "Left Knee (Side)", side: "L", x: 84.11, y: 74.35 },
  { name: "Right Ankle (Side)", side: "R", x: 40.04, y: 91.70 },
  { name: "Left Ankle (Side)", side: "L", x: 82.49, y: 91.70 },
];

export const ALL_REGIONS: BodyRegion[] = [
  ...FRONT_REGIONS,
  ...BACK_REGIONS,
  ...BACK_LIMB_REGIONS,
  ...SIDE_REGIONS,
];

type Props = {
  onSelectRegion: (region: BodyRegion) => void;
  markedRegionNames: Set<string>;
  pendingRegionName?: string | null;
};

export function BodyDiagram({ onSelectRegion, markedRegionNames, pendingRegionName }: Props) {
  return (
    <div className="relative mx-auto w-full max-w-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/body-chart.png" alt="Body chart (front, side and back views)" className="block w-full select-none" draggable={false} />
      {ALL_REGIONS.map((region) => {
        const marked = markedRegionNames.has(region.name);
        // Pending = tapped, comment box open, not yet added -- stays lit
        // (driven by parent state, not :hover) until "Add finding" is
        // pressed, Cancel is pressed, or a different region is tapped.
        const pending = !marked && region.name === pendingRegionName;
        return (
          // Hit area is deliberately larger than the visible dot -- the
          // dots are small against the full illustration, and a near-miss
          // tap used to land on the plain <img> and do nothing, which read
          // as the highlight "not sticking". The dot itself keeps its
          // original size; only the tappable area grows.
          <button
            key={region.name}
            type="button"
            onClick={() => onSelectRegion(region)}
            title={region.name}
            aria-label={region.name}
            className="group absolute flex items-center justify-center rounded-full"
            style={{
              left: `${region.x}%`,
              top: `${region.y}%`,
              width: 26,
              height: 26,
              transform: "translate(-50%, -50%)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              className={`block rounded-full border transition-colors ${
                marked
                  ? "border-indigo-700 bg-indigo-600"
                  : pending
                    ? "border-indigo-600 bg-indigo-400 ring-2 ring-indigo-300"
                    : "border-indigo-400 bg-indigo-100/80 group-hover:bg-indigo-300"
              }`}
              style={{ width: marked || pending ? 14 : 11, height: marked || pending ? 14 : 11 }}
            />
          </button>
        );
      })}
    </div>
  );
}
