-- ============================================================================
-- Rollback of the General Inventory migrations (schema/007–013).
-- ============================================================================
-- VALID ONLY BEFORE GO-LIVE. After any real (non-demo) inventory data exists,
-- the rule is forward-fix only: this script refuses to run when ANY inventory
-- table holds real-branch or global (HQ-entered) data — not just the ledger
-- (audit P1-8) — and whenever a non-inventory object depends on an inventory
-- object. It drops only tbl_inv_* / v_inv_* / inv_* / fn_inv_* objects; no
-- existing table is touched. Run from the Supabase SQL editor (postgres) with
-- the owner's explicit confirmation.
-- ============================================================================

begin;

-- Guard 1 (audit P1-8): refuse if ANY real (non-demo) inventory data exists —
-- ledger, charges (incl. service charges), receipts, counts, requests,
-- billing codes, audit rows, idempotency rows, periods, global master data.
-- Seeded rows (UOMs, categories, locations, branch settings) do not count.
-- Override only with the owner's explicit decision, in the same session:
--   set inv.rollback_force = 'I understand';
-- Guard 2: never drop anything a non-inventory object depends on (no override).
do $$
declare
  v_force boolean := coalesce(current_setting('inv.rollback_force', true), '') = 'I understand';
  v_found text[] := '{}';
  v_n bigint;
  v_dep text;
  r record;
begin
  if to_regclass('public.tbl_inv_uoms') is null then
    return;                                            -- nothing installed
  end if;

  for r in
    select c.relname,
           bool_or(a.attname = 'branch_id') as has_branch,
           bool_or(a.attname = 'from_branch_id') as has_from,
           bool_or(a.attname = 'owner_branch_id') as has_owner,
           bool_or(a.attname = 'account_id') as has_account
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and not a.attisdropped
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'tbl\_inv\_%'
       and c.relname not in ('tbl_inv_locations', 'tbl_inv_branch_settings', 'tbl_inv_uoms', 'tbl_inv_categories')
     group by c.relname
  loop
    v_n := 0;
    if r.has_branch then
      -- rows of a real branch; plus rows with no branch at all (global master-data audit rows)
      -- that were not written by a demo account
      execute format(
        'select count(*) from public.%I x
          where coalesce(x.branch_id, %s) is null
             or exists (select 1 from public.tbl_branches b where b."BranchID" = x.branch_id and not b.is_demo)
             %s',
        r.relname,
        case when r.has_owner then 'x.owner_branch_id' else 'null' end,
        case when r.has_account then
          'or (x.branch_id is null and not exists (select 1 from public.tbl_user_accounts u
               join public.tbl_branches b on b."BranchID" = u.branch_id where u.id = x.account_id and b.is_demo))'
        else '' end) into v_n;
    elsif r.has_from then
      execute format('select count(*) from public.%I x join public.tbl_branches b on b."BranchID" = x.from_branch_id
                      where not b.is_demo', r.relname) into v_n;
    elsif r.has_owner then
      -- master data: global rows (owner NULL) are real, HQ-entered data
      execute format('select count(*) from public.%I x
                      where x.owner_branch_id is null
                         or not exists (select 1 from public.tbl_branches b
                                         where b."BranchID" = x.owner_branch_id and b.is_demo)', r.relname) into v_n;
    elsif r.has_account then
      execute format('select count(*) from public.%I x join public.tbl_user_accounts u on u.id = x.account_id
                      join public.tbl_branches b on b."BranchID" = u.branch_id where not b.is_demo', r.relname) into v_n;
    elsif r.relname = 'tbl_inv_product_uoms' then
      select count(*) into v_n from public.tbl_inv_product_uoms pu
        join public.tbl_inv_products p on p.id = pu.product_id
       where p.owner_branch_id is null
          or not exists (select 1 from public.tbl_branches b where b."BranchID" = p.owner_branch_id and b.is_demo);
    else
      execute format('select count(*) from public.%I', r.relname) into v_n;   -- unknown shape: any row counts
    end if;
    if v_n > 0 then
      v_found := v_found || (r.relname || '=' || v_n);
    end if;
  end loop;

  if cardinality(v_found) > 0 and not v_force then
    raise exception 'INV_ROLLBACK: real (non-demo) inventory data exists (%). Rollback is only for an install with no real data; after go-live the rule is forward-fix only. Owner-approved override: set inv.rollback_force = ''I understand''',
      array_to_string(v_found, ', ');
  end if;

  select string_agg(distinct format('%s depends on %s', dep.relname, t.relname), '; ') into v_dep
    from pg_catalog.pg_depend d
    join pg_catalog.pg_rewrite rw on rw.oid = d.objid
    join pg_catalog.pg_class dep on dep.oid = rw.ev_class
    join pg_catalog.pg_class t on t.oid = d.refobjid
   where d.classid = 'pg_catalog.pg_rewrite'::regclass
     and (t.relname like 'tbl\_inv\_%' or t.relname like 'v\_inv\_%')
     and dep.relname not like 'tbl\_inv\_%' and dep.relname not like 'v\_inv\_%';
  if v_dep is null then
    select string_agg(format('%s.%s references %s', src.relname, con.conname, tgt.relname), '; ') into v_dep
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class src on src.oid = con.conrelid
      join pg_catalog.pg_class tgt on tgt.oid = con.confrelid
     where con.contype = 'f' and tgt.relname like 'tbl\_inv\_%' and src.relname not like 'tbl\_inv\_%';
  end if;
  if v_dep is not null then
    raise exception 'INV_ROLLBACK: non-inventory objects depend on inventory objects: %', v_dep;
  end if;
end $$;

drop view if exists public.v_inv_exceptions;   -- 019
drop view if exists public.v_inv_request_line_progress;   -- 017
drop view if exists public.v_inv_suggested_order;
drop view if exists public.v_inv_stock_balance;

-- children before parents; CASCADE only removes inventory-owned FKs/triggers/policies
drop table if exists
  public.tbl_inv_audit_log,
  public.tbl_inv_charge_export_items,
  public.tbl_inv_charge_exports,
  public.tbl_inv_charges,
  public.tbl_inv_branch_transfer_receipts,
  public.tbl_inv_adjustment_lines,
  public.tbl_inv_adjustments,
  public.tbl_inv_branch_transfer_lines,
  public.tbl_inv_branch_transfers,
  public.tbl_inv_count_lines,
  public.tbl_inv_counts,
  public.tbl_inv_receipt_lines,
  public.tbl_inv_receipts,
  public.tbl_inv_stock_request_events,
  public.tbl_inv_stock_request_lines,
  public.tbl_inv_stock_requests,
  public.tbl_inv_balances,
  public.tbl_inv_cost_pools,
  public.tbl_inv_txn_lines,
  public.tbl_inv_txns,
  public.tbl_inv_idempotency,
  public.tbl_inv_counters,
  public.tbl_inv_period_closing,
  public.tbl_inv_billing_periods,
  public.tbl_inv_resident_billing,
  public.tbl_inv_stock_levels,
  public.tbl_inv_locations,
  public.tbl_inv_branch_settings,
  public.tbl_inv_product_barcodes,
  public.tbl_inv_product_uoms,
  public.tbl_inv_products,
  public.tbl_inv_suppliers,
  public.tbl_inv_categories,
  public.tbl_inv_uoms
  cascade;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'inv\_%' or p.proname like 'fn\_inv\_%')
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

commit;
