import { getServerTranslator } from "@/lib/i18n/server";
import { getBranches, getDemoBranchIds } from "@/lib/lookups";
import { INV_TIER, formatQty } from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadLocations, loadResidents, loadStaff } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../shell";
import { EmptyState } from "../components/form-bits";
import { TransferForm } from "./transfer-form";
import { TransferAction } from "./transfer-action";

type TransferRow = {
  id: number;
  transfer_no: string;
  from_branch_id: number;
  to_branch_id: number;
  created_at: string;
  tbl_inv_branch_transfer_lines: { line_no: number; qty_base: number; tbl_inv_products: { name: string } | { name: string }[] | null }[];
};

// Same-branch moves (one Internal Transfer between Store, Floor and a resident's
// Transit bucket) and branch-to-branch transfers (dispatch, then the
// destination receives everything; the source may cancel while dispatched).
export default async function InventoryTransfersPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const ctx = await requireInventory(searchParams);
  const { t } = await getServerTranslator();
  const branchId = ctx.branchId;
  if (branchId === null) return <InventoryShell ctx={ctx} title="Transfers">{null}</InventoryShell>;

  const demo = await isDemoBranch(branchId);
  const demoBranchIds = await getDemoBranchIds();
  const [locations, catalogue, staff, residents, allBranches, transfersRes] = await Promise.all([
    loadLocations(ctx.supabase, branchId),
    loadCatalogue(ctx.supabase),
    loadStaff(ctx.supabase, branchId, demo),
    loadResidents(ctx.supabase, branchId, false),
    getBranches("NUR"),
    ctx.supabase
      .from("tbl_inv_branch_transfers")
      .select("id, transfer_no, from_branch_id, to_branch_id, created_at, tbl_inv_branch_transfer_lines(line_no, qty_base, tbl_inv_products(name))")
      .eq("status", "DISPATCHED")
      .eq("from_branch_id", branchId)
      .order("id", { ascending: false })
      .limit(100),
  ]);
  // DEMO isolation: a transfer involving a demo branch must be demo ↔ demo (§8.10)
  const destinations = allBranches
    .map((b) => ({ id: Number(b.id), label: b.label }))
    .filter((b) => b.id !== branchId && demoBranchIds.includes(b.id) === demo);
  const branchLabel = new Map(allBranches.map((b) => [Number(b.id), b.label]));
  // Incoming transfers are confirmed on the Receive page, not here.
  const outgoing = (transfersRes.data ?? []) as unknown as TransferRow[];

  const renderList = (rows: TransferRow[]) =>
    rows.length === 0 ? (
      <EmptyState text={t("Nothing awaiting receipt.")} />
    ) : (
      <ul className="divide-y divide-line-subtle rounded-lg border border-line bg-surface shadow-sm">
        {rows.map((x) => (
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
            {ctx.rank >= INV_TIER.BRANCH_CANCEL && (
              <TransferAction kind="cancel" transferId={x.id} staff={staff} />
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <InventoryShell ctx={ctx} title="Transfers" minRank={INV_TIER.TRANSFER}>
      <div className="space-y-6">
        <TransferForm
          key={branchId}
          locations={locations}
          catalogue={catalogue}
          staff={staff}
          residents={residents}
          destinations={destinations}
          canRelease={ctx.rank >= INV_TIER.TRANSIT_RELEASE}
        />
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-fg">{t("Dispatched from this branch")}</h2>
          {renderList(outgoing)}
        </section>
      </div>
    </InventoryShell>
  );
}
