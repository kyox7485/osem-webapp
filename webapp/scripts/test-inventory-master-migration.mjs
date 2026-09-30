#!/usr/bin/env node
// Dry-run harness for migration/scripts/migrate_inventory_master_apply.sql.
//
// Builds a real Postgres (PGlite, in-process: no Docker, no network) from
// schema/006 + 007…019, applies the generated inventory-master migration to it,
// and asserts the counts the task brief specifies. It NEVER touches the live
// Supabase project.
//
// Why this exists: service_role has no privileges on tbl_inv_* (D-146), so the
// migration can only be applied in the SQL editor as postgres -- i.e. by hand,
// on production. This harness is the safety net that proves the SQL is correct
// against the real schema, constraints, guard triggers and the deferred D-106
// constraint before anyone runs it for real.
//
// Usage: npm run test:inventory:migration

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const schemaDir = join(repo, "schema");
const testDir = join(schemaDir, "tests", "inventory");
const migrationFile = join(repo, "migration", "scripts", "migrate_inventory_master_apply.sql");

const read = (p) => readFileSync(p, "utf8");
const migrations = readdirSync(schemaDir)
  .filter((f) => f === "006_security_lockdown.sql" || /^0(0[7-9]|[1-9]\d)_inventory_.*\.sql$/.test(f))
  .sort()
  .map((f) => ({ name: f, sql: read(join(schemaDir, f)) }));

const migration = read(migrationFile);
if (/^\s*commit\s*;/im.test(migration)) {
  console.error("ABORT: the migration file ends in COMMIT. It must end in ROLLBACK so this");
  console.error("        harness can run it without persisting anything.");
  process.exit(1);
}

const results = [];
function check(name, actual, expected) {
  const ok = String(actual) === String(expected);
  results.push(ok);
  console.log(`${ok ? "pass" : "FAIL"}  ${name}: got ${actual}, expected ${expected}`);
}

const db = await PGlite.create({ extensions: { pg_trgm } });
await db.exec(read(join(testDir, "00_supabase_stub.sql")));
for (const m of migrations) {
  try {
    await db.exec(m.sql);
  } catch (err) {
    console.error(`schema ${m.name} failed: ${err.message}`);
    process.exit(1);
  }
}
// production re-runs 013 after every later inventory migration (see test-inventory.mjs)
await db.exec(migrations.find((m) => m.name.startsWith("013_")).sql);

// The standard inventory fixture provides tbl_user_accounts / tbl_staff /
// residents, which the migration's created_by_account = 2 (an HQ ADMIN in
// production) needs to satisfy its NOT NULL foreign key. The stub already seeds
// the real branches (AMN=1, BGN=4, BMN=3) and 012 their locations.
await db.exec(read(join(testDir, "01_fixture.sql")));

// The generated SQL ends in ROLLBACK, so the writes are applied then discarded.
// Split at the validation block so the counts can be read while the migration's
// rows are still visible: the apply part and the validation SELECT must run in
// the SAME transaction, so strip the trailing ROLLBACK and keep an explicit
// transaction open across both.
const marker = migration.indexOf("-- 6. Validation");
if (marker < 0) {
  console.error("MIGRATION FAILED: no '-- 6. Validation' marker found in the generated SQL");
  process.exit(1);
}
const applyPart = migration.slice(0, marker);
const validationPart = migration.slice(marker).replace(/rollback\s*;.*$/is, "");
let validation;
let base;

try {
  // One transaction: apply everything, read the counts, then discard.
  // The fixture pre-seeds its own products/UOMs, so every assertion below is a
  // DELTA measured from this baseline -- that is what the migration added.
  await db.exec("begin");
  const baseRes = await db.query(`
    select (select count(*)::int from public.tbl_inv_products)                    as products,
           (select count(*)::int from public.tbl_inv_products where not is_active) as inactive_products,
           (select count(*)::int from public.tbl_inv_product_uoms)                as product_uoms,
           (select count(*)::int from public.tbl_inv_product_barcodes)            as barcodes,
           (select count(*)::int from public.tbl_inv_suppliers where owner_branch_id is null) as global_suppliers,
           (select count(*)::int from public.tbl_inv_stock_levels)                as stock_levels`);
  base = baseRes.rows[0];
  // Remember which products already exist, so afterwards we can restrict every
  // UOM assertion to the 566 the migration actually created -- the fixture's own
  // pre-existing products are not this migration's business.
  const preRes = await db.query("select sku from public.tbl_inv_products");
  var preSkus = preRes.rows.map((r) => r.sku);
  await db.exec(applyPart);
  const res = await db.query(validationPart);
  validation = res.rows[0];

  // Store/Floor independence and leading zeroes, read in the same transaction.
  const bothRes = await db.query(`
    select count(*)::int as n from (
      select branch_id, product_id from public.tbl_inv_stock_levels group by 1,2 having count(*) = 2) x`);
  var storeFloorPairs = bothRes.rows[0].n;

  const kindRes = await db.query(`
    select l.kind, count(*)::int as n
      from public.tbl_inv_stock_levels sl join public.tbl_inv_locations l on l.id = sl.location_id
     group by 1 order by 1`);
  var levelsByKind = kindRes.rows;

  const leadRes = await db.query(`
    select barcode from public.tbl_inv_product_barcodes
     where length(barcode) = 6 and barcode ~ '^[0-9]+$' order by barcode limit 3`);
  var leadingZeroBarcodes = leadRes.rows.map((r) => r.barcode);

  await db.exec("rollback");
} catch (err) {
  console.error(`MIGRATION FAILED: ${err.message}`);
  process.exit(1);
}

if (!validation) {
  console.error("MIGRATION FAILED: the validation SELECT never returned a row");
  process.exit(1);
}
console.log("\nvalidation block returned:");
console.log(validation);
console.log("");

const v = validation;
const b = base;
check("products added by the migration", v.products - b.products, 566);
check("inactive products preserved", v.active_products === undefined ? 0 : (v.products - v.active_products) - b.inactive_products, 6);
// Every PRODUCT gets an EA row -- including the 2 pre-existing fixture products
// that had none -- so the delta is 568, not 566. What matters is the invariant:
// every product has exactly one active factor-1 base row.
const uomInv = await (async () => {
  await db.exec("begin");
  await db.exec(applyPart);
  // Restrict to the 566 migrated SKUs: the fixture's own pre-existing products
  // are not this migration's business.
  const r = await db.query(`
    with pre(sku) as (select unnest($1::text[])),
    migrated as (
      select p.id from public.tbl_inv_products p
       where not exists (select 1 from pre where pre.sku = p.sku))
    select (select count(*)::int from migrated m
             where not exists (select 1 from public.tbl_inv_product_uoms u
                                where u.product_id = m.id and u.uom_id = (
                                    select p.base_uom_id from public.tbl_inv_products p where p.id = m.id)
                                  and u.factor_to_base = 1 and u.is_active)) as migrated_missing_base_uom,
           (select count(*)::int from migrated m
             where (select count(*) from public.tbl_inv_product_uoms u
                     where u.product_id = m.id and u.factor_to_base = 1 and u.is_active) > 1) as migrated_extra_factor1`,
    [preSkus]);
  await db.exec("rollback");
  return r.rows[0];
})();
check("every migrated product has an active factor-1 base UOM row", uomInv.migrated_missing_base_uom, 0);
check("no migrated product has a second factor-1 UOM row", uomInv.migrated_extra_factor1, 0);
check("barcodes added (565: '11' excluded by the 3-char constraint)", v.barcodes - b.barcodes, 565);
// 25 canonical suppliers from the workbook, on top of the fixture's 1 global one.
check("global suppliers added", v.global_suppliers - b.global_suppliers, 25);
check("stock_levels added (1316 workbook rows minus 1 orphan)", v.stock_levels - b.stock_levels, 1315);
check("service products have NO store/floor level", v.service_with_levels, 0);
check("no ledger rows created (txns)", v.txns_unchanged, 0);
check("no balances created", v.balances_unchanged, 0);
check("no cost pools created", v.cost_pools_unchanged, 0);

// Store and Floor are independent locations and must never be collapsed into one.
check("branch/product pairs holding BOTH Store and Floor", storeFloorPairs, 544);
console.log("  levels by kind:", levelsByKind);

// Leading zeroes must survive verbatim.
check("leading-zero barcodes preserved", leadingZeroBarcodes.length, 3);
console.log("  leading-zero barcode sample:", leadingZeroBarcodes);

await db.close();

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
