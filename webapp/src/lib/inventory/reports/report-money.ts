import "server-only";
import { CHARGE_KIND_OPTIONS, currentMonthKL, groupCharges, labelOf, type InvChargeLine } from "../core";
import { loadCharges, loadResidents } from "../server";
import { buildResult, fetchRows, loadProductMeta, round2, round4, type ReportCtx } from "./report-core";
import type { ReportColumn, ReportResult, ReportRow } from "./types";

// Money reports: Valuation, Resident charges, OSEM operational expense.

const MAX_SOURCE_ROWS = 20000;

// ----------------------------------------------------------------- Valuation

type PoolRow = { product_id: number; qty: number; value: number; wac: number | null };
type ClosingRow = { product_id: number; qty: number; value: number; in_transit_transfer_id: number | null };

/**
 * Stock value per product from the cost pools (one pool per branch and
 * product, all locations together), and optionally as of the end of a locked
 * month from the latest closing snapshot of that month. Totals are summed from
 * the pools / the closing rows themselves, never from the per-bucket
 * v_inv_stock_balance value (that view repeats the pool WAC per bucket).
 */
export async function loadValuationReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, branchId, t, params } = ctx;
  const [pools, meta] = await Promise.all([
    fetchRows<PoolRow>(() => sb.from("tbl_inv_cost_pools").select("product_id, qty, value, wac").eq("branch_id", branchId).order("product_id"), MAX_SOURCE_ROWS),
    loadProductMeta(sb),
  ]);

  const notes: string[] = [];
  let closing: Map<number, { qty: number; value: number }> | null = null;
  let inTransitTotal = 0;
  if (params.month) {
    const { data: period, error } = await sb
      .from("tbl_inv_billing_periods")
      .select("id, status")
      .eq("branch_id", branchId)
      .eq("period_month", `${params.month}-01`)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!period || period.status !== "LOCKED") {
      notes.push(t("That month is not locked, so there is no month-end figure. Only the current value is shown."));
    } else {
      const { data: latest, error: seqError } = await sb
        .from("tbl_inv_period_closing")
        .select("lock_seq")
        .eq("billing_period_id", period.id)
        .order("lock_seq", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (seqError) throw new Error(seqError.message);
      if (latest) {
        const rows = await fetchRows<ClosingRow>(
          () =>
            sb
              .from("tbl_inv_period_closing")
              .select("product_id, qty, value, in_transit_transfer_id")
              .eq("billing_period_id", period.id)
              .eq("lock_seq", latest.lock_seq)
              .is("location_id", null)
              .order("product_id"),
          MAX_SOURCE_ROWS
        );
        closing = new Map();
        for (const r of rows) {
          if (r.in_transit_transfer_id !== null) {
            inTransitTotal += Number(r.value);
            continue;
          }
          closing.set(Number(r.product_id), { qty: Number(r.qty), value: Number(r.value) });
        }
      }
    }
  }

  const current = new Map(pools.filter((p) => Number(p.qty) !== 0 || Number(p.value) !== 0).map((p) => [Number(p.product_id), p]));
  const ids = [...new Set([...current.keys(), ...(closing ? [...closing.keys()] : [])])];
  ids.sort((a, b) => (meta.get(a)?.name ?? "").localeCompare(meta.get(b)?.name ?? "") || a - b);

  const columns: ReportColumn[] = [
    { key: "sku", label: t("SKU"), kind: "text" },
    { key: "product", label: t("Product"), kind: "text" },
    { key: "qty", label: t("Qty (base unit)"), kind: "qty" },
    { key: "wac", label: t("WAC"), kind: "money4" },
    { key: "value", label: t("Value (RM)"), kind: "money" },
    { key: "flag", label: t("Cost"), kind: "text" },
  ];
  if (closing) {
    columns.push({ key: "closeQty", label: t("Qty at month end"), kind: "qty" }, { key: "closeValue", label: t("Value at month end (RM)"), kind: "money" });
  }
  const rows: ReportRow[] = ids.map((id) => {
    const p = current.get(id);
    const c = closing?.get(id);
    const unknown = p !== undefined && p.wac === null && Number(p.qty) !== 0;
    return {
      sku: meta.get(id)?.sku ?? "",
      product: meta.get(id)?.name ?? `#${id}`,
      qty: p ? Number(p.qty) : 0,
      wac: p && p.wac !== null ? Number(p.wac) : null,
      value: p ? Number(p.value) : 0,
      flag: unknown ? t("Unknown cost") : "",
      closeQty: c ? c.qty : null,
      closeValue: c ? c.value : null,
    };
  });
  const totals: ReportRow = {
    sku: t("Total"),
    value: round2([...current.values()].reduce((sum, p) => sum + Number(p.value), 0)),
  };
  if (closing) totals.closeValue = round2([...closing.values()].reduce((sum, c) => sum + c.value, 0));
  notes.push(t("Totals are the sum of the cost pools, one per product for the whole branch (Store, Floor and Transit together)."));
  if (closing && inTransitTotal !== 0) {
    notes.push(t("Not included above: goods still in transit to another branch at month end, RM {amount}.", { amount: round2(inTransitTotal).toFixed(2) }));
  }
  if (rows.some((r) => r.flag)) notes.push(t("Unknown cost: no cost is known yet for this stock, so its value is not reliable until a costed receipt arrives."));
  return buildResult(ctx, "valuation", t("Valuation"), { columns, rows, totals, truncated: pools.length >= MAX_SOURCE_ROWS, notes });
}

// ----------------------------------------------------------------- Resident charges

/**
 * Resident charges of one month with effective amounts (an original line plus
 * its pricing, credits, reversals: D-121). Summary = one row per resident;
 * line by line = one row per original charge line.
 */
export async function loadChargesReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, branchId, t, params } = ctx;
  const month = params.month || currentMonthKL();
  const [charges, residents] = await Promise.all([loadCharges(sb, branchId, month, null), loadResidents(sb, branchId, false)]);
  const resident = new Map(residents.map((r) => [r.id, r]));
  const rowsOfResidents = charges.filter((c) => c.target === "RESIDENT" && c.residentId !== null);
  const lines = groupCharges(rowsOfResidents);
  const roots = lines.filter((l) => !l.isChild);
  const grandTotal = round2(rowsOfResidents.reduce((sum, c) => sum + c.amount, 0));
  const name = (id: number | null) => (id === null ? "" : (resident.get(id)?.name ?? `#${id}`));

  if (params.view === "lines") {
    const columns: ReportColumn[] = [
      { key: "resident", label: t("Resident"), kind: "text" },
      { key: "date", label: t("Date"), kind: "date" },
      { key: "txnNo", label: t("Txn no."), kind: "text" },
      { key: "sku", label: t("SKU"), kind: "text" },
      { key: "product", label: t("Product"), kind: "text" },
      { key: "kind", label: t("Kind"), kind: "text" },
      { key: "qty", label: t("Qty (base unit)"), kind: "qty" },
      { key: "price", label: t("Unit price"), kind: "money4" },
      { key: "original", label: t("Original amount (RM)"), kind: "money" },
      { key: "effective", label: t("Effective amount (RM)"), kind: "money" },
      { key: "status", label: t("Status"), kind: "text" },
    ];
    const sorted = [...roots].sort((a, b) => name(a.residentId).localeCompare(name(b.residentId)) || a.chargeDate.localeCompare(b.chargeDate) || a.id - b.id);
    const rows = sorted.map((l: InvChargeLine) => ({
      resident: name(l.residentId),
      date: l.chargeDate,
      txnNo: l.txnNo ?? "",
      sku: l.sku,
      product: l.productName,
      kind: t(labelOf(CHARGE_KIND_OPTIONS, l.kind)),
      qty: l.qtyBase,
      price: l.unitPrice,
      original: l.amount,
      effective: l.effective,
      status: l.isReversed ? t("Reversed") : l.isPricePending ? t("Price pending") : "",
    }));
    return buildResult(ctx, "charges", t("Resident charges"), {
      columns,
      rows,
      totals: { resident: t("Total"), effective: grandTotal },
      notes: [t("Effective amount = the original charge plus its pricing, return credits and reversals.")],
    });
  }

  const byResident = new Map<number, { lines: number; pending: number; total: number }>();
  for (const c of rowsOfResidents) {
    const id = c.residentId as number;
    const cur = byResident.get(id) ?? { lines: 0, pending: 0, total: 0 };
    byResident.set(id, { ...cur, total: cur.total + c.amount });
  }
  for (const l of roots) {
    const id = l.residentId as number;
    const cur = byResident.get(id);
    if (cur) byResident.set(id, { ...cur, lines: cur.lines + 1, pending: cur.pending + (l.isPricePending ? 1 : 0) });
  }
  const columns: ReportColumn[] = [
    { key: "resident", label: t("Resident"), kind: "text" },
    { key: "code", label: t("Resident ID"), kind: "text" },
    { key: "lines", label: t("Charge lines"), kind: "int" },
    { key: "pending", label: t("Waiting for a price"), kind: "int" },
    { key: "total", label: t("Total (RM)"), kind: "money" },
  ];
  const rows = [...byResident.entries()]
    .sort((a, b) => name(a[0]).localeCompare(name(b[0])))
    .map(([id, v]) => ({
      resident: name(id),
      code: resident.get(id)?.residentCode ?? "",
      lines: v.lines,
      pending: v.pending,
      total: round2(v.total),
    }));
  return buildResult(ctx, "charges", t("Resident charges"), {
    columns,
    rows,
    totals: { resident: t("Total"), lines: rows.reduce((s, r) => s + Number(r.lines), 0), total: grandTotal },
    notes: [t("Totals include pricing, return credits, reversals and manual adjustments of the month.")],
  });
}

// ----------------------------------------------------------------- OSEM operational expense

type ExpenseRow = {
  charge_date: string;
  charge_kind: string;
  product_id: number | null;
  product_name: string;
  sku: string;
  uom_code: string;
  qty_base: number;
  cost_amount: number;
  expense_note: string | null;
};

/**
 * Stock issued as an OSEM operational expense (no resident charge), valued at
 * the cost recorded when it left. Returns and reversals are negative rows, so
 * every total is net.
 */
export async function loadExpenseReport(ctx: ReportCtx): Promise<ReportResult> {
  const { sb, branchId, t, params } = ctx;
  const source = await fetchRows<ExpenseRow>(
    () =>
      sb
        .from("tbl_inv_charges")
        .select("charge_date, charge_kind, product_id, product_name, sku, uom_code, qty_base, cost_amount, expense_note")
        .eq("branch_id", branchId)
        .eq("target", "OSEM_EXPENSE")
        .gte("charge_date", params.from)
        .lte("charge_date", params.to)
        .order("charge_date")
        .order("id"),
    MAX_SOURCE_ROWS
  );
  const totalCost = round4(source.reduce((sum, r) => sum + Number(r.cost_amount), 0));
  const notes = [
    t("Cost amounts are at the cost recorded when the stock left. Returns and reversals are negative, so totals are net."),
    t("Quantities are in the base unit of each product."),
  ];

  if (params.view === "lines") {
    const columns: ReportColumn[] = [
      { key: "date", label: t("Date"), kind: "date" },
      { key: "kind", label: t("Kind"), kind: "text" },
      { key: "sku", label: t("SKU"), kind: "text" },
      { key: "product", label: t("Product"), kind: "text" },
      { key: "qty", label: t("Qty (base unit)"), kind: "qty" },
      { key: "uom", label: t("UOM"), kind: "text" },
      { key: "cost", label: t("Cost (RM)"), kind: "money" },
      { key: "note", label: t("Note"), kind: "text" },
    ];
    const rows = source.map((r) => ({
      date: r.charge_date,
      kind: t(labelOf(CHARGE_KIND_OPTIONS, r.charge_kind)),
      sku: r.sku,
      product: r.product_name,
      qty: Number(r.qty_base),
      uom: r.uom_code,
      cost: Number(r.cost_amount),
      note: r.expense_note ?? "",
    }));
    return buildResult(ctx, "expense", t("OSEM operational expense"), {
      columns,
      rows,
      totals: { date: t("Total"), cost: round2(totalCost) },
      truncated: source.length >= MAX_SOURCE_ROWS,
      notes,
    });
  }

  const groups = new Map<string, { month: string; sku: string; product: string; qty: number; cost: number }>();
  for (const r of source) {
    const month = r.charge_date.slice(0, 7);
    const key = `${month}|${r.sku}|${r.product_name}`;
    const cur = groups.get(key) ?? { month, sku: r.sku, product: r.product_name, qty: 0, cost: 0 };
    groups.set(key, { ...cur, qty: cur.qty + Number(r.qty_base), cost: cur.cost + Number(r.cost_amount) });
  }
  const columns: ReportColumn[] = [
    { key: "month", label: t("Month"), kind: "text" },
    { key: "sku", label: t("SKU"), kind: "text" },
    { key: "product", label: t("Product"), kind: "text" },
    { key: "qty", label: t("Qty (base unit)"), kind: "qty" },
    { key: "cost", label: t("Cost (RM)"), kind: "money" },
  ];
  const rows = [...groups.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.product.localeCompare(b.product))
    .map((g) => ({ month: g.month, sku: g.sku, product: g.product, qty: round4(g.qty), cost: round2(g.cost) }));
  return buildResult(ctx, "expense", t("OSEM operational expense"), {
    columns,
    rows,
    totals: { month: t("Total"), cost: round2(totalCost) },
    truncated: source.length >= MAX_SOURCE_ROWS,
    notes,
  });
}
