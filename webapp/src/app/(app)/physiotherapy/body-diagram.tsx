"use client";

// Simple front-view body outline with tappable hotspots -- deliberately not
// a sophisticated 3D/anatomical rendering, just enough for a therapist to
// point at a region and attach a comment. Two regions that aren't visible
// from the front (Upper Back, Lower Back) are offered as plain buttons
// below the diagram instead of a second (back) view.
export type BodyRegion = { name: string; side: "R" | "L" | null; x: number; y: number };

export const FRONT_REGIONS: BodyRegion[] = [
  { name: "Head / Neck", side: null, x: 100, y: 28 },
  { name: "Right Shoulder", side: "R", x: 62, y: 66 },
  { name: "Left Shoulder", side: "L", x: 138, y: 66 },
  { name: "Chest", side: null, x: 100, y: 82 },
  { name: "Right Upper Arm", side: "R", x: 46, y: 100 },
  { name: "Left Upper Arm", side: "L", x: 154, y: 100 },
  { name: "Abdomen", side: null, x: 100, y: 118 },
  { name: "Right Elbow", side: "R", x: 42, y: 140 },
  { name: "Left Elbow", side: "L", x: 158, y: 140 },
  { name: "Right Forearm", side: "R", x: 40, y: 168 },
  { name: "Left Forearm", side: "L", x: 160, y: 168 },
  { name: "Right Hand", side: "R", x: 38, y: 196 },
  { name: "Left Hand", side: "L", x: 162, y: 196 },
  { name: "Right Hip", side: "R", x: 82, y: 200 },
  { name: "Left Hip", side: "L", x: 118, y: 200 },
  { name: "Right Thigh", side: "R", x: 82, y: 240 },
  { name: "Left Thigh", side: "L", x: 118, y: 240 },
  { name: "Right Knee", side: "R", x: 82, y: 278 },
  { name: "Left Knee", side: "L", x: 118, y: 278 },
  { name: "Right Lower Leg", side: "R", x: 82, y: 316 },
  { name: "Left Lower Leg", side: "L", x: 118, y: 316 },
  { name: "Right Ankle", side: "R", x: 82, y: 350 },
  { name: "Left Ankle", side: "L", x: 118, y: 350 },
  { name: "Right Foot", side: "R", x: 82, y: 368 },
  { name: "Left Foot", side: "L", x: 118, y: 368 },
];

export const NOT_VISIBLE_REGIONS: BodyRegion[] = [
  { name: "Upper Back", side: null, x: 0, y: 0 },
  { name: "Lower Back", side: null, x: 0, y: 0 },
];

type Props = {
  onSelectRegion: (region: BodyRegion) => void;
  markedRegionNames: Set<string>;
};

export function BodyDiagram({ onSelectRegion, markedRegionNames }: Props) {
  return (
    <svg viewBox="0 0 200 400" className="mx-auto h-auto w-full max-w-[220px]" role="img" aria-label="Body chart">
      {/* Simple outline silhouette */}
      <circle cx="100" cy="28" r="18" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="70" y="55" width="60" height="90" rx="12" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="45" y="60" width="20" height="90" rx="8" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="135" y="60" width="20" height="90" rx="8" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="45" y="150" width="16" height="55" rx="7" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="139" y="150" width="16" height="55" rx="7" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="72" y="145" width="56" height="65" rx="10" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="75" y="210" width="22" height="90" rx="10" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="103" y="210" width="22" height="90" rx="10" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="76" y="300" width="20" height="60" rx="8" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <rect x="104" y="300" width="20" height="60" rx="8" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <ellipse cx="82" cy="368" rx="12" ry="6" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      <ellipse cx="118" cy="368" rx="12" ry="6" fill="none" stroke="#cbd5e1" strokeWidth="2" />

      {/* Tappable hotspots */}
      {FRONT_REGIONS.map((region) => {
        const marked = markedRegionNames.has(region.name);
        return (
          <g key={region.name}>
            <circle
              cx={region.x}
              cy={region.y}
              r={marked ? 9 : 7}
              className={`cursor-pointer transition-colors ${
                marked ? "fill-indigo-600" : "fill-indigo-100 hover:fill-indigo-300"
              }`}
              stroke={marked ? "#4338ca" : "#818cf8"}
              strokeWidth="1.5"
              onClick={() => onSelectRegion(region)}
            >
              <title>{region.name}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
