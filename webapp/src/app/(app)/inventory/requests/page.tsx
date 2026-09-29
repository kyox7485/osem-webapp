import { getServerTranslator } from "@/lib/i18n/server";
import { INV_TIER, REQUEST_STATUS_OPTIONS, labelOf } from "@/lib/inventory/core";
import { isDemoBranch, loadCatalogue, loadStaff } from "@/lib/inventory/server";
import { InventoryShell, requireInventory } from "../shell";
import { EmptyState } from "../components/form-bits";
import { RequestsTabs } from "./requests-tabs";
import { SuggestedOrderForm, type SuggestionRow } from "./suggested-order-form";
import { RequestList, type RequestListRow } from "./request-list";

type SuggestedDbRow = {
  product_id: number;
  sku: string;
  product_name: string;
  max_store: number | null;
  max_floor: number | null;
  on_hand: number;
  open_request_qty: number;
  suggested_base: number;
  purchase_uom_id: number;
  purchase_uom_code: string;
  purchase_factor: number;
  suggested_purchase_qty: number;
};

const STATUSES = REQUEST_STATUS_OPTIONS.map((o) => o.value as string);

// Stock requests / reorder (D-100, D-119, Q-18). Suggested Order = max (Store +
// Floor) − on hand − approved-but-undelivered, from v_inv_suggested_order, in
// the purchase UOM and base. The Head Nurse turns it into a request; HQ
// reviews, orders externally (Bukku) and marks it ordered; deliveries are
// received on the Receive page against the request.
export default async function InventoryRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; status?: string; view?: string }>;
}) {
  const ctx = await requireInventory(searchParams);
  const { status, view } = await searchParams;
  const { t } = await getServerTranslator();
  const branchId = ctx.branchId;
  const statusFilter = status && STATUSES.includes(status) ? status : "";
  if (branchId === null || ctx.rank < INV_TIER.STOCK_REQUEST) {
    return (
      <InventoryShell ctx={ctx} title="Stock requests" minRank={INV_TIER.STOCK_REQUEST}>
        {null}
      </InventoryShell>
    );
  }

  let listQuery = ctx.supabase
    .from("tbl_inv_stock_requests")
    .select("id, request_no, status, requested_by_staff, created_at, external_ref, expected_delivery_date, tbl_inv_stock_request_lines(id)")
    .eq("branch_id", branchId)
    .order("id", { ascending: false })
    .limit(100);
  if (statusFilter) listQuery = listQuery.eq("status", statusFilter);

  const demo = await isDemoBranch(branchId);
  const [suggestedRes, balancesRes, catalogue, staff, listRes] = await Promise.all([
    ctx.supabase
      .from("v_inv_suggested_order")
      .select(
        "product_id, sku, product_name, max_store, max_floor, on_hand, open_request_qty, suggested_base, purchase_uom_id, purchase_uom_code, purchase_factor, suggested_purchase_qty"
      )
      .eq("branch_id", branchId)
      .order("product_name")
      .limit(2000),
    ctx.supabase
      .from("v_inv_stock_balance")
      .select("product_id, location_kind, qty")
      .eq("branch_id", branchId)
      .is("resident_id", null)
      .in("location_kind", ["STORE", "FLOOR"])
      .limit(5000),
    loadCatalogue(ctx.supabase),
    loadStaff(ctx.supabase, branchId, demo),
    listQuery,
  ]);

  const loadFailed = suggestedRes.error || balancesRes.error || listRes.error;
  const perLocation = new Map<string, number>();
  for (const b of balancesRes.data ?? []) {
    perLocation.set(`${b.product_id}:${b.location_kind}`, Number(b.qty));
  }
  const baseCode = new Map(
    catalogue.products.map((p) => [p.id, catalogue.uoms.find((u) => u.id === p.baseUomId)?.code ?? ""])
  );
  const suggestions: SuggestionRow[] = ((suggestedRes.data ?? []) as SuggestedDbRow[]).map((r) => ({
    productId: Number(r.product_id),
    sku: r.sku,
    name: r.product_name,
    maxStore: r.max_store === null ? null : Number(r.max_store),
    maxFloor: r.max_floor === null ? null : Number(r.max_floor),
    onHandStore: perLocation.get(`${r.product_id}:STORE`) ?? 0,
    onHandFloor: perLocation.get(`${r.product_id}:FLOOR`) ?? 0,
    openQty: Number(r.open_request_qty),
    suggestedBase: Number(r.suggested_base),
    purchaseUomId: Number(r.purchase_uom_id),
    purchaseUomCode: r.purchase_uom_code,
    purchaseFactor: Number(r.purchase_factor),
    suggestedPurchase: Number(r.suggested_purchase_qty),
    baseUomCode: baseCode.get(Number(r.product_id)) ?? "",
  }));
  const requests: RequestListRow[] = (listRes.data ?? []).map((r) => ({
    id: Number(r.id),
    requestNo: r.request_no,
    status: r.status,
    statusLabel: t(labelOf(REQUEST_STATUS_OPTIONS, r.status)),
    staff: r.requested_by_staff,
    createdAt: r.created_at,
    externalRef: r.external_ref,
    expectedDelivery: r.expected_delivery_date,
    lineCount: (r.tbl_inv_stock_request_lines ?? []).length,
  }));

  return (
    <InventoryShell ctx={ctx} title="Stock requests" minRank={INV_TIER.STOCK_REQUEST}>
      {loadFailed ? (
        <EmptyState text={t("Could not load stock requests. Please refresh the page.")} />
      ) : (
        <RequestsTabs
          key={branchId}
          initialView={view === "list" || statusFilter ? "LIST" : "SUGGESTED"}
          suggested={
            <SuggestedOrderForm branchId={branchId} rows={suggestions} catalogue={catalogue} staff={staff} />
          }
          list={<RequestList branchId={branchId} rows={requests} status={statusFilter} />}
        />
      )}
    </InventoryShell>
  );
}
