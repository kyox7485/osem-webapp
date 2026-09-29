import type { SubTabItem } from "./sub-tabs";

export type SubTabDef = SubTabItem & { minRank: number };

/** Sub-tabs the rank may use, and the active one (?tab=, else the first allowed). */
export function resolveSubTabs(defs: SubTabDef[], rank: number, tab: string | undefined) {
  const allowed = defs.filter((d) => rank >= d.minRank);
  const active = allowed.find((d) => d.key === tab)?.key ?? allowed[0]?.key ?? "";
  return { allowed, active };
}
