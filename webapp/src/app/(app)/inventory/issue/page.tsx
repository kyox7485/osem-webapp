import { INV_TIER } from "@/lib/inventory/core";
import { InventoryShell, requireInventory } from "../shell";
import { SubTabs } from "../components/sub-tabs";
import { resolveSubTabs, type SubTabDef } from "../components/sub-page";
import { IssuePanel } from "./issue-panel";
import { ReturnsPanel } from "../returns/returns-panel";
import { WriteOffPanel } from "../write-off/write-off-panel";
import { AdjustmentsPanel } from "../adjustments/adjustments-panel";

const TABS: SubTabDef[] = [
  { key: "issue", label: "Issue", minRank: INV_TIER.ISSUE },
  { key: "returns", label: "Returns", minRank: INV_TIER.RETURN_FROM_ISSUE },
  { key: "write-off", label: "Write-off", minRank: INV_TIER.WRITE_OFF },
  { key: "adjustments", label: "Adjustments", minRank: INV_TIER.ADJUSTMENT_REQUEST },
];

// Master page for stock going out or being corrected outside purchasing:
// Issue (resident / OSEM expense), Returns, Write-off and Adjustments. The
// active sub-tab is ?tab=; each keeps its own rank gate.
export default async function InventoryIssuePage({ searchParams }: { searchParams: Promise<{ branch?: string; tab?: string }> }) {
  const { tab } = await searchParams;
  const ctx = await requireInventory(searchParams);
  const { allowed, active } = resolveSubTabs(TABS, ctx.rank, tab);
  const title = allowed.find((a) => a.key === active)?.label ?? "Issue";

  return (
    <InventoryShell ctx={ctx} title={title} minRank={Math.min(...TABS.map((d) => d.minRank))}>
      <SubTabs basePath="/inventory/issue" items={allowed} active={active} branchId={ctx.branchId} />
      {active === "issue" && <IssuePanel ctx={ctx} />}
      {active === "returns" && <ReturnsPanel ctx={ctx} />}
      {active === "write-off" && <WriteOffPanel ctx={ctx} />}
      {active === "adjustments" && <AdjustmentsPanel ctx={ctx} />}
    </InventoryShell>
  );
}
