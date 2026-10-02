import type { DiagnosisOption } from "./types";

// Where the diagnosis checkbox list splits on screen, shared by the resident
// form and the inline "Medical / surgical history" editor in Clinical →
// Medical Progress Notes → New Entry, so the two cannot drift in ordering.
//
// The IDs are hardcoded because the grouping is a *presentation* decision
// baked into the UI (a fixed clinical grouping, not a lookup-table column).
// `tbl_diagnosis_options` stays Supabase-driven for the option list itself.
export const INFECTIOUS_IDS = new Set([18, 19, 20, 21, 22, 23, 24]);
export const BONE_FRACTURE_ID = 17;
export const OTHERS_DIAGNOSIS_ID = 25;

/**
 * "Others" is placed immediately after "Bone Fracture" rather than at the end
 * when that anchor exists -- the admission form has always shown it there and
 * moving it would change where staff's eye lands on a long grid.
 */
export type DiagnosisGrouping = {
  main: DiagnosisOption[];
  infectious: DiagnosisOption[];
  others: DiagnosisOption | undefined;
};

export function groupDiagnosisOptions(options: DiagnosisOption[]): DiagnosisGrouping {
  const main = options.filter(
    (o) => !INFECTIOUS_IDS.has(o.id) && o.id !== OTHERS_DIAGNOSIS_ID
  );
  const others = options.find((o) => o.id === OTHERS_DIAGNOSIS_ID);
  const bfIdx = main.findIndex((o) => o.id === BONE_FRACTURE_ID);
  if (others !== undefined && bfIdx >= 0) {
    const merged = [...main];
    merged.splice(bfIdx + 1, 0, others);
    return { main: merged, infectious: options.filter((o) => INFECTIOUS_IDS.has(o.id)), others };
  }
  return {
    main: others ? [...main, others] : main,
    infectious: options.filter((o) => INFECTIOUS_IDS.has(o.id)),
    others,
  };
}
