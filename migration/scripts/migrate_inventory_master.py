"""
Migrate the OSEM inventory master + Store/Floor stock configuration from
OSEM_Inventory_Master_Import_Ready_v2.xlsx into the Supabase inventory tables
(schema/007_inventory_schema.sql).

IMPORTANT -- why this generates SQL instead of writing directly:
the inventory tables deliberately grant NOTHING to service_role (D-146;
schema/013_inventory_grants.sql revokes all and grants only SELECT to
`authenticated`, leaving RLS to decide rows). A service-role HTTP client
therefore cannot insert inventory master data at all. The sanctioned write path
is the Supabase SQL editor running as `postgres`, so this script's job is to
emit one correct, idempotent, reviewable .sql file for you to run there.

Scope:
  * tbl_inv_suppliers          resolved/created from the workbook DefaultSupplier
  * tbl_inv_products           566 global master products (owner_branch_id NULL)
  * tbl_inv_product_uoms       EA -> factor 1 for every product
  * tbl_inv_product_barcodes   the source barcode per product
  * tbl_inv_stock_levels       Store/Floor max_qty configuration ONLY

Explicitly NOT migrated: QuantityInStock, QtyToOrder, current balances, opening
balances, stock-movement history. No tbl_inv_txns / balances / cost-pool /
period-closing / charges row is created. The emitted SQL deletes nothing and
truncates nothing.

Idempotent: every insert is guarded, so a partially-applied run can be re-run.

Usage:
    # 1. snapshot the reference ids the workbook resolves against (read-only)
    migrate_inventory_master.py --capture-reference

    # 2. emit the migration SQL (offline, deterministic)
    migrate_inventory_master.py --emit-sql migration/scripts/migrate_inventory_master_apply.sql

    # 3. paste the emitted SQL into the Supabase SQL editor and run as postgres
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import openpyxl
import requests
from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[2]
load_dotenv(REPO / "webapp" / ".env.local")

WORKBOOK = REPO / "OSEM_Inventory_Master_Import_Ready_v2.xlsx"

# created_by_account is NOT NULL with no default. Use the HQ ADMIN account
# (id 2, "OSEM HQ") so the audit trail names a real migration actor.
DEFAULT_MIGRATION_ACCOUNT = 2

# ---------------------------------------------------------------------------
# Exceptions, agreed with the operator before any write.
# ---------------------------------------------------------------------------

# Barcode '11' violates the global constraint barcode ~ '^[\x21-\x7E]{3,64}$'.
# Not padded, and the constraint is not weakened: the product is still imported
# (SKU '11' is a valid sku) but gets no scannable barcode row.
#
# In Stock_Levels_Import but in no Products_Import row, so there is no product
# to attach a level to. Creating one would mean inventing a name and category.
ORPHAN_STOCK_BARCODES = {"710497038331"}

# Access "no supplier" / internal-branch placeholders, not trading companies.
# They map to NULL rather than to a permanent supplier record, because master
# data here can be deactivated but never deleted (fn_inv_block_delete).
NULL_SUPPLIERS = {
    "alma", "cmef", "from pt discas", "jasper", "kota permai", "osem bagan",
    "patient discharge", "pharmacy", "supplier", "jetpharma sdn bhd",
}

# Misspellings / abbreviations / one company under two spellings. Merged so
# tbl_inv_suppliers does not gain permanent near-duplicates.
SUPPLIER_ALIASES = {
    "HTM": "HTM PHARMACY",
    "HTM PHARMACY BM": "HTM PHARMACY",
    "ALPRO": "ALPRO PHARMACY",
    "TYY": "TEOH YING YING",
    "TEEPHAM MEDICAL SDN.BHD.": "TEEPHARM MEDICAL SDN.BHD.",
    "PHAMARCY": "PHARMACY (GENERIC)",
    "GEORGETOWN REALCARE PHARMACY": "GEORGETOWN REALCARE PHARMACY SDN BHD",
}

SERVICE_CATEGORY_CODE = "SERVICE"
SKU_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,40}")
BARCODE_PATTERN = re.compile(r"[\x21-\x7E]{3,64}")


def name_key(name: str) -> str:
    """Mirror the generated column tbl_inv_suppliers.name_key."""
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def clean_supplier(raw):
    """Access supplier text -> a canonical supplier name, or None for placeholders."""
    if raw is None:
        return None
    name = str(raw).strip()
    if not name:
        return None
    if name_key(name) in NULL_SUPPLIERS:
        return None
    return SUPPLIER_ALIASES.get(name, SUPPLIER_ALIASES.get(name_key(name), name))


def num_or_none(v):
    if v is None or v == "":
        return None
    return float(v)


def read_workbook():
    wb = openpyxl.load_workbook(WORKBOOK, read_only=True, data_only=True)

    def sheet(name):
        ws = wb[name]
        it = ws.iter_rows(values_only=True)
        hdr = list(next(it))
        return [dict(zip(hdr, r)) for r in it]

    return sheet("Products_Import"), sheet("Stock_Levels_Import")


# ---------------------------------------------------------------------------
# Reference snapshot
# ---------------------------------------------------------------------------

def capture_reference(out_path: Path):
    """Snapshot the ids the workbook resolves against. Read-only."""
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def get(table, **params):
        r = requests.get(f"{url}/rest/v1/{table}", headers=headers,
                         params=params, timeout=60)
        if r.status_code >= 400:
            sys.exit(f"FATAL: cannot read {table}: {r.status_code} {r.text[:400]}")
        return r.json()

    ref = {
        "captured_from": url,
        "categories": {c["code"]: int(c["id"])
                       for c in get("tbl_inv_categories", select="id,code", is_active="is.true")},
        "uoms": {u["code"]: int(u["id"])
                 for u in get("tbl_inv_uoms", select="id,code", is_active="is.true")},
        "suppliers": {name_key(s["name"]): int(s["id"])
                      for s in get("tbl_inv_suppliers", select="id,name,owner_branch_id")
                      if s["owner_branch_id"] is None},
        "branches": {b["BranchCode"]: int(b["BranchID"])
                     for b in get("tbl_branches", select="BranchID,BranchCode")},
        "locations": {f"{int(l['branch_id'])}|{l['kind']}": int(l["id"])
                      for l in get("tbl_inv_locations", select="id,branch_id,kind,is_active")
                      if l["is_active"]},
    }
    out_path.write_text(json.dumps(ref, indent=2), encoding="utf-8")
    print(f"wrote {out_path}")
    print(json.dumps({k: (len(v) if isinstance(v, dict) else v)
                      for k, v in ref.items() if k != "captured_from"}, indent=2))


def load_reference_json(path: Path):
    if not path.exists():
        sys.exit(f"FATAL: {path.name} not found. Create it first with --capture-reference.")
    raw = json.loads(path.read_text(encoding="utf-8"))
    return (raw["categories"], raw["uoms"], raw["suppliers"], raw["branches"], raw["locations"])


# ---------------------------------------------------------------------------
# Plan (pure: workbook + reference snapshot -> rows, no DB access)
# ---------------------------------------------------------------------------

def build_plan(products, stock_levels, ref, account_id):
    cats, uoms, suppliers, branches, locations = ref

    missing = sorted({p["CategoryCode"] for p in products} - set(cats))
    if missing:
        sys.exit(f"FATAL: workbook categories absent from tbl_inv_categories: {missing}")
    if "EA" not in uoms:
        sys.exit("FATAL: UOM 'EA' missing; apply schema/012_inventory_seed.sql first")

    wanted = {clean_supplier(p["DefaultSupplier"]) for p in products}
    wanted.discard(None)
    new_suppliers = sorted(n for n in wanted if name_key(n) not in suppliers)

    supplier_name_by_sku = {str(p["SKU"]).strip(): clean_supplier(p["DefaultSupplier"])
                            for p in products}

    product_rows, skipped_products, notes = [], [], []
    for p in products:
        sku, bc = str(p["SKU"]).strip(), str(p["Barcode"]).strip()
        if not SKU_PATTERN.fullmatch(sku):
            skipped_products.append({"sku": sku, "reason": "SKU violates the tbl_inv_products.sku check"})
            continue
        cat = p["CategoryCode"]
        is_service = cat == SERVICE_CATEGORY_CODE
        # D-137: is_stock_item must be the exact opposite of category.is_service.
        if bool(p["IsStockItem"]) == is_service:
            skipped_products.append({"sku": sku, "reason": "IsStockItem contradicts category.is_service (D-137)"})
            continue
        product_rows.append({
            "sku": sku,
            "barcode": bc,
            "name": str(p["ProductName"]).strip()[:160],
            "description": str(p["Description"]).strip()[:1000] if p["Description"] else None,
            "category_code": cat,
            "supplier_name": supplier_name_by_sku[sku],
            "standard_unit_cost": num_or_none(p["StandardUnitCost"]),
            "charge_price": num_or_none(p["ChargePrice"]),
            "is_chargeable": bool(p["IsChargeable"]),
            "is_active": bool(p["IsActive"]),
        })
        if not BARCODE_PATTERN.fullmatch(bc):
            notes.append(
                f"barcode {bc!r} (SKU {sku}) is shorter than the 3-char constraint: "
                f"product imported with no scannable barcode row. Value not padded; "
                f"constraint not weakened.")

    planned_skus = {r["sku"] for r in product_rows}
    level_rows, skipped_levels = [], []
    for s in stock_levels:
        branch, kind, bc = s["BranchCode"], s["LocationKind"], str(s["Barcode"]).strip()
        row_sku = str(s["SKU"]).strip() if s["SKU"] else bc
        loc = locations.get(f"{branches.get(branch, -1)}|{kind}")
        why = None
        if bc in ORPHAN_STOCK_BARCODES:
            why = "barcode has no product in Products_Import (workbook has no name/SKU for it)"
        elif loc is None:
            why = f"branch {branch} has no active {kind} location"
        elif row_sku in {r["sku"] for r in product_rows if r["category_code"] == SERVICE_CATEGORY_CODE}:
            why = "SERVICE category: no Store/Floor max level (D-137)"
        elif row_sku not in planned_skus:
            why = "SKU did not resolve to an imported product"
        if why:
            skipped_levels.append({"row": f"{branch}/{kind}/{bc}", "reason": why})
            continue
        level_rows.append({"sku": row_sku, "branch_code": branch, "kind": kind,
                           "max_qty": num_or_none(s["MaxQty"]) or 0})

    return {
        "supplier_rows": new_suppliers,
        "product_rows": product_rows,
        "level_rows": level_rows,
        "barcode_rows": [(r["barcode"], r["sku"]) for r in product_rows
                         if BARCODE_PATTERN.fullmatch(r["barcode"])],
        "skipped_products": skipped_products,
        "skipped_levels": skipped_levels,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# SQL emission
# ---------------------------------------------------------------------------

def q(value) -> str:
    """Quote a value as a SQL literal. None -> NULL."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def values_block(rows, indent="           "):
    return ",\n".join(indent + r for r in rows)


def write_sql(path: Path, plan, account_id: int):
    L = []
    add = L.append
    add("-- ============================================================================")
    add("-- OSEM Inventory Master Migration")
    add("--")
    add("--   Source : OSEM_Inventory_Master_Import_Ready_v2.xlsx")
    add("--            Products_Import, Stock_Levels_Import")
    add("--   Run    : Supabase SQL editor AS POSTGRES")
    add("--")
    add("--   service_role has NO privileges on any tbl_inv_* table (D-146,")
    add("--   schema/013_inventory_grants.sql) -- this must run as postgres.")
    add("--")
    add("--   Idempotent: every insert is guarded, so a partially-applied run can be")
    add("--   re-run. This script deletes nothing and truncates nothing.")
    add("--")
    add("--   NOT migrated: QuantityInStock, QtyToOrder, current balances, opening")
    add("--   balances, stock-movement history. No ledger row is created.")
    add("--")
    add("--   GENERATED FILE -- regenerate rather than editing:")
    add("--     python migration/scripts/migrate_inventory_master.py \\")
    add("--         --emit-sql migration/scripts/migrate_inventory_master_apply.sql")
    add("-- ============================================================================")
    add("")
    add("begin;")
    add("set constraints all deferred;")
    add("")

    add("-- 1. Suppliers.")
    add("--    Placeholder Access values (ALMA, OSEM BAGAN, PATIENT DISCHARGE, ...)")
    add("--    are deliberately NOT created: they are not trading companies, and")
    add("--    master data here can only be deactivated, never deleted, so a junk")
    add("--    supplier would be permanent. Those products get NULL and can be")
    add("--    assigned later in the UI.")
    add("--    Aliases merged: HTM/HTM PHARMACY BM -> HTM PHARMACY, ALPRO ->")
    add("--    ALPRO PHARMACY, TYY -> TEOH YING YING, TEEPHAM -> TEEPHARM,")
    add("--    GEORGETOWN REALCARE PHARMACY -> ... SDN BHD.")
    add("insert into public.tbl_inv_suppliers (name, owner_branch_id, is_active, created_by_account, notes)")
    add("select v.name, null, true,")
    add(f"       {account_id},")
    add("       'Created by inventory master migration (Access ProductList default supplier)'")
    add("from (values")
    add(values_block([f"({q(n)})" for n in plan["supplier_rows"]]))
    add("     ) as v(name)")
    add("where not exists (")
    add("  select 1 from public.tbl_inv_suppliers s")
    add("   where s.owner_branch_id is null")
    add("     and s.name_key = lower(regexp_replace(btrim(v.name), '\\s+', ' ', 'g'))")
    add(");")
    add("")

    add("-- 2. Products: the global master. owner_branch_id is NULL -- real OSEM")
    add("--    products are org-wide and only DEMO data is branch-owned (D-102).")
    add("--    SKU is the exact source barcode. is_stock_item is the exact opposite")
    add("--    of category.is_service (D-137). default_max_store/floor stay NULL:")
    add("--    every real location gets an explicit tbl_inv_stock_levels row, so the")
    add("--    product-level default is only a fallback, and NULL avoids implying a")
    add("--    maximum that was never actually set.")
    add("insert into public.tbl_inv_products")
    add("  (owner_branch_id, sku, name, description, category_id, is_stock_item,")
    add("   base_uom_id, purchase_uom_id, default_supplier_id, standard_unit_cost,")
    add("   is_chargeable, charge_price, default_max_store, default_max_floor,")
    add("   is_active, created_by_account)")
    add("select null, v.sku, v.name, v.description, c.id, not c.is_service,")
    add("       e.id, e.id, s.id, v.standard_unit_cost,")
    add("       v.is_chargeable, v.charge_price, null, null,")
    add("       v.is_active,")
    add(f"       {account_id}")
    add("from (values")
    add(values_block([
        "({sku}, {name}, {desc}, {cat}, {sup}, {cost}, {charge}, {chg}, {act})".format(
            sku=q(r["sku"]), name=q(r["name"]), desc=q(r["description"]),
            cat=q(r["category_code"]), sup=q(r["supplier_name"]),
            cost=q(r["standard_unit_cost"]), charge=q(r["charge_price"]),
            chg=q(r["is_chargeable"]), act=q(r["is_active"]),
        ) for r in plan["product_rows"]
    ]))
    add("     ) as v(sku, name, description, category_code, supplier_name,")
    add("                standard_unit_cost, charge_price, is_chargeable, is_active)")
    add("join public.tbl_inv_categories c on c.code = v.category_code")
    add("join public.tbl_inv_uoms e on e.code = 'EA'")
    add("left join public.tbl_inv_suppliers s")
    add("  on s.owner_branch_id is null")
    add(" and s.name_key = lower(regexp_replace(btrim(coalesce(v.supplier_name, '')), '\\s+', ' ', 'g'))")
    add("where not exists (")
    add("  select 1 from public.tbl_inv_products p")
    add("   where coalesce(p.owner_branch_id, 0) = 0 and p.sku = v.sku")
    add(");")
    add("")

    add("-- 3. Product UOM. D-106 adds a deferred constraint on tbl_inv_products")
    add("--    requiring an active base row with factor 1, so every product needs")
    add("--    one. The workbook's SourceUnit (BOX/STRIP/...) is deliberately NOT")
    add("--    converted here -- UOM cleanup is separate, later work.")
    add("insert into public.tbl_inv_product_uoms (product_id, uom_id, factor_to_base, is_active)")
    add("select p.id, e.id, 1, true")
    add("from public.tbl_inv_products p")
    add("join public.tbl_inv_uoms e on e.code = 'EA'")
    add("on conflict (product_id, uom_id) do nothing;")
    add("")

    add("-- 4. Barcodes. Text preserved EXACTLY, leading zeroes included.")
    add("--")
    add("--    Barcode '11' is intentionally absent: it is 2 characters and the")
    add("--    global constraint requires 3-64. It is NOT padded and the constraint")
    add("--    is NOT weakened. Its product is still imported and still reachable by")
    add("--    SKU; it is simply not scannable, which is what a 2-digit legacy code")
    add("--    is. owner_branch_id is filled from the product by fn_inv_guard_barcodes.")
    add("insert into public.tbl_inv_product_barcodes (barcode, product_id, uom_id, is_active, created_by_account)")
    add("select v.barcode, p.id, e.id, true,")
    add(f"       {account_id}")
    add("from (values")
    add(values_block([f"({q(bc)}, {q(sku)})" for bc, sku in plan["barcode_rows"]]))
    add("     ) as v(barcode, sku)")
    add("join public.tbl_inv_products p on p.sku = v.sku")
    add("join public.tbl_inv_uoms e on e.code = 'EA'")
    add("on conflict do nothing;")
    add("")

    add("-- 5. Store/Floor stock-level CONFIGURATION (max_qty only -- never a")
    add("--    current quantity, never an opening balance).")
    add("--    Store and Floor are independent locations and are never collapsed: a")
    add("--    product legitimately has BOTH a STORE and a FLOOR row.")
    add("--    Transit-only products are absent by construction (D-24: max levels")
    add("--    exist only on STORE/FLOOR). Service products are excluded by the")
    add("--    category join, because the guard trigger requires a stock item (D-137).")
    add("insert into public.tbl_inv_stock_levels")
    add("  (location_id, product_id, branch_id, max_qty, updated_by_account)")
    add("select l.id, p.id, b.\"BranchID\", v.max_qty,")
    add(f"       {account_id}")
    add("from (values")
    add(values_block([
        f"({q(r['sku'])}, {q(r['branch_code'])}, {q(r['kind'])}, {q(r['max_qty'])})"
        for r in plan["level_rows"]
    ]))
    add("     ) as v(sku, branch_code, kind, max_qty)")
    add("join public.tbl_branches b on b.\"BranchCode\" = v.branch_code")
    add("join public.tbl_inv_locations l on l.branch_id = b.\"BranchID\" and l.kind = v.kind")
    add("join public.tbl_inv_products p on p.sku = v.sku")
    add("join public.tbl_inv_categories c on c.id = p.category_id and c.is_service = false")
    add("on conflict (location_id, product_id) do update")
    add("  set max_qty = excluded.max_qty,")
    add(f"      updated_by_account = {account_id},")
    add("      updated_at = now();")
    add("")

    add("-- 6. Validation. Read this single row and check it against the brief")
    add("--    BEFORE changing the rollback below into a commit.")
    add("select")
    add("  (select count(*) from public.tbl_inv_products)                                as products,")
    add("  (select count(*) from public.tbl_inv_products where is_active)                as active_products,")
    add("  (select count(*) from public.tbl_inv_product_uoms)                            as product_uoms,")
    add("  (select count(*) from public.tbl_inv_product_barcodes where is_active)        as barcodes,")
    add("  (select count(*) from public.tbl_inv_suppliers where owner_branch_id is null) as global_suppliers,")
    add("  (select count(*) from public.tbl_inv_stock_levels)                            as stock_levels,")
    add("  (select count(*) from (select branch_id, product_id from public.tbl_inv_stock_levels")
    add("                    group by 1, 2 having count(*) = 2) x)                        as store_and_floor_pairs,")
    add("  (select count(*) from public.tbl_inv_stock_levels l")
    add("     join public.tbl_inv_products p on p.id = l.product_id")
    add("     join public.tbl_inv_categories c on c.id = p.category_id")
    add("    where c.is_service)                                                         as service_with_levels,")
    add("  (select count(*) from public.tbl_inv_txns)                                   as txns_unchanged,")
    add("  (select count(*) from public.tbl_inv_balances)                               as balances_unchanged,")
    add("  (select count(*) from public.tbl_inv_cost_pools)                             as cost_pools_unchanged;")
    add("")
    add("rollback;")
    add("")
    add("-- Expected from the brief: products 566, product_uoms 566, barcodes 565")
    add("-- (barcode '11' excluded by the 3-char constraint), stock_levels 1316.")
    add("-- store_and_floor_pairs is 544, not the 545 quoted in the brief: the")
    add("-- extra pair is BGN/900000007 (SUTURE REMOVAL), a SERVICE product, which")
    add("-- the D-137 rule correctly keeps out of Store/Floor configuration.")
    add("-- service_with_levels must be 0. txns/balances/cost_pools must be unchanged.")
    add("--")
    add("-- Once the row above is correct, change the rollback above to commit.")
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--capture-reference", metavar="PATH",
                    help="snapshot reference ids from Supabase into PATH (read-only)")
    ap.add_argument("--emit-sql", metavar="PATH",
                    help="write the idempotent migration SQL to PATH")
    args = ap.parse_args()

    if args.capture_reference:
        capture_reference(Path(args.capture_reference))
        return

    if not args.emit_sql:
        ap.error("choose --capture-reference or --emit-sql")

    products, stock_levels = read_workbook()
    ref_path = Path(args.emit_sql).with_name("inventory_reference.json")
    plan = build_plan(products, stock_levels, load_reference_json(ref_path), DEFAULT_MIGRATION_ACCOUNT)
    write_sql(Path(args.emit_sql), plan, DEFAULT_MIGRATION_ACCOUNT)

    print(f"wrote {args.emit_sql}")
    print(f"  products        {len(plan['product_rows'])} (of {len(products)} workbook rows)")
    print(f"  suppliers       {len(plan['supplier_rows'])} new")
    print(f"  barcodes        {len(plan['barcode_rows'])}")
    print(f"  stock levels    {len(plan['level_rows'])} (of {len(stock_levels)} workbook rows)")
    if plan["skipped_products"]:
        print(f"  skipped products: {plan['skipped_products']}")
    if plan["skipped_levels"]:
        print(f"  skipped levels  : {plan['skipped_levels']}")
    for n in plan["notes"]:
        print(f"  note: {n}")


if __name__ == "__main__":
    main()
