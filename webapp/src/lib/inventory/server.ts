import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type CurrentUser } from "@/lib/current-user";
import { getBranches, getDemoBranchIds } from "@/lib/lookups";
import {
  isSeniorPosition,
  nextMonthStart,
  REQUEST_RECEIVABLE_STATUSES,
  type InvBarcode,
  type InvCostHint,
  type InvOpenRequest,
  type InvBranch,
  type InvCountAdjustment,
  type InvCountHeader,
  type InvCountRow,
  type InvCatalogue,
  type InvChargeRow,
  type InvExceptionRow,
  type InvPeriodRow,
  type InvCategory,
  type InvLocation,
  type InvProduct,
  type InvRank,
  type InvResident,
  type InvStaff,
  type InvSupplier,
  type InvUom,
  type LocationKind,
} from "./core";

// Server-only loaders for the Inventory pages. Every read uses the user's
// session client, so the inventory RLS (schema/008) decides the rows: a NUR
// login sees its branch, HQ sees every real NUR branch, the DEMO login only
// DEMO, a PHY login nothing. The canonical DEMO pattern is applied on top
// (CLAUDE.md) so a real login can never be offered the demo branch.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type InventoryContext = {
  account: CurrentUser;
  supabase: Supabase;
  rank: InvRank;
  isHqAdmin: boolean;
  isDemoUser: boolean;
  branches: InvBranch[]; // branches in inventory scope, with inventory enabled
  branchId: number | null; // the selected branch
};

/** null = no inventory access at all (PHY login, or migrations not applied). */
export async function getInventoryContext(branchParam?: string): Promise<InventoryContext | null> {
  const account = await getCurrentUser();
  if (!account) return null;
  const supabase = await createClient();

  const [scopeRes, rankRes, hqRes] = await Promise.all([
    supabase.rpc("inv_accessible_branch_ids"),
    supabase.rpc("inv_my_rank"),
    supabase.rpc("inv_is_hq_admin"),
  ]);
  if (scopeRes.error || !Array.isArray(scopeRes.data)) return null;
  const scope = (scopeRes.data as (number | string)[]).map(Number);
  if (scope.length === 0) return null;

  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;

  const { data: settings } = await supabase
    .from("tbl_inv_branch_settings")
    .select("branch_id, is_enabled")
    .in("branch_id", scope);
  const enabled = new Set((settings ?? []).filter((s) => s.is_enabled).map((s) => Number(s.branch_id)));
  const all = await getBranches("NUR");
  const branches = all
    .map((b) => ({ id: Number(b.id), label: b.label }))
    .filter((b) => scope.includes(b.id) && enabled.has(b.id) && !excludedBranchIds.includes(b.id));

  const wanted = Number(branchParam);
  const branchId =
    branches.find((b) => b.id === wanted)?.id ??
    branches.find((b) => b.id === account.branch_id)?.id ??
    branches[0]?.id ??
    null;

  return {
    account,
    supabase,
    rank: Math.max(0, Math.min(4, Number(rankRes.data ?? 0))) as InvRank,
    isHqAdmin: hqRes.data === true,
    isDemoUser,
    branches,
    branchId,
  };
}

/** For the sidebar: does this login have any inventory scope? */
export async function hasInventoryAccess(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_accessible_branch_ids");
  return !error && Array.isArray(data) && data.length > 0;
}

export async function loadLocations(supabase: Supabase, branchId: number): Promise<InvLocation[]> {
  const { data } = await supabase
    .from("tbl_inv_locations")
    .select("id, branch_id, kind")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("id");
  return (data ?? []).map((l) => ({ id: Number(l.id), branchId: Number(l.branch_id), kind: l.kind as LocationKind }));
}

export async function loadCatalogue(supabase: Supabase, opts: { includeInactive?: boolean } = {}): Promise<InvCatalogue> {
  let productQuery = supabase
    .from("tbl_inv_products")
    .select(
      "id, sku, name, description, category_id, is_stock_item, base_uom_id, purchase_uom_id, default_supplier_id, standard_unit_cost, is_chargeable, charge_price, default_max_store, default_max_floor, is_active, owner_branch_id, tbl_inv_product_uoms(uom_id, factor_to_base, is_active)"
    )
    .order("name")
    .limit(5000);
  if (!opts.includeInactive) productQuery = productQuery.eq("is_active", true);
  const [{ data: products }, { data: uoms }, { data: barcodes }] = await Promise.all([
    productQuery,
    supabase.from("tbl_inv_uoms").select("id, code, name, name_ms, allow_fraction").eq("is_active", true).order("code"),
    supabase
      .from("tbl_inv_product_barcodes")
      .select("id, barcode, product_id, uom_id, owner_branch_id")
      .eq("is_active", true)
      .limit(20000),
  ]);
  return {
    products: (products ?? []).map(mapProduct),
    uoms: (uoms ?? []).map(
      (u): InvUom => ({ id: Number(u.id), code: u.code, name: u.name, nameMs: u.name_ms, allowFraction: u.allow_fraction })
    ),
    barcodes: (barcodes ?? []).map(
      (b): InvBarcode => ({
        id: Number(b.id),
        barcode: b.barcode,
        productId: Number(b.product_id),
        uomId: Number(b.uom_id),
        ownerBranchId: b.owner_branch_id === null ? null : Number(b.owner_branch_id),
      })
    ),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProduct(p: any): InvProduct {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(p.id),
    sku: p.sku,
    name: p.name,
    description: p.description,
    categoryId: Number(p.category_id),
    isStockItem: p.is_stock_item,
    baseUomId: Number(p.base_uom_id),
    purchaseUomId: Number(p.purchase_uom_id),
    defaultSupplierId: num(p.default_supplier_id),
    standardUnitCost: num(p.standard_unit_cost),
    isChargeable: p.is_chargeable,
    chargePrice: num(p.charge_price),
    defaultMaxStore: num(p.default_max_store),
    defaultMaxFloor: num(p.default_max_floor),
    isActive: p.is_active,
    ownerBranchId: num(p.owner_branch_id),
    uoms: (p.tbl_inv_product_uoms ?? []).map((u: { uom_id: number; factor_to_base: number; is_active: boolean }) => ({
      uomId: Number(u.uom_id),
      factor: Number(u.factor_to_base),
      isActive: u.is_active,
    })),
  };
}

export async function loadCategories(supabase: Supabase): Promise<InvCategory[]> {
  const { data } = await supabase
    .from("tbl_inv_categories")
    .select("id, code, name, name_ms, is_service")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []).map((c) => ({ id: Number(c.id), code: c.code, name: c.name, nameMs: c.name_ms, isService: c.is_service }));
}

export async function loadSuppliers(supabase: Supabase, opts: { includeInactive?: boolean } = {}): Promise<InvSupplier[]> {
  let query = supabase
    .from("tbl_inv_suppliers")
    .select("id, name, contact_person, phone, email, address, notes, is_active, owner_branch_id")
    .order("name")
    .limit(2000);
  if (!opts.includeInactive) query = query.eq("is_active", true);
  const { data } = await query;
  return (data ?? []).map((s) => ({
    id: Number(s.id),
    name: s.name,
    contactPerson: s.contact_person,
    phone: s.phone,
    email: s.email,
    address: s.address,
    notes: s.notes,
    isActive: s.is_active,
    ownerBranchId: s.owner_branch_id === null ? null : Number(s.owner_branch_id),
  }));
}

/**
 * Performer pickers (tbl_staff — the real person, never the login).
 * Active staff of the branch, plus HQ staff for real branches (the RPC
 * accepts HQ staff anywhere except DEMO). isSenior marks who may perform
 * Head-Nurse-tier actions (fn_inv_check_staff).
 */
export async function loadStaff(supabase: Supabase, branchId: number, isDemoBranch: boolean): Promise<InvStaff[]> {
  const { data: hq } = await supabase.from("tbl_branches").select("BranchID").eq("Function", "HQ");
  const branchIds = [branchId, ...(isDemoBranch ? [] : (hq ?? []).map((b) => Number(b.BranchID)))];
  const { data } = await supabase
    .from("tbl_staff")
    .select("StaffID, staff_name, role, branch_id, tbl_positions(name)")
    .in("branch_id", branchIds)
    .eq("status", "ACTIVE")
    .order("staff_name");
  return (data ?? []).map((s) => {
    const pos = Array.isArray(s.tbl_positions) ? s.tbl_positions[0] : s.tbl_positions;
    return {
      id: String(s.StaffID),
      name: Number(s.branch_id) === branchId ? s.staff_name : `${s.staff_name} (HQ)`,
      isSenior: isSeniorPosition((pos as { name?: string } | null)?.name, s.role as string),
    };
  });
}

export async function loadResidents(supabase: Supabase, branchId: number, activeOnly = true): Promise<InvResident[]> {
  let query = supabase
    .from("tbl_residents")
    .select("id, resident_name, ResidentID, status")
    .eq("branch_id", branchId)
    .order("resident_name");
  if (activeOnly) query = query.eq("status", "ACTIVE");
  const { data } = await query;
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    name: r.resident_name,
    residentCode: r.ResidentID,
    status: r.status,
  }));
}

export async function isDemoBranch(branchId: number): Promise<boolean> {
  return (await getDemoBranchIds()).includes(branchId);
}

/**
 * Stock requests a delivery can be received against (schema/017): APPROVED /
 * ORDERED / PARTIALLY_RECEIVED with something still outstanding. Outstanding
 * comes from v_inv_request_line_progress (approved − delivered, not closed short).
 */
export async function loadOpenRequests(supabase: Supabase, branchId: number): Promise<InvOpenRequest[]> {
  const { data: reqs } = await supabase
    .from("tbl_inv_stock_requests")
    .select("id, request_no, status, external_ref, tbl_inv_stock_request_lines(supplier_id)")
    .eq("branch_id", branchId)
    .in("status", [...REQUEST_RECEIVABLE_STATUSES])
    .order("id", { ascending: false })
    .limit(100);
  const ids = (reqs ?? []).map((r) => Number(r.id));
  if (ids.length === 0) return [];
  const { data: progress } = await supabase
    .from("v_inv_request_line_progress")
    .select("request_id, product_id, outstanding_qty")
    .in("request_id", ids)
    .gt("outstanding_qty", 0);
  return (reqs ?? [])
    .map((r) => {
      const suppliers = (r.tbl_inv_stock_request_lines ?? [])
        .map((l: { supplier_id: number | null }) => l.supplier_id)
        .filter((s): s is number => s !== null);
      return {
        id: Number(r.id),
        requestNo: r.request_no as string,
        status: r.status as string,
        externalRef: (r.external_ref as string | null) ?? null,
        supplierId: suppliers.length > 0 ? Number(suppliers[0]) : null,
        lines: (progress ?? [])
          .filter((p) => Number(p.request_id) === Number(r.id))
          .map((p) => ({ productId: Number(p.product_id), outstandingBase: Number(p.outstanding_qty) })),
      };
    })
    .filter((r) => r.lines.length > 0);
}

// ----------------------------------------------------------------- stock counts (schema/018)

export async function loadCounts(supabase: Supabase, branchId: number): Promise<InvCountRow[]> {
  const { data } = await supabase
    .from("tbl_inv_counts")
    .select(
      "id, count_no, status, count_type, location_id, freeze_location, counted_by_staff, started_at, submitted_at, closed_at, tbl_inv_count_lines(count)"
    )
    .eq("branch_id", branchId)
    .order("id", { ascending: false })
    .limit(100);
  return (data ?? []).map((c) => ({
    id: Number(c.id),
    countNo: c.count_no as string,
    status: c.status as string,
    countType: c.count_type as string,
    locationId: Number(c.location_id),
    freezeLocation: c.freeze_location as boolean,
    countedByStaff: c.counted_by_staff as string,
    startedAt: (c.started_at as string | null) ?? null,
    submittedAt: (c.submitted_at as string | null) ?? null,
    closedAt: (c.closed_at as string | null) ?? null,
    lineCount: Number((c.tbl_inv_count_lines as { count: number }[] | null)?.[0]?.count ?? 0),
  }));
}

export type CountDetail = {
  header: InvCountHeader;
  lines: {
    id: number;
    productId: number;
    residentId: number | null;
    isFound: boolean;
    physical: number | null;
    expected: number | null;
    postedSince: number | null;
    variance: number | null;
    note: string | null;
  }[];
  adjustments: InvCountAdjustment[];
};

/**
 * One count with its lines. While the count is blind (IN_PROGRESS, or
 * SUBMITTED for a login that may not review) only the counted quantity is
 * selected: expected / posted-since-start / variance are never requested, so
 * the counter cannot be shown them.
 */
export async function loadCountDetail(
  supabase: Supabase,
  branchId: number,
  countId: number,
  canReview: boolean
): Promise<CountDetail | null> {
  const { data: c } = await supabase
    .from("tbl_inv_counts")
    .select(
      "id, count_no, status, count_type, location_id, freeze_location, counted_by_staff, started_at, submitted_at, closed_at, investigated_by_staff, investigation_summary"
    )
    .eq("id", countId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (!c) return null;
  const blind = c.status === "IN_PROGRESS" || (c.status === "SUBMITTED" && !canReview);
  const cols = blind
    ? "id, product_id, resident_id, is_found_item, physical_qty"
    : "id, product_id, resident_id, is_found_item, physical_qty, expected_qty, posted_since_start, variance_qty, investigation_note";
  const [{ data: lines }, { data: adj }] = await Promise.all([
    supabase.from("tbl_inv_count_lines").select(cols).eq("count_id", countId).order("id").limit(5000),
    supabase.from("tbl_inv_adjustments").select("id, adjustment_no, status").eq("count_id", countId).order("id"),
  ]);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    header: {
      id: Number(c.id),
      countNo: c.count_no as string,
      status: c.status as string,
      countType: c.count_type as string,
      locationId: Number(c.location_id),
      freezeLocation: c.freeze_location as boolean,
      countedByStaff: c.counted_by_staff as string,
      startedAt: (c.started_at as string | null) ?? null,
      submittedAt: (c.submitted_at as string | null) ?? null,
      closedAt: (c.closed_at as string | null) ?? null,
      lineCount: (lines ?? []).length,
      investigatedByStaff: (c.investigated_by_staff as string | null) ?? null,
      investigationSummary: (c.investigation_summary as string | null) ?? null,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: ((lines ?? []) as any[]).map((l) => ({
      id: Number(l.id),
      productId: Number(l.product_id),
      residentId: num(l.resident_id),
      isFound: l.is_found_item as boolean,
      physical: num(l.physical_qty),
      expected: blind ? null : num(l.expected_qty),
      postedSince: blind ? null : num(l.posted_since_start),
      variance: blind ? null : num(l.variance_qty),
      note: blind ? null : ((l.investigation_note as string | null) ?? null),
    })),
    adjustments: (adj ?? []).map((a) => ({ id: Number(a.id), adjustmentNo: a.adjustment_no as string, status: a.status as string })),
  };
}

// ----------------------------------------------------------------- charges and month-end (schema/019)

/**
 * Charges dated in a KL month (D-73: a charge belongs to the month of its own
 * date). RLS lets the branch login (rank 2) read them (D-148). Capped; a month
 * of one branch is far below the cap.
 */
export async function loadCharges(
  supabase: Supabase,
  branchId: number,
  month: string,
  residentId: number | null
): Promise<InvChargeRow[]> {
  let query = supabase
    .from("tbl_inv_charges")
    .select(
      "id, charge_date, charge_kind, target, resident_id, related_charge_id, product_name, sku, uom_code, qty_base, unit_charge_price, charge_amount, reason, created_by_staff, tbl_inv_txns(txn_no)"
    )
    .eq("branch_id", branchId)
    .gte("charge_date", `${month}-01`)
    .lt("charge_date", nextMonthStart(month))
    .order("charge_date")
    .order("id")
    .limit(5000);
  if (residentId !== null) query = query.eq("resident_id", residentId);
  const { data } = await query;
  return (data ?? []).map((c) => {
    const txn = Array.isArray(c.tbl_inv_txns) ? c.tbl_inv_txns[0] : c.tbl_inv_txns;
    return {
      id: Number(c.id),
      chargeDate: c.charge_date as string,
      kind: c.charge_kind as string,
      target: c.target as string,
      residentId: c.resident_id === null ? null : Number(c.resident_id),
      txnNo: (txn as { txn_no?: string } | null)?.txn_no ?? null,
      relatedChargeId: c.related_charge_id === null ? null : Number(c.related_charge_id),
      productName: c.product_name as string,
      sku: c.sku as string,
      uomCode: c.uom_code as string,
      qtyBase: Number(c.qty_base),
      unitPrice: c.unit_charge_price === null ? null : Number(c.unit_charge_price),
      amount: Number(c.charge_amount),
      reason: (c.reason as string | null) ?? null,
      byStaff: c.created_by_staff as string,
    };
  });
}

export async function loadPeriods(supabase: Supabase, branchId: number): Promise<InvPeriodRow[]> {
  const { data } = await supabase
    .from("tbl_inv_billing_periods")
    .select(
      "id, period_month, status, exceptions_reviewed_at, exceptions_reviewed_by_staff, locked_at, locked_by_staff, reopen_count"
    )
    .eq("branch_id", branchId)
    .order("period_month", { ascending: false })
    .limit(36);
  return (data ?? []).map((p) => ({
    id: Number(p.id),
    month: p.period_month as string,
    status: p.status as "OPEN" | "LOCKED",
    reviewedAt: (p.exceptions_reviewed_at as string | null) ?? null,
    reviewedByStaff: (p.exceptions_reviewed_by_staff as string | null) ?? null,
    lockedAt: (p.locked_at as string | null) ?? null,
    lockedByStaff: (p.locked_by_staff as string | null) ?? null,
    reopenCount: Number(p.reopen_count),
  }));
}

/**
 * Month-end exceptions of one branch (v_inv_exceptions, MODERATOR+ only).
 * Pending adjustments of earlier months block this one too, and idle Transit
 * stock is dated in the current month, so both are added to the month's rows.
 */
export async function loadExceptions(supabase: Supabase, branchId: number, month: string): Promise<InvExceptionRow[]> {
  const first = `${month}-01`;
  const { data } = await supabase
    .from("v_inv_exceptions")
    .select(
      "kind, ref_type, ref_id, reference, event_date, product_name, resident_id, qty, amount, performed_by_staff, from_branch_login, is_blocking"
    )
    .eq("branch_id", branchId)
    .or(`period_month.eq.${first},and(kind.eq.ADJUSTMENT_PENDING,period_month.lt.${first})`)
    .order("event_date")
    .limit(5000);
  return (data ?? []).map((e) => ({
    kind: e.kind as string,
    refType: e.ref_type as string,
    refId: Number(e.ref_id),
    reference: e.reference as string,
    eventDate: e.event_date as string,
    productName: (e.product_name as string | null) ?? null,
    residentId: e.resident_id === null ? null : Number(e.resident_id),
    qty: e.qty === null ? null : Number(e.qty),
    amount: e.amount === null ? null : Number(e.amount),
    staff: (e.performed_by_staff as string | null) ?? null,
    fromBranchLogin: e.from_branch_login === true,
    isBlocking: e.is_blocking === true,
  }));
}

/** resident_id → billing code for one branch (rank 3+; RLS hides it below that). */
export async function loadBillingCodes(supabase: Supabase, branchId: number): Promise<Map<number, string>> {
  const { data } = await supabase
    .from("tbl_inv_resident_billing")
    .select("resident_id, billing_code")
    .eq("branch_id", branchId)
    .limit(5000);
  return new Map((data ?? []).map((r) => [Number(r.resident_id), r.billing_code as string]));
}

/**
 * Cost hints for the Receive form (read-only): the branch's current WAC per
 * product and the cost of its last non-voided receipt, both per base unit.
 * Plain SELECTs under the caller's RLS (cost is visible from the receipt tier).
 */
export async function loadCostHints(supabase: Supabase, branchId: number): Promise<InvCostHint[]> {
  const [{ data: pools }, { data: recent }] = await Promise.all([
    supabase.from("tbl_inv_cost_pools").select("product_id, wac").eq("branch_id", branchId).limit(10000),
    supabase
      .from("tbl_inv_receipt_lines")
      .select("id, product_id, unit_cost_entered, factor_to_base, tbl_inv_receipts!inner(is_voided)")
      .eq("branch_id", branchId)
      .eq("tbl_inv_receipts.is_voided", false)
      .gt("unit_cost_entered", 0)
      .order("id", { ascending: false })
      .limit(5000),
  ]);
  const hints = new Map<number, InvCostHint>();
  for (const p of pools ?? []) {
    hints.set(Number(p.product_id), { productId: Number(p.product_id), wac: p.wac === null ? null : Number(p.wac), lastCostBase: null });
  }
  for (const l of recent ?? []) {
    const id = Number(l.product_id);
    const factor = Number(l.factor_to_base);
    const existing = hints.get(id) ?? { productId: id, wac: null, lastCostBase: null };
    if (existing.lastCostBase === null && factor > 0) {
      hints.set(id, { ...existing, lastCostBase: Number(l.unit_cost_entered) / factor });
    }
  }
  return [...hints.values()];
}
