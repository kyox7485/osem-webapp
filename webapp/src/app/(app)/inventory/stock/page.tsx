import { InventoryShell, requireInventory } from "../shell";
import { ReportSection } from "../components/report-section";

// Stock on hand per bucket (Store, Floor, Transit per resident) for the
// selected branch, from v_inv_stock_balance (RLS: the caller's scope).
// Filters (category, product by name / SKU / barcode, product status,
// supplier) live in the URL; the PDF and CSV links export the same filtered
// view (Phase 7). Costs show from the Head-Nurse tier up (section 8.4 row 2).
export default async function InventoryStockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireInventory(searchParams);
  const raw = await searchParams;
  return (
    <InventoryShell ctx={ctx} title="Stock">
      <ReportSection ctx={ctx} report="stock" raw={raw} action="/inventory/stock" />
    </InventoryShell>
  );
}
