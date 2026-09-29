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

// Master ledger: the filtered transaction list (with Reverse and PDF / CSV
// export) plus the one-off Opening balance entry for ranks allowed it. Active
// sub-tab is ?tab=; the ledger filters are the other query parameters.
export default async function InventoryTransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const ctx = await requireInventory(searchParams);
  const { allowed, active } = resolveSubTabs(TABS, ctx.rank, typeof raw.tab === "string" ? raw.tab : undefined);

  return (
    <InventoryShell ctx={ctx} title={active === "opening" ? "Opening balance" : "Transactions"}>
      <SubTabs basePath="/inventory/transactions" items={allowed} active={active} branchId={ctx.branchId} />
      {active === "ledger" && <LedgerPanel ctx={ctx} raw={raw} />}
      {active === "opening" && <OpeningPanel ctx={ctx} />}
    </InventoryShell>
  );
}
