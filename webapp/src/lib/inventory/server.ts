import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type CurrentUser } from "@/lib/current-user";
import { getBranches, getDemoBranchIds } from "@/lib/lookups";
import {
  isSeniorPosition,
  REQUEST_RECEIVABLE_STATUSES,
  type InvBarcode,
  type InvOpenRequest,
  type InvBranch,
  type InvCatalogue,
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
