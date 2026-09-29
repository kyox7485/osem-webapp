import { INV_TIER } from "@/lib/inventory/core";
import { InventoryShell, requireInventory } from "../shell";
import { SubTabs } from "../components/sub-tabs";
import { resolveSubTabs, type SubTabDef } from "../components/sub-page";
import { LedgerPanel } from "./ledger-panel";
import { OpeningPanel } from "../opening/opening-panel";

const TABS: SubTabDef[] = [
  { key: "ledger", label: "Ledger", minRank: INV_TIER.VIEW },
  { key: "opening", label: "Opening balance", minRank: INV_TIER.OPENING_BALANCE },
];

// Master ledger: the transaction list (with Reverse) plus the one-off
// Opening balance entry for ranks allowed it. Active sub-tab is ?tab=.
export default async function InventoryTransactionsPage({ searchParams }: { searchParams: Promise<{ branch?: string; tab?: string }> }) {
  const { tab } = await searchParams;
  const ctx = await requireInventory(searchParams);
  const { allowed, active } = resolveSubTabs(TABS, ctx.rank, tab);

  return (
    <InventoryShell ctx={ctx} title={active === "opening" ? "Opening balance" : "Transactions"}>
      <SubTabs basePath="/inventory/transactions" items={allowed} active={active} branchId={ctx.branchId} />
      {active === "ledger" && <LedgerPanel ctx={ctx} />}
      {active === "opening" && <OpeningPanel ctx={ctx} />}
    </InventoryShell>
  );
}
