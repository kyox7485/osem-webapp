import "server-only";
import { INV_TIER, LOCATION_KIND_OPTIONS, TXN_TYPE_LABELS, labelOf } from "../core";
import { loadSuppliers } from "../server";
import {
  buildResult,
  fetchByIds,
  fetchRows,
  loadProductMeta,
  loadResidentNames,
  one,
  resolveProductIds,
  type ProductMeta,
  type ReportCtx,
} from "./report-core";
import type { ReportColumn, ReportResult } from "./types";

// Format a qty number with its UOM code, e.g. "10 EA", "5 Tab".
function qtyWithUnit(qty: number, uomCode: string): string {
  return `${qty} ${uomCode}`;
}

// Stock balance, Movement (ledger) and Suggested order.

const MAX_SOURCE_ROWS = 20000;

// ----------------------------------------------------------------- Stock balance

type BalanceRow = {
  location_kind: string;
  product_id: number;
  sku: string;
  product_name: string;
  qty: number;
  effective_max: number | null;
  pool_wac: number | null;
  value_at_wac: number | null;
};

// One row per product: quantities summed across location kinds, so the
// stock balance shows Store / Floor Stock / Transit / Total side by side
// instead of one row per location. The location column is dropped in favour
// of the breakdown columns.
function groupQtyByProduct(rows: BalanceRow[]): Map<number, { store: number; floor: number; transit: number; total: number }> {
  const byProduct = new Map<number, { store: number; floor: number; transit: number }>();
  for (const row of rows) {
    const existing = byProduct.get(row.product_id) || { store: 0, floor: 0, transit: 0 };
    if (row.location_kind === "STORE") existing.store += row.qty;
    if (row.location_kind === "FLOOR") existing.floor += row.qty;
    if (row.location_kind === "TRANSIT") existing.transit += row.qty;
    byProduct.set(row.product_id, existing);
  }
  const result = new Map<number, { store: number; floor: number; transit: number; total: number }>();
  for (const [pid, q] of byProduct) {
    result.set(pid, { ...q, total: q.store + q.floor + q.transit });
  }
  return result;
}

function matchesProductFilters(ctx: ReportCtx, productId: number, meta: Map<number, ProductMeta>, matches: Set<number> | null): boolean {
  const { category, status, supplier } = ctx.params;
  if (matches && !matches.has(productId)) return false;
  if (category === null && supplier === null && status === "all") return true;
  const p = meta.get(productId);
  if (!p) return false;
  if (category !== null && p.categoryId !== category) return false;
  if (supplier !== null && p.supplierId !== supplier) return false;
  if (status === "active" && !p.isActive) return false;
  if (status === "inactive" && p.isActive) return false;
  return true;
}

export async function loadStockReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, branchId, rank, t, params } = ctx;
  const showCost = rank >= INV_TIER.VIEW_COST;
  const [meta, matches] = await Promise.all([loadProductMeta(sb), params.q ? resolveProductIds(sb, params.q) : Promise.resolve(null)]);
  const balances = await fetchRows<BalanceRow>(
    () =>
      sb
        .from("v_inv_stock_balance")
        .select("location_kind, product_id, sku, product_name, qty, effective_max, pool_wac, value_at_wac")
        .eq("branch_id", branchId)
        .neq("qty", 0)
        .order("product_name")
        .order("product_id")
        .order("location_kind"),
    MAX_SOURCE_ROWS
  );
  const kept = balances.filter((b) => matchesProductFilters(ctx, Number(b.product_id), meta, matches));
  // max and WAC are per product, so the first row of a product is authoritative
  // for sku/name/max/wac/value; only the quantities are summed across locations.
  const grouped = groupQtyByProduct(kept);
  const shown = [...grouped.entries()]
    .map(([pid, q]) => {
      const first = kept.find((b) => Number(b.product_id) === pid)!;
      return {
        product_id: pid,
        sku: first.sku,
        product_name: first.product_name,
        store: q.store,
        floor: q.floor,
        transit: q.transit,
        total: q.total,
        unit: meta.get(pid)?.baseUomCode ?? "",
        max: first.effective_max === null ? null : Number(first.effective_max),
        wac: first.pool_wac === null ? null : Number(first.pool_wac),
        value: kept
          .filter((b) => Number(b.product_id) === pid)
          .reduce((sum, b) => sum + (b.value_at_wac === null ? 0 : Number(b.value_at_wac)), 0),
      };
    })
    .slice(0, ctx.cap + 1);

  const columns: ReportColumn[] = [
    { key: "sku", label: t("SKU"), kind: "text" },
    { key: "product", label: t("Product"), kind: "text" },
    { key: "storeWithUnit", label: t("Store"), kind: "text" },
    { key: "floorWithUnit", label: t("Floor Stock"), kind: "text" },
    { key: "transitWithUnit", label: t("Transit"), kind: "text" },
    { key: "totalWithUnit", label: t("Total"), kind: "text" },
    { key: "unit", label: t("Unit"), kind: "text" },
    { key: "max", label: t("Max"), kind: "qty" },
  ];
  if (showCost) {
    columns.push({ key: "wac", label: t("WAC"), kind: "money4" }, { key: "value", label: t("Value (indicative)"), kind: "money" });
  }
  const rows = shown.map((b) => ({
    id: b.product_id,
    sku: b.sku,
    product: b.product_name,
    storeWithUnit: qtyWithUnit(b.store, b.unit),
    floorWithUnit: qtyWithUnit(b.floor, b.unit),
    transitWithUnit: qtyWithUnit(b.transit, b.unit),
    totalWithUnit: qtyWithUnit(b.total, b.unit),
    unit: b.unit,
    max: b.max,
    wac: b.wac,
    value: b.value,
  }));
  return buildResult(ctx, "stock", t("Stock balance"), {
    columns,
    rows,
    truncated: kept.length >= MAX_SOURCE_ROWS,
    notes: showCost ? [t("Values are indicative: quantity times the branch cost. See Valuation for the official figures.")] : [],
  });
}

// ----------------------------------------------------------------- Movement (ledger)

export type LedgerLine = {
  id: number;
  lineNo: number;
  txnId: number;
  txnNo: string;
  txnDate: string;
  txnType: string;
  staff: string;
  remarks: string | null;
  locationKind: string;
  residentId: number | null;
  productName: string;
  sku: string;
  qtyBase: number;
  qtyEntered: number;
  uomCode: string;
  unitCost: number | null;
  value: number | null;
  isReversed: boolean;
};

type LedgerSource = {
  id: number;
  line_no: number;
  txn_id: number;
  txn_date: string;
  txn_type: string;
  location_kind: string;
  resident_id: number | null;
  qty_base: number;
  qty_entered: number;
  uom_code: string;
  unit_cost?: number;
  value?: number;
  tbl_inv_products: { name: string; sku: string } | { name: string; sku: string }[] | null;
  tbl_inv_txns: { txn_no: string; performed_by_staff: string; remarks: string | null } | { txn_no: string; performed_by_staff: string; remarks: string | null }[] | null;
};

/**
 * Ledger lines of the branch in the date range, newest first, with the
 * Movement filters applied. Reads one line past the cap so the caller can say
 * "more rows match". Cost columns are only selected from the Head-Nurse tier up.
 */
export async function queryLedger(ctx: ReportCtx): Promise<{ lines: LedgerLine[]; truncated: boolean }> {
  const { sb, branchId, rank, params } = ctx;
  const showCost = rank >= INV_TIER.VIEW_COST;
  let productIds: number[] | null = null;
  if (params.q) {
    productIds = [...(await resolveProductIds(sb, params.q))];
    if (productIds.length === 0) return { lines: [], truncated: false };
  }
  const columns =
    "id, line_no, txn_id, txn_date, txn_type, location_kind, resident_id, qty_base, qty_entered, uom_code" +
    (showCost ? ", unit_cost, value" : "") +
    ", tbl_inv_products(name, sku), tbl_inv_txns!inner(txn_no, performed_by_staff, remarks)";
  const rows = await fetchRows<LedgerSource>(() => {
    let query = sb
      .from("tbl_inv_txn_lines")
      .select(columns)
      .eq("branch_id", branchId)
      .gte("txn_date", params.from)
      .lte("txn_date", params.to);
    if (params.location) query = query.eq("location_kind", params.location);
    if (params.type) query = query.eq("txn_type", params.type);
    if (productIds) query = query.in("product_id", productIds);
    return query.order("txn_date", { ascending: false }).order("txn_id", { ascending: false }).order("line_no");
  }, ctx.cap + 1);

  const reversedRows = await fetchByIds<{ reverses_txn_id: number }>(
    sb,
    "tbl_inv_txns",
    "reverses_txn_id",
    "reverses_txn_id",
    rows.map((r) => Number(r.txn_id))
  );
  const reversed = new Set(reversedRows.map((r) => Number(r.reverses_txn_id)));

  const lines = rows.slice(0, ctx.cap).map((r): LedgerLine => {
    const product = one(r.tbl_inv_products);
    const txn = one(r.tbl_inv_txns);
    return {
      id: Number(r.id),
      lineNo: Number(r.line_no),
      txnId: Number(r.txn_id),
      txnNo: txn?.txn_no ?? "",
      txnDate: r.txn_date,
      txnType: r.txn_type,
      staff: txn?.performed_by_staff ?? "",
      remarks: txn?.remarks ?? null,
      locationKind: r.location_kind,
      residentId: r.resident_id === null ? null : Number(r.resident_id),
      productName: product?.name ?? "",
      sku: product?.sku ?? "",
      qtyBase: Number(r.qty_base),
      qtyEntered: Number(r.qty_entered),
      uomCode: r.uom_code,
      unitCost: showCost && r.unit_cost !== undefined ? Number(r.unit_cost) : null,
      value: showCost && r.value !== undefined ? Number(r.value) : null,
      isReversed: reversed.has(Number(r.txn_id)),
    };
  });
  return { lines, truncated: rows.length > ctx.cap };
}

export async function loadLedgerReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, rank, t } = ctx;
  const showCost = rank >= INV_TIER.VIEW_COST;
  const { lines, truncated } = await queryLedger(ctx);
  const residents = await loadResidentNames(sb, lines.map((l) => l.residentId));
  const columns: ReportColumn[] = [
    { key: "date", label: t("Date"), kind: "date" },
    { key: "txnNo", label: t("Txn no."), kind: "text" },
    { key: "type", label: t("Type"), kind: "text" },
    { key: "sku", label: t("SKU"), kind: "text" },
    { key: "product", label: t("Product"), kind: "text" },
    { key: "location", label: t("Location"), kind: "text" },
    { key: "resident", label: t("Resident"), kind: "text" },
    { key: "qty", label: t("Qty (base unit)"), kind: "qty" },
    { key: "entered", label: t("Qty entered"), kind: "qty" },
    { key: "uom", label: t("UOM"), kind: "text" },
  ];
  if (showCost) {
    columns.push({ key: "unitCost", label: t("Unit cost"), kind: "money4" }, { key: "value", label: t("Value"), kind: "money" });
  }
  columns.push({ key: "by", label: t("By"), kind: "text" }, { key: "status", label: t("Status"), kind: "text" });
  const rows = lines.map((l) => ({
    date: l.txnDate,
    txnNo: l.txnNo,
    type: t(TXN_TYPE_LABELS[l.txnType] ?? l.txnType),
    sku: l.sku,
    product: l.productName,
    location: t(labelOf(LOCATION_KIND_OPTIONS, l.locationKind)),
    resident: l.residentId === null ? "" : (residents.get(l.residentId) ?? `#${l.residentId}`),
    qty: l.qtyBase,
    entered: l.qtyEntered,
    uom: l.uomCode,
    unitCost: l.unitCost,
    value: l.value,
    by: l.staff,
    status: l.isReversed ? t("Reversed") : "",
  }));
  return buildResult(ctx, "ledger", t("Movement"), { columns, rows, truncated });
}

// ----------------------------------------------------------------- Suggested order

type SuggestedRow = {
  product_id: number;
  sku: string;
  product_name: string;
  max_total: number;
  on_hand: number;
  open_request_qty: number;
  suggested_base: number;
  purchase_uom_code: string | null;
  suggested_purchase_qty: number | null;
};

/**
 * Products below their maximum (Store + Floor on hand, less what is already
 * on approved requests): top up to max, also in the purchase unit. The
 * schema has no minimum level, so "below max" (v_inv_suggested_order, D-119)
 * is the trigger, exactly as on the Stock requests page.
 */
export async function loadSuggestedReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, branchId, t, params } = ctx;
  const needMeta = params.category !== null || params.supplier !== null;
  const [rows, meta, suppliers] = await Promise.all([
    fetchRows<SuggestedRow>(
      () =>
        sb
          .from("v_inv_suggested_order")
          .select("product_id, sku, product_name, max_total, on_hand, open_request_qty, suggested_base, purchase_uom_code, suggested_purchase_qty")
          .eq("branch_id", branchId)
          .gt("suggested_base", 0)
          .order("product_name")
          .order("product_id"),
      MAX_SOURCE_ROWS
    ),
    loadProductMeta(sb),
    loadSuppliers(sb, { includeInactive: true }),
  ]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const kept = rows.filter((r) => {
    if (!needMeta) return true;
    const p = meta.get(Number(r.product_id));
    if (!p) return false;
    return (params.category === null || p.categoryId === params.category) && (params.supplier === null || p.supplierId === params.supplier);
  });
  const columns: ReportColumn[] = [
    { key: "sku", label: t("SKU"), kind: "text" },
    { key: "product", label: t("Product"), kind: "text" },
    { key: "supplier", label: t("Supplier"), kind: "text" },
    { key: "onHand", label: t("On hand (Store + Floor)"), kind: "qty" },
    { key: "max", label: t("Max"), kind: "qty" },
    { key: "onOrder", label: t("Already requested"), kind: "qty" },
    { key: "suggested", label: t("Suggested (base unit)"), kind: "qty" },
    { key: "purchaseQty", label: t("Suggested (purchase unit)"), kind: "qty" },
    { key: "purchaseUom", label: t("Purchase unit"), kind: "text" },
  ];
  const out = kept.map((r) => {
    const supplierId = meta.get(Number(r.product_id))?.supplierId ?? null;
    return {
      sku: r.sku,
      product: r.product_name,
      supplier: supplierId === null ? "" : (supplierName.get(supplierId) ?? ""),
      onHand: Number(r.on_hand),
      max: Number(r.max_total),
      onOrder: Number(r.open_request_qty),
      suggested: Number(r.suggested_base),
      purchaseQty: r.suggested_purchase_qty === null ? null : Number(r.suggested_purchase_qty),
      purchaseUom: r.purchase_uom_code ?? "",
    };
  });
  return buildResult(ctx, "suggested", t("Suggested order"), {
    columns,
    rows: out,
    truncated: rows.length >= MAX_SOURCE_ROWS,
    notes: [t("Suggested = maximum level minus what is on hand and what is already on approved requests, rounded up to whole purchase units.")],
  });
}
