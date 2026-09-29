import { INV_TIER, daysAgoKL } from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadLocations, loadResidents, loadStaff, loadSuppliers } from "@/lib/inventory/server";
import type { InventoryContext } from "@/lib/inventory/server";
import { ReturnsModule, type IssueLineOption, type ReceiptOption } from "./returns-module";

const LOOKBACK_DAYS = 90;
const MAX_ISSUE_LINES = 300;

type IssueLineRow = {
  id: number;
  txn_id: number;
  txn_date: string;
  qty_base: number;
  product_id: number;
  tbl_inv_txns: { txn_no: string } | { txn_no: string }[] | null;
  tbl_inv_products: { name: string; base_uom_id: number } | { name: string; base_uom_id: number }[] | null;
  tbl_inv_charges: { charge_kind: string; target: string; resident_id: number | null }[];
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

// Returns: goods coming back from an issue (to a resident or OSEM expense),
// credited at the issue's own cost and price; and goods going back to a
// supplier from the Store (at WAC; the supplier credit is information only).
export async function ReturnsPanel({ ctx }: { ctx: InventoryContext }) {
  const branchId = ctx.branchId;
  if (branchId === null) return null;

  const since = daysAgoKL(LOOKBACK_DAYS);
  const demo = await isDemoBranch(branchId);
  const [locations, catalogue, staff, residents, suppliers, issueRes, receiptRes] = await Promise.all([
    loadLocations(ctx.supabase, branchId),
    loadCatalogue(ctx.supabase),
    loadStaff(ctx.supabase, branchId, demo),
    loadResidents(ctx.supabase, branchId, false),
    loadSuppliers(ctx.supabase),
    ctx.supabase
      .from("tbl_inv_txn_lines")
      .select("id, txn_id, txn_date, qty_base, product_id, tbl_inv_txns(txn_no), tbl_inv_products(name, base_uom_id), tbl_inv_charges(charge_kind, target, resident_id)")
      .eq("branch_id", branchId)
      .eq("txn_type", "ISSUE")
      .gte("txn_date", since)
      .order("id", { ascending: false })
      .limit(MAX_ISSUE_LINES),
    ctx.supabase
      .from("tbl_inv_receipts")
      .select("id, receipt_no, supplier_id, invoice_no")
      .eq("branch_id", branchId)
      .eq("is_voided", false)
      .gte("received_date", since)
      .order("id", { ascending: false })
      .limit(200),
  ]);

  const issueRows = (issueRes.data ?? []) as unknown as IssueLineRow[];
  const lineIds = issueRows.map((l) => l.id);
  const txnIds = [...new Set(issueRows.map((l) => l.txn_id))];
  const [returnsRes, reversedIssuesRes] = await Promise.all([
    lineIds.length
      ? ctx.supabase.from("tbl_inv_txn_lines").select("txn_id, source_line_id, qty_base").eq("txn_type", "RETURN_FROM_ISSUE").in("source_line_id", lineIds)
      : Promise.resolve({ data: [] as { txn_id: number; source_line_id: number; qty_base: number }[] }),
    txnIds.length
      ? ctx.supabase.from("tbl_inv_txns").select("reverses_txn_id").in("reverses_txn_id", txnIds)
      : Promise.resolve({ data: [] as { reverses_txn_id: number }[] }),
  ]);
  const returnLines = (returnsRes.data ?? []) as { txn_id: number; source_line_id: number; qty_base: number }[];
  const returnTxnIds = [...new Set(returnLines.map((r) => r.txn_id))];
  const { data: reversedReturns } = returnTxnIds.length
    ? await ctx.supabase.from("tbl_inv_txns").select("reverses_txn_id").in("reverses_txn_id", returnTxnIds)
    : { data: [] as { reverses_txn_id: number }[] };
  const deadReturns = new Set((reversedReturns ?? []).map((r) => Number(r.reverses_txn_id)));
  const reversedIssues = new Set((reversedIssuesRes.data ?? []).map((r) => Number(r.reverses_txn_id)));
  const returned = new Map<number, number>();
  returnLines
    .filter((r) => !deadReturns.has(Number(r.txn_id)))
    .forEach((r) => returned.set(Number(r.source_line_id), (returned.get(Number(r.source_line_id)) ?? 0) + Number(r.qty_base)));

  const residentName = new Map(residents.map((r) => [r.id, r.name]));
  const issueLines: IssueLineOption[] = issueRows
    .filter((l) => !reversedIssues.has(Number(l.txn_id)))
    .map((l) => {
      const charge = l.tbl_inv_charges.find((c) => c.charge_kind === "ISSUE");
      const product = one(l.tbl_inv_products);
      const issued = -Number(l.qty_base);
      return {
        id: Number(l.id),
        txnNo: one(l.tbl_inv_txns)?.txn_no ?? "",
        date: l.txn_date,
        productName: product?.name ?? "",
        baseUomId: Number(product?.base_uom_id),
        target: charge?.target ?? "OSEM_EXPENSE",
        residentId: charge?.resident_id ?? null,
        residentName: charge?.resident_id ? residentName.get(Number(charge.resident_id)) ?? "" : "",
        available: issued - (returned.get(Number(l.id)) ?? 0),
      };
    })
    .filter((l) => l.available > 0);
  const receipts: ReceiptOption[] = (receiptRes.data ?? []).map((r) => ({
    id: Number(r.id),
    label: `${r.receipt_no} (${r.invoice_no})`,
    supplierId: Number(r.supplier_id),
  }));

  return (
    <ReturnsModule
        key={branchId}
        locations={locations}
        catalogue={catalogue}
        staff={staff}
        suppliers={suppliers}
        receipts={receipts}
        issueLines={issueLines}
        canReturnToSupplier={ctx.rank >= INV_TIER.RETURN_TO_SUPPLIER}
      />
  );
}
