import "server-only";
import {
  ADJUSTMENT_STATUS_LABELS,
  COUNT_STATUS_OPTIONS,
  DOC_TYPE_OPTIONS,
  INV_TIER,
  LOCATION_KIND_OPTIONS,
  REQUEST_STATUS_OPTIONS,
  TXN_TYPE_LABELS,
  labelOf,
} from "../core";
import {
  buildResult,
  fetchByIds,
  fetchRows,
  klDate,
  klDayEnd,
  klDayStart,
  loadProductMeta,
  loadResidentNames,
  one,
  round2,
  type ReportCtx,
} from "./report-core";
import type { ReportColumn, ReportResult, ReportRow } from "./types";

// Document reports: Receiving history, Transfers, Stock requests, Count variance.

// ----------------------------------------------------------------- Receiving history

type ReceiptRow = {
  receipt_no: string;
  received_date: string;
  supplier_name: string;
  doc_type: string;
  invoice_no: string;
  invoice_date: string;
  item_count: number;
  landed_total: number;
  is_voided: boolean;
  corrects_receipt_id: number | null;
  superseded_by_receipt_id: number | null;
  received_by_staff: string;
};

export async function loadReceivingReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, branchId, t, params } = ctx;
  const like = `%${params.q.replace(/[\\%_]/g, "\\$&")}%`;
  const receipts = await fetchRows<ReceiptRow>(() => {
    let query = sb
      .from("tbl_inv_receipts")
      .select(
        "receipt_no, received_date, supplier_name, doc_type, invoice_no, invoice_date, item_count, landed_total, is_voided, corrects_receipt_id, superseded_by_receipt_id, received_by_staff"
      )
      .eq("branch_id", branchId)
      .gte("received_date", params.from)
      .lte("received_date", params.to);
    if (params.supplier !== null) query = query.eq("supplier_id", params.supplier);
    if (params.q) query = query.ilike("invoice_no", like);
    return query.order("received_date", { ascending: false }).order("id", { ascending: false });
  }, ctx.cap + 1);

  const columns: ReportColumn[] = [
    { key: "receiptNo", label: t("Receipt no."), kind: "text" },
    { key: "received", label: t("Received"), kind: "date" },
    { key: "supplier", label: t("Supplier"), kind: "text" },
    { key: "docType", label: t("Document"), kind: "text" },
    { key: "invoiceNo", label: t("Invoice no."), kind: "text" },
    { key: "invoiceDate", label: t("Invoice date"), kind: "date" },
    { key: "lines", label: t("Lines"), kind: "int" },
    { key: "landed", label: t("Landed total (RM)"), kind: "money" },
    { key: "by", label: t("Received by"), kind: "text" },
    { key: "status", label: t("Status"), kind: "text" },
  ];
  const shown = receipts.slice(0, ctx.cap);
  const rows: ReportRow[] = shown.map((r) => ({
    receiptNo: r.receipt_no,
    received: r.received_date,
    supplier: r.supplier_name,
    docType: t(labelOf(DOC_TYPE_OPTIONS, r.doc_type)),
    invoiceNo: r.invoice_no,
    invoiceDate: r.invoice_date,
    lines: Number(r.item_count),
    landed: Number(r.landed_total),
    by: r.received_by_staff,
    status: r.is_voided ? t("Voided") : r.superseded_by_receipt_id !== null ? t("Corrected") : r.corrects_receipt_id !== null ? t("Correction") : "",
  }));
  const counted = shown.filter((r) => !r.is_voided);
  const totals: ReportRow = {
    receiptNo: t("Total (voided excluded)"),
    lines: counted.reduce((sum, r) => sum + Number(r.item_count), 0),
    landed: round2(counted.reduce((sum, r) => sum + Number(r.landed_total), 0)),
  };
  return buildResult(ctx, "receiving", t("Receiving history"), {
    columns,
    rows,
    totals,
    truncated: receipts.length > ctx.cap,
    notes: [t("A corrected receipt and its correction are both listed; the total counts every receipt that is not voided.")],
  });
}

// ----------------------------------------------------------------- Transfers

const INTERNAL_TYPES = ["INTERNAL_TRANSFER", "TRANSIT_ALLOCATE", "TRANSIT_RELEASE"];
const TRANSFER_STATUS_LABELS: Record<string, string> = { DISPATCHED: "Dispatched", RECEIVED: "Received", CANCELLED: "Cancelled" };

type InternalLine = {
  id: number;
  txn_id: number;
  txn_date: string;
  txn_type: string;
  location_kind: string;
  resident_id: number | null;
  qty_base: number;
  value: number;
  pair_line_id: number | null;
  tbl_inv_products: { name: string; sku: string } | { name: string; sku: string }[] | null;
  tbl_inv_txns: { txn_no: string } | { txn_no: string }[] | null;
};

type BranchTransfer = {
  transfer_no: string;
  status: string;
  created_at: string;
  from_branch_id: number;
  to_branch_id: number;
  tbl_inv_branch_transfer_lines: {
    qty_base: number;
    value: number;
    line_no: number;
    tbl_inv_products: { name: string; sku: string } | { name: string; sku: string }[] | null;
  }[];
};

export async function loadTransfersReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, branchId, rank, t, params } = ctx;
  const showValue = rank >= INV_TIER.VIEW_COST;
  const wantInternal = params.kind !== "branch";
  const wantBranch = params.kind !== "internal";
  const sortable: { date: string; ref: string; row: ReportRow }[] = [];
  let truncated = false;

  if (wantInternal) {
    // Each movement has an out line and an in line; the in line is the row, its pair gives the "from".
    const lines = await fetchRows<InternalLine>(
      () =>
        sb
          .from("tbl_inv_txn_lines")
          .select(
            "id, txn_id, txn_date, txn_type, location_kind, resident_id, qty_base, value, pair_line_id, tbl_inv_products(name, sku), tbl_inv_txns!inner(txn_no)"
          )
          .eq("branch_id", branchId)
          .in("txn_type", INTERNAL_TYPES)
          .gte("txn_date", params.from)
          .lte("txn_date", params.to)
          .order("txn_date", { ascending: false })
          .order("txn_id", { ascending: false })
          .order("id"),
      (ctx.cap + 1) * 2
    );
    if (lines.length >= (ctx.cap + 1) * 2) truncated = true;
    const byId = new Map(lines.map((l) => [Number(l.id), l]));
    const inLines = lines.filter((l) => Number(l.qty_base) > 0);
    const reversedIds = await fetchByIds<{ reverses_txn_id: number }>(
      sb,
      "tbl_inv_txns",
      "reverses_txn_id",
      "reverses_txn_id",
      inLines.map((l) => Number(l.txn_id))
    );
    const reversed = new Set(reversedIds.map((r) => Number(r.reverses_txn_id)));
    const residents = await loadResidentNames(sb, lines.map((l) => l.resident_id));
    for (const l of inLines) {
      const pair = l.pair_line_id === null ? undefined : byId.get(Number(l.pair_line_id));
      const product = one(l.tbl_inv_products);
      const residentId = l.resident_id ?? pair?.resident_id ?? null;
      sortable.push({
        date: l.txn_date,
        ref: one(l.tbl_inv_txns)?.txn_no ?? "",
        row: {
          date: l.txn_date,
          ref: one(l.tbl_inv_txns)?.txn_no ?? "",
          kind: t(TXN_TYPE_LABELS[l.txn_type] ?? l.txn_type),
          product: product ? `${product.name} (${product.sku})` : "",
          from: pair ? t(labelOf(LOCATION_KIND_OPTIONS, pair.location_kind)) : "",
          to: t(labelOf(LOCATION_KIND_OPTIONS, l.location_kind)),
          resident: residentId === null ? "" : (residents.get(Number(residentId)) ?? `#${residentId}`),
          qty: Number(l.qty_base),
          value: showValue ? Number(l.value) : null,
          status: reversed.has(Number(l.txn_id)) ? t("Reversed") : "",
        },
      });
    }
  }

  if (wantBranch) {
    const transfers = await fetchRows<BranchTransfer>(
      () =>
        sb
          .from("tbl_inv_branch_transfers")
          .select(
            "transfer_no, status, created_at, from_branch_id, to_branch_id, tbl_inv_branch_transfer_lines(qty_base, value, line_no, tbl_inv_products(name, sku))"
          )
          .or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`)
          .gte("created_at", klDayStart(params.from))
          .lt("created_at", klDayEnd(params.to))
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
      ctx.cap + 1
    );
    if (transfers.length > ctx.cap) truncated = true;
    const branchIds = transfers.flatMap((x) => [Number(x.from_branch_id), Number(x.to_branch_id)]);
    const names = new Map(
      (await fetchByIds<{ BranchID: number; BranchName: string }>(sb, "tbl_branches", "BranchID, BranchName", "BranchID", branchIds)).map((b) => [
        Number(b.BranchID),
        b.BranchName,
      ])
    );
    for (const x of transfers) {
      const date = klDate(x.created_at) ?? "";
      for (const l of [...x.tbl_inv_branch_transfer_lines].sort((a, b) => a.line_no - b.line_no)) {
        const product = one(l.tbl_inv_products);
        sortable.push({
          date,
          ref: x.transfer_no,
          row: {
            date,
            ref: x.transfer_no,
            kind: t("Branch transfer"),
            product: product ? `${product.name} (${product.sku})` : "",
            from: names.get(Number(x.from_branch_id)) ?? `#${x.from_branch_id}`,
            to: names.get(Number(x.to_branch_id)) ?? `#${x.to_branch_id}`,
            resident: "",
            qty: Number(l.qty_base),
            value: showValue ? Number(l.value) : null,
            status: t(TRANSFER_STATUS_LABELS[x.status] ?? x.status),
          },
        });
      }
    }
  }

  sortable.sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref));
  const columns: ReportColumn[] = [
    { key: "date", label: t("Date"), kind: "date" },
    { key: "ref", label: t("Reference"), kind: "text" },
    { key: "kind", label: t("Kind"), kind: "text" },
    { key: "product", label: t("Product"), kind: "text" },
    { key: "from", label: t("From"), kind: "text" },
    { key: "to", label: t("To"), kind: "text" },
    { key: "resident", label: t("Resident"), kind: "text" },
    { key: "qty", label: t("Qty (base unit)"), kind: "qty" },
  ];
  if (showValue) columns.push({ key: "value", label: t("Value"), kind: "money" });
  columns.push({ key: "status", label: t("Status"), kind: "text" });
  return buildResult(ctx, "transfers", t("Transfers"), { columns, rows: sortable.map((s) => s.row), truncated });
}

// ----------------------------------------------------------------- Stock requests

type RequestRow = {
  id: number;
  request_no: string;
  status: string;
  created_at: string;
  external_ref: string | null;
  tbl_inv_stock_request_lines: {
    id: number;
    requested_qty: number;
    approved_qty: number | null;
    closed_short_at: string | null;
    tbl_inv_products: { name: string; sku: string } | { name: string; sku: string }[] | null;
  }[];
};

export async function loadRequestsReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, branchId, t, params } = ctx;
  const requests = await fetchRows<RequestRow>(() => {
    let query = sb
      .from("tbl_inv_stock_requests")
      .select(
        "id, request_no, status, created_at, external_ref, tbl_inv_stock_request_lines(id, requested_qty, approved_qty, closed_short_at, tbl_inv_products(name, sku))"
      )
      .eq("branch_id", branchId)
      .gte("created_at", klDayStart(params.from))
      .lt("created_at", klDayEnd(params.to));
    if (params.reqstatus) query = query.eq("status", params.reqstatus);
    return query.order("created_at", { ascending: false }).order("id", { ascending: false });
  }, ctx.cap + 1);
  const progress = await fetchByIds<{ line_id: number; received_qty: number; outstanding_qty: number }>(
    sb,
    "v_inv_request_line_progress",
    "request_id, line_id, received_qty, outstanding_qty",
    "request_id",
    requests.map((r) => Number(r.id))
  );
  const byLine = new Map(progress.map((p) => [Number(p.line_id), p]));

  const rows: ReportRow[] = [];
  for (const r of requests) {
    for (const l of [...r.tbl_inv_stock_request_lines].sort((a, b) => a.id - b.id)) {
      const product = one(l.tbl_inv_products);
      const p = byLine.get(Number(l.id));
      rows.push({
        requestNo: r.request_no,
        date: klDate(r.created_at),
        status: t(labelOf(REQUEST_STATUS_OPTIONS, r.status)),
        ref: r.external_ref ?? "",
        product: product ? `${product.name} (${product.sku})` : "",
        requested: Number(l.requested_qty),
        approved: l.approved_qty === null ? null : Number(l.approved_qty),
        received: p ? Number(p.received_qty) : null,
        outstanding: p ? Number(p.outstanding_qty) : null,
        closedShort: l.closed_short_at ? t("Closed short") : "",
      });
    }
  }
  const columns: ReportColumn[] = [
    { key: "requestNo", label: t("Request no."), kind: "text" },
    { key: "date", label: t("Date"), kind: "date" },
    { key: "status", label: t("Status"), kind: "text" },
    { key: "ref", label: t("Order reference"), kind: "text" },
    { key: "product", label: t("Product"), kind: "text" },
    { key: "requested", label: t("Requested"), kind: "qty" },
    { key: "approved", label: t("Approved"), kind: "qty" },
    { key: "received", label: t("Received"), kind: "qty" },
    { key: "outstanding", label: t("Outstanding"), kind: "qty" },
    { key: "closedShort", label: t("Closed short"), kind: "text" },
  ];
  return buildResult(ctx, "requests", t("Stock requests"), {
    columns,
    rows,
    truncated: requests.length > ctx.cap,
    notes: [t("Quantities are in the base unit of each product.")],
  });
}

// ----------------------------------------------------------------- Count variance

type CountRow = {
  id: number;
  count_no: string;
  status: string;
  submitted_at: string | null;
  tbl_inv_locations: { kind: string } | { kind: string }[] | null;
};
type CountLineRow = {
  id: number;
  count_id: number;
  product_id: number;
  resident_id: number | null;
  is_found_item: boolean;
  expected_qty: number | null;
  posted_since_start: number | null;
  physical_qty: number | null;
  variance_qty: number | null;
};
type AdjustmentRow = {
  adjustment_no: string;
  status: string;
  count_id: number;
  tbl_inv_adjustment_lines: { count_line_id: number | null }[];
};

const MAX_COUNTS = 200;

/**
 * Submitted and closed counts only. A SUBMITTED count is still blind to a
 * caller below the Count-Investigate tier (same rule as the count page), so
 * expected, posted-since-start and variance are left empty for them.
 */
export async function loadCountsReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, branchId, rank, t, params } = ctx;
  const canSeeExpected = rank >= INV_TIER.COUNT_INVESTIGATE;
  const locationSelect = params.location ? "tbl_inv_locations!inner(kind)" : "tbl_inv_locations(kind)";
  const counts = await fetchRows<CountRow>(() => {
    let query = sb
      .from("tbl_inv_counts")
      .select(`id, count_no, status, submitted_at, ${locationSelect}`)
      .eq("branch_id", branchId)
      .in("status", ["SUBMITTED", "CLOSED"])
      .gte("submitted_at", klDayStart(params.from))
      .lt("submitted_at", klDayEnd(params.to));
    if (params.location) query = query.eq("tbl_inv_locations.kind", params.location);
    return query.order("submitted_at", { ascending: false }).order("id", { ascending: false });
  }, MAX_COUNTS);
  const countIds = counts.map((c) => Number(c.id));
  const [lines, adjustments, meta] = await Promise.all([
    fetchByIds<CountLineRow>(
      sb,
      "tbl_inv_count_lines",
      "id, count_id, product_id, resident_id, is_found_item, expected_qty, posted_since_start, physical_qty, variance_qty",
      "count_id",
      countIds
    ),
    fetchByIds<AdjustmentRow>(
      sb,
      "tbl_inv_adjustments",
      "adjustment_no, status, count_id, tbl_inv_adjustment_lines(count_line_id)",
      "count_id",
      countIds
    ),
    loadProductMeta(sb),
  ]);
  const residents = await loadResidentNames(sb, lines.map((l) => l.resident_id));
  const adjustmentOfLine = new Map<number, AdjustmentRow>();
  for (const a of adjustments) {
    for (const al of a.tbl_inv_adjustment_lines) {
      if (al.count_line_id !== null) adjustmentOfLine.set(Number(al.count_line_id), a);
    }
  }
  const linesOf = new Map<number, CountLineRow[]>();
  for (const l of lines) linesOf.set(Number(l.count_id), [...(linesOf.get(Number(l.count_id)) ?? []), l]);

  const rows: ReportRow[] = [];
  for (const c of counts) {
    const blind = c.status === "SUBMITTED" && !canSeeExpected;
    for (const l of (linesOf.get(Number(c.id)) ?? []).sort((a, b) => a.id - b.id)) {
      const variance = l.variance_qty === null ? null : Number(l.variance_qty);
      if (params.only === "variance" && (blind || variance === null || variance === 0)) continue;
      const product = meta.get(Number(l.product_id));
      const adj = adjustmentOfLine.get(Number(l.id));
      rows.push({
        countNo: c.count_no,
        date: klDate(c.submitted_at),
        location: t(labelOf(LOCATION_KIND_OPTIONS, one(c.tbl_inv_locations)?.kind)),
        status: t(labelOf(COUNT_STATUS_OPTIONS, c.status)),
        product: product ? `${product.name} (${product.sku})${l.is_found_item ? ` - ${t("found item")}` : ""}` : `#${l.product_id}`,
        resident: l.resident_id === null ? "" : (residents.get(Number(l.resident_id)) ?? `#${l.resident_id}`),
        expected: blind || l.expected_qty === null ? null : Number(l.expected_qty),
        posted: blind || l.posted_since_start === null ? null : Number(l.posted_since_start),
        physical: l.physical_qty === null ? null : Number(l.physical_qty),
        variance: blind ? null : variance,
        adjustment: adj ? `${adj.adjustment_no} (${t(ADJUSTMENT_STATUS_LABELS[adj.status] ?? adj.status)})` : "",
      });
    }
  }
  const columns: ReportColumn[] = [
    { key: "countNo", label: t("Count no."), kind: "text" },
    { key: "date", label: t("Submitted"), kind: "date" },
    { key: "location", label: t("Location"), kind: "text" },
    { key: "status", label: t("Status"), kind: "text" },
    { key: "product", label: t("Product"), kind: "text" },
    { key: "resident", label: t("Resident"), kind: "text" },
    { key: "expected", label: t("Expected"), kind: "qty" },
    { key: "posted", label: t("Posted since start"), kind: "qty" },
    { key: "physical", label: t("Physical"), kind: "qty" },
    { key: "variance", label: t("Variance"), kind: "qty" },
    { key: "adjustment", label: t("Adjustment"), kind: "text" },
  ];
  const notes = [t("Only submitted and closed counts are listed. Quantities are in the base unit of each product.")];
  if (!canSeeExpected) notes.push(t("Expected quantity and variance stay hidden for a count that is still awaiting review."));
  return buildResult(ctx, "counts", t("Count variance"), {
    columns,
    rows,
    truncated: counts.length >= MAX_COUNTS,
    notes,
  });
}
