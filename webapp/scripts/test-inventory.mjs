#!/usr/bin/env node
// Inventory SQL test runner (docs/inventory-design.md §13.4).
//
// Runs entirely in-process on PGlite (Postgres compiled to WASM): no Docker,
// no network, and it NEVER touches the live Supabase project.
//
//   1. fresh database → Supabase stub + core-table stub
//   2. schema/006 (live security lockdown) + 007…013, applied twice (the second
//      run proves they are re-runnable)
//   3. test fixture, then a snapshot of the data directory
//   4. every "-- @test <name>" block of schema/tests/inventory/inventory_v1_tests.sql
//      runs in its OWN fresh database session loaded from that snapshot, inside
//      BEGIN … ROLLBACK — so no PL/pgSQL plan cache or other session state leaks
//      from one test into the next (audit P1-9: that leak once hid a bug)
//   5. rollback script: clean database → nothing left → re-apply; a database
//      with real-branch data → refused; the explicit override → allowed
//
// Usage: npm run test:inventory [-- <name filter>]

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const schemaDir = join(repo, "schema");
const testDir = join(schemaDir, "tests", "inventory");
const rollbackFile = join(repo, "migration", "scripts", "rollback_inventory_v1.sql");
const filter = (process.argv[2] ?? "").toLowerCase();

const read = (path) => readFileSync(path, "utf8");
const migrations = readdirSync(schemaDir)
  // 006 is the live security lockdown (not inventory) — applied first so the
  // harness matches production; then every inventory file 007+.
  .filter((f) => f === "006_security_lockdown.sql" || /^0(0[7-9]|[1-9]\d)_inventory_.*\.sql$/.test(f))
  .sort()
  .map((f) => ({ name: f, sql: read(join(schemaDir, f)) }));

const newDb = (loadDataDir) => PGlite.create({ extensions: { pg_trgm }, ...(loadDataDir ? { loadDataDir } : {}) });

async function freshDb() {
  const db = await newDb();
  await db.exec(read(join(testDir, "00_supabase_stub.sql")));
  return db;
}

// Files after 013 end with fn_inv_lockdown(), which revokes the API grants
// again; production re-runs 013 after every later inventory migration
// (docs/inventory-design.md §13.7 step 3), so the harness does the same.
const grantsFile = migrations.find((m) => m.name.startsWith("013_"));
const needsGrantRerun = migrations.some((m) => m.name > "013");

async function applyMigrations(db) {
  for (const m of migrations) {
    try {
      await db.exec(m.sql);
    } catch (err) {
      throw new Error(`${m.name}: ${err.message}`);
    }
  }
  if (needsGrantRerun && grantsFile) {
    try {
      await db.exec(grantsFile.sql);
    } catch (err) {
      throw new Error(`${grantsFile.name} (re-run): ${err.message}`);
    }
  }
}

function parseTests(sql) {
  const blocks = [];
  let current = null;
  for (const line of sql.split(/\r?\n/)) {
    const m = line.match(/^-- @test (.+)$/);
    if (m) {
      current = { name: m[1].trim(), body: [] };
      blocks.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return blocks.map((b) => ({ name: b.name, sql: b.body.join("\n") }));
}

const results = [];
function record(name, error) {
  results.push({ name, error });
  const mark = error ? "FAIL" : "pass";
  console.log(`${mark}  ${name}${error ? `\n      ${error.split("\n")[0]}` : ""}`);
}

const countInventoryObjects = `
  select count(*)::int as n from (
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and (c.relname like 'tbl\\_inv\\_%' or c.relname like 'v\\_inv\\_%')
    union all
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'inv\\_%' or p.proname like 'fn\\_inv\\_%')
  ) x`;

async function rollbackTests(snapshot) {
  const name1 = "rollback: removes every inventory object, leaves core tables, migrations re-apply";
  const db = await freshDb();
  try {
    await applyMigrations(db);
    await db.exec(read(rollbackFile));
    const left = await db.query(countInventoryObjects);
    if (left.rows[0].n !== 0) throw new Error(`${left.rows[0].n} inventory objects left after rollback`);
    const core = await db.query(`select count(*)::int as n from public.tbl_branches`);
    if (core.rows[0].n !== 6) throw new Error("rollback touched tbl_branches");
    await applyMigrations(db);
    record(name1, null);
  } catch (err) {
    record(name1, err.message);
  }
  await db.close();

  // P1-8: one real-branch SERVICE charge (no ledger txn) must block the rollback
  const name2 = "rollback: refused while a real branch has any inventory data (e.g. one service charge)";
  const db2 = await newDb(snapshot);
  try {
    const r = await db2.query(`select tests.call('amn', 'inv_charge_service', jsonb_build_object('target', 'RESIDENT',
      'resident_id', tests.res('R1'), 'charge_date', tests.today(), 'performed_by_staff', 'AMN-1',
      'lines', '[{"sku":"SVC","uom":"JOB","qty":1}]'::jsonb)) as r`);
    if (r.rows[0].r.ok !== true) throw new Error(`setup charge failed: ${JSON.stringify(r.rows[0].r)}`);
    let refused = null;
    try {
      await db2.exec(read(rollbackFile));
    } catch (err) {
      refused = err.message;
      await db2.exec("rollback;");
    }
    if (!refused || !refused.includes("INV_ROLLBACK")) throw new Error(`expected INV_ROLLBACK, got ${refused ?? "success"}`);
    if (!refused.includes("tbl_inv_charges")) throw new Error(`refusal does not name tbl_inv_charges: ${refused}`);
    const still = await db2.query(`select count(*)::int as n from public.tbl_inv_charges`);
    if (still.rows[0].n !== 1) throw new Error("charges table changed");
    record(name2, null);

    const name3 = "rollback: explicit override (inv.rollback_force) drops everything";
    try {
      await db2.exec(`set inv.rollback_force = 'I understand';`);
      await db2.exec(read(rollbackFile));
      const left = await db2.query(countInventoryObjects);
      if (left.rows[0].n !== 0) throw new Error(`${left.rows[0].n} objects left`);
      record(name3, null);
    } catch (err) {
      record(name3, err.message);
    }
  } catch (err) {
    record(name2, err.message);
  }
  await db2.close();
}

async function main() {
  if (migrations.length === 0) throw new Error("no schema/0xx_inventory_*.sql files found");
  console.log(`Migrations: ${migrations.map((m) => m.name).join(", ")}\n`);

  const base = await freshDb();
  try {
    await applyMigrations(base);
    record("install: migrations apply on a clean database", null);
  } catch (err) {
    record("install: migrations apply on a clean database", err.message);
    return;
  }
  try {
    await applyMigrations(base);
    record("install: migrations are re-runnable (second apply)", null);
  } catch (err) {
    record("install: migrations are re-runnable (second apply)", err.message);
  }
  await base.exec(read(join(testDir, "01_fixture.sql")));
  const snapshot = await base.dumpDataDir("none");
  await base.close();

  const testFiles = readdirSync(testDir).filter((f) => f.endsWith("_tests.sql")).sort();
  const tests = testFiles
    .flatMap((f) => parseTests(read(join(testDir, f))))
    .filter((t) => t.name.toLowerCase().includes(filter));
  for (const t of tests) {
    const db = await newDb(snapshot); // fresh session per test (P1-9)
    try {
      await db.exec("begin;");
      await db.exec(t.sql);
      record(t.name, null);
    } catch (err) {
      record(t.name, err.message);
    } finally {
      await db.exec("rollback;").catch(() => {});
      await db.close();
    }
  }

  if (!filter || "rollback".includes(filter)) {
    await rollbackTests(snapshot);
  }
  if (!filter || "staged apply".includes(filter)) {
    await stagedApplyTests();
  }
}

// Audit V-1: every file must be safe on its own. Apply 007, 008, … one file at
// a time (each its own transaction, as a file-by-file SQL-editor run would)
// and after each assert that anon/authenticated/service_role can reach nothing
// the file created, and RLS is on for every table. Before 013 nothing is
// granted at all; after 013 only the intended grants exist.
const exposureQuery = `
  select
    (select string_agg(c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and (c.relname like 'tbl\\_inv\\_%' or c.relname like 'v\\_inv\\_%')
        and case when c.relkind = 'S'
                 then has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                   or has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE')
                 when c.relkind in ('r','v','m')
                 then has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                   or has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                   or has_table_privilege('service_role', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
                   or ($1 and has_table_privilege('authenticated', c.oid, 'SELECT'))
                 else false end) as rel_exposed,
    (select string_agg(c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'tbl\\_inv\\_%' and not c.relrowsecurity) as rls_off,
    (select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'inv\\_%' or p.proname like 'fn\\_inv\\_%')
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('service_role', p.oid, 'EXECUTE')
             or (p.proname like 'fn\\_inv\\_%' and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
             or ($1 and has_function_privilege('authenticated', p.oid, 'EXECUTE')))) as fn_exposed`;

async function stagedApplyTests() {
  const db = await freshDb();
  try {
    await db.exec(migrations.find((m) => m.name.startsWith("006")).sql);
    for (const m of migrations.filter((x) => !x.name.startsWith("006"))) {
      await db.exec(m.sql);
      // after 013 grants exist; every later file locks everything down again
      const beforeGrants = !m.name.startsWith("013");
      const r = (await db.query(exposureQuery, [beforeGrants])).rows[0];
      const problems = Object.entries(r).filter(([, v]) => v);
      const name = `staged apply: after ${m.name} alone, anon can neither write nor execute anything inv_*`;
      record(name, problems.length ? problems.map(([k, v]) => `${k}: ${v}`).join(" | ") : null);
    }
    if (needsGrantRerun && grantsFile) {
      await db.exec(grantsFile.sql);
      const r = (await db.query(exposureQuery, [false])).rows[0];
      const problems = Object.entries(r).filter(([, v]) => v);
      record("staged apply: 013 re-run after the later files grants only what is intended",
        problems.length ? problems.map(([k, v]) => `${k}: ${v}`).join(" | ") : null);
    }
    // anon really cannot write, e.g. a global product, right after 007
    const db7 = await freshDb();
    await db7.exec(migrations.find((m) => m.name.startsWith("006")).sql);
    await db7.exec(migrations.find((m) => m.name.startsWith("007")).sql);
    let denied = null;
    try {
      await db7.exec(`begin; set local role anon;
        insert into public.tbl_inv_categories (code, name) values ('HACK', 'hack'); rollback;`);
    } catch (err) {
      denied = err.message;
      await db7.exec("rollback;").catch(() => {});
    }
    record("staged apply: after 007 alone an anon INSERT is refused",
      denied && denied.includes("permission denied") ? null : `expected permission denied, got ${denied ?? "success"}`);
    await db7.close();

    // V-4: the production fn_inv_today() (the 009 body, no test override) is KL local time
    const t = (await db.query(`select public.fn_inv_today() = (now() at time zone 'Asia/Kuala_Lumpur')::date as ok,
        position('test_today' in p.prosrc) = 0 as prod
        from pg_proc p where p.proname = 'fn_inv_today'`)).rows[0];
    record("fn_inv_today(): the production definition returns the Asia/Kuala_Lumpur date",
      t.ok && t.prod ? null : `ok=${t.ok} production_body=${t.prod}`);
  } catch (err) {
    record("staged apply", err.message);
  }
  await db.close();
}

main()
  .catch((err) => record("runner", err.stack ?? String(err)))
  .finally(() => {
    const failed = results.filter((r) => r.error);
    console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
    process.exitCode = failed.length ? 1 : 0;
  });
