import { getServerTranslator } from "@/lib/i18n/server";
import { getBranches } from "@/lib/lookups";
import { INV_TIER, formatQty } from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadCostHints, loadLocations, loadOpenRequests, loadResidents, loadStaff, loadSuppliers } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../shell";
import { EmptyState } from "../components/form-bits";
import { TransferAction } from "../transfers/transfer-action";
import { ReceiveForm } from "./receive-form";
import { ReceiveTabs } from "./receive-tabs";

type IncomingRow = {
  id: number;
  transfer_no: string;
  from_branch_id: number;
  to_branch_id: number;
  tbl_inv_branch_transfer_lines: { line_no: number; qty_base: number; tbl_inv_products: { name: string } | { name: string }[] | null }[];
};

// Goods receipt against a supplier invoice / cash bill (D-138) into the
// branch STORE, with SST, discount and delivery spread over the lines
// (landed cost, computed by the RPC), FOC, and optional allocation of a
// line to a resident's Transit bucket (receive & allocate, D-40).
// The "Branch transfer" view confirms incoming DISPATCHED branch transfers
// (this branch = destination); dispatch/cancel live on the Transfers page.
export default async function InventoryReceivePage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const ctx = await requireInventory(searchParams);
  const { t } = await getServerTranslator();
  const branchId = ctx.branchId;
  const canReceiveTransfers = ctx.rank >= INV_TIER.TRANSFER;
  const data =
    branchId === null || ctx.rank < INV_TIER.RECEIPT
      ? null
      : await Promise.all([
          loadLocations(ctx.supabase, branchId),
          loadCatalogue(ctx.supabase),
          loadSuppliers(ctx.supabase),
          isDemoBranch(branchId).then((demo) => loadStaff(ctx.supabase, branchId, demo)),
          loadResidents(ctx.supabase, branchId),
          canReceiveTransfers
            ? ctx.supabase
                .from("tbl_inv_branch_transfers")
                .select("id, transfer_no, from_branch_id, to_branch_id, tbl_inv_branch_transfer_lines(line_no, qty_base, tbl_inv_products(name))")
                .eq("status", "DISPATCHED")
                .eq("to_branch_id", branchId)
                .order("id", { ascending: false })
                .limit(100)
            : Promise.resolve({ data: [] }),
          canReceiveTransfers ? getBranches("NUR") : Promise.resolve([]),
          loadOpenRequests(ctx.supabase, branchId),
          loadCostHints(ctx.supabase, branchId),
        ]);

  let tabs = null;
  if (data) {
    const incoming = (data[5].data ?? []) as unknown as IncomingRow[];
    const branchLabel = new Map(data[6].map((b) => [Number(b.id), b.label]));
    const staff = data[3];
    const list =
      incoming.length === 0 ? (
        <EmptyState text={t("Nothing awaiting receipt.")} />
      ) : (
        <ul className="divide-y divide-line-subtle rounded-lg border border-line bg-surface shadow-sm">
          {incoming.map((x) => (
            <li key={x.id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-fg">{x.transfer_no}</span>
                <span className="text-fg-subtle">
                  {branchLabel.get(Number(x.from_branch_id))} → {branchLabel.get(Number(x.to_branch_id))}
                </span>
              </div>
              <p className="text-xs text-fg-secondary">
                {x.tbl_inv_branch_transfer_lines
                  .map((l) => {
                    const p = Array.isArray(l.tbl_inv_products) ? l.tbl_inv_products[0] : l.tbl_inv_products;
                    return `${p?.name ?? "?"} × ${formatQty(l.qty_base)}`;
                  })
                  .join(", ")}
              </p>
              <TransferAction kind="receive" transferId={x.id} staff={staff} />
            </li>
          ))}
        </ul>
      );
    tabs = (
      <ReceiveTabs
        key={branchId}
        pendingCount={incoming.length}
        invoice={
          <ReceiveForm
            storeId={data[0].find((l) => l.kind === "STORE")?.id ?? null}
            catalogue={data[1]}
            suppliers={data[2]}
            staff={staff}
            residents={data[4]}
            openRequests={data[7]}
            costHints={data[8]}
          />
        }
        transfers={
          canReceiveTransfers ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-fg">{t("Incoming transfers awaiting receipt")}</h2>
              {list}
            </section>
          ) : null
        }
      />
    );
  }

  return (
    <InventoryShell ctx={ctx} title="Receive" minRank={INV_TIER.RECEIPT}>
      {tabs}
    </InventoryShell>
  );
}
