-- ============================================================================
-- 018 — General Inventory: Stock Count workflow (Phase 5)
-- ============================================================================
-- Owner decisions (D-60, D-61, D-104, D-123, D-159): a count NEVER posts
-- stock; it only records variance. Any variance is turned into ONE PENDING
-- adjustment (deltas, never set-to-count) that a MOD/ADMIN approves with the
-- existing inv_decide_adjustment.
--
-- inv_start_count       tier COUNT: freezes nothing unless asked (default on for
--                       MONTHLY_STORE), records snapshot_line_id, builds the blind
--                       sheet (non-zero bucket or stock-level max > 0)
-- inv_save_count_lines  tier COUNT: physical qty per sheet line + found items
--                       (blind: expected is never filled or returned here)
-- inv_submit_count      tier COUNT: every line counted; computes expected
--                       (as of snapshot) and posted_since_start; releases freeze
-- inv_review_count      tier COUNT_INVESTIGATE (senior staff): notes, summary,
--                       optional PENDING adjustment for the variances; then CLOSED
-- inv_cancel_count      IN_PROGRESS (COUNT) or SUBMITTED (COUNT_INVESTIGATE)
--
-- Statuses used: IN_PROGRESS, SUBMITTED, CLOSED, CANCELLED. DRAFT and
-- INVESTIGATED stay unused (D-159). Lock order: count header, then location
-- (submit) / counters. START has no header yet: location FOR UPDATE, counter.
-- Apply after 017, then RE-RUN 013_inventory_grants.sql.
-- ============================================================================

begin;

-- Raises a business rejection so the enclosing sub-block rolls back its partial writes;
-- the caller's EXCEPTION handler turns it back into the normal {ok:false} result.
create or replace function public.fn_inv_err_x(p_code text, p_message text default null, p_data jsonb default null)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  raise exception '%', public.fn_inv_err(p_code, p_message, p_data)::text using errcode = 'INV01';
end $$;

-- ----------------------------------------------------------------------------
-- Guard update (identical to 007's definition, which carries the same change):
-- a SUBMITTED count may now be CANCELLED (D-159). Nothing else changes.
-- ----------------------------------------------------------------------------
create or replace function public.fn_inv_guard_document() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb;
  v_changed text[];
  v_allowed text[];
  v_from text;
  v_to text;
  v_ok boolean := true;
begin
  if tg_op = 'DELETE' then
    if public.fn_inv_purge_allowed(v_old) then
      return old;
    end if;
    raise exception 'INV_IMMUTABLE: DELETE on % is not allowed', tg_table_name using errcode = 'P0001';
  end if;

  if coalesce(current_setting('inv.posting', true), '') <> 'on' then
    raise exception 'INV_ENGINE_ONLY: UPDATE on % is only allowed inside the posting engine', tg_table_name
      using errcode = 'P0001';
  end if;

  v_new := to_jsonb(new);
  -- generated columns are not yet computed in a BEFORE trigger: ignore them
  select coalesce(array_agg(k), '{}') into v_changed
    from jsonb_object_keys(v_new) k
   where v_new->k is distinct from v_old->k
     and k not in (select a.attname from pg_catalog.pg_attribute a
                    where a.attrelid = tg_relid and a.attgenerated <> '');
  v_from := v_old->>'status';
  v_to := v_new->>'status';

  case tg_table_name
    when 'tbl_inv_receipts' then
      v_allowed := array['is_voided','voided_by_txn_id','superseded_by_receipt_id'];
      v_ok := (not ('is_voided' = any(v_changed)) or (v_old->>'is_voided')::boolean = false)
          and (not ('voided_by_txn_id' = any(v_changed)) or v_old->'voided_by_txn_id' = 'null'::jsonb)
          and (not ('superseded_by_receipt_id' = any(v_changed)) or v_old->'superseded_by_receipt_id' = 'null'::jsonb);
    when 'tbl_inv_branch_transfers' then
      v_allowed := array['status','cancel_txn_id','updated_at'];
      v_ok := (v_from = v_to or (v_from, v_to) in (('DISPATCHED','RECEIVED'),('RECEIVED','DISPATCHED'),('DISPATCHED','CANCELLED')))
          and (not ('cancel_txn_id' = any(v_changed)) or (v_old->'cancel_txn_id' = 'null'::jsonb and v_to = 'CANCELLED'));
    when 'tbl_inv_billing_periods' then
      v_allowed := array['status','exceptions_reviewed_at','exceptions_reviewed_by_account','exceptions_reviewed_by_staff',
                         'locked_at','locked_by_account','locked_by_staff','reopen_count'];
      v_ok := case
        when v_from = 'LOCKED' and v_to = 'OPEN' then (v_new->>'reopen_count')::int = (v_old->>'reopen_count')::int + 1
        else (v_new->>'reopen_count')::int = (v_old->>'reopen_count')::int
             and (v_from = v_to or (v_from = 'OPEN' and v_to = 'LOCKED'))
             and (v_from = 'OPEN' or not (array['exceptions_reviewed_at'] <@ v_changed))
      end;
    when 'tbl_inv_stock_requests' then
      v_allowed := array['status','submitted_at','reviewed_by_account','reviewed_by_staff','reviewed_at','review_note',
                         'ordered_at','ordered_by_account','external_ref','expected_delivery_date','updated_at'];
      v_ok := v_from = v_to or (v_from, v_to) in (
        ('DRAFT','SUBMITTED'),('DRAFT','CANCELLED'),('SUBMITTED','APPROVED'),('SUBMITTED','REJECTED'),
        ('SUBMITTED','CANCELLED'),('APPROVED','ORDERED'),('APPROVED','CANCELLED'),('APPROVED','CLOSED'),
        ('ORDERED','PARTIALLY_RECEIVED'),('ORDERED','RECEIVED'),('ORDERED','CLOSED'),
        ('PARTIALLY_RECEIVED','RECEIVED'),('PARTIALLY_RECEIVED','CLOSED'));
    when 'tbl_inv_stock_request_lines' then
      v_allowed := array['approved_qty','requested_qty','supplier_id','remarks',
                         'closed_short_at','closed_short_by_account','closed_short_reason'];
      v_ok := not ('closed_short_at' = any(v_changed)) or v_old->'closed_short_at' = 'null'::jsonb;
    when 'tbl_inv_counts' then
      v_allowed := array['status','freeze_location','snapshot_line_id','started_at','submitted_at','investigated_by_staff',
                         'investigated_by_account','investigation_summary','closed_at','updated_at'];
      v_ok := (v_from = v_to or (v_from, v_to) in (
                 ('DRAFT','IN_PROGRESS'),('DRAFT','CANCELLED'),('IN_PROGRESS','SUBMITTED'),('IN_PROGRESS','CANCELLED'),
                 ('SUBMITTED','INVESTIGATED'),('SUBMITTED','CLOSED'),('SUBMITTED','CANCELLED'),('INVESTIGATED','CLOSED')))
          and (not ('snapshot_line_id' = any(v_changed)) or v_old->'snapshot_line_id' = 'null'::jsonb);
    when 'tbl_inv_count_lines' then
      v_allowed := array['expected_qty','posted_since_start','physical_qty','investigation_note'];
      v_ok := (not ('expected_qty' = any(v_changed)) or v_old->'expected_qty' = 'null'::jsonb)
          and (not ('posted_since_start' = any(v_changed)) or v_old->'posted_since_start' = 'null'::jsonb);
    when 'tbl_inv_adjustments' then
      v_allowed := array['status','decided_by_staff','decided_by_account','decided_at','decision_note','txn_id'];
      v_ok := v_from = 'PENDING' and v_to in ('APPROVED','REJECTED','CANCELLED');
    when 'tbl_inv_adjustment_lines' then
      v_allowed := array['qty_delta_base','count_line_id'];
      v_ok := exists (select 1 from public.tbl_inv_adjustments a
                      where a.id = (v_old->>'adjustment_id')::bigint and a.status = 'PENDING');
    else
      v_allowed := '{}';
      v_ok := false;
  end case;

  if not (v_changed <@ v_allowed) or not coalesce(v_ok, false) then
    raise exception 'INV_TRANSITION: UPDATE of % (%) is not an allowed transition', tg_table_name,
      array_to_string(v_changed, ',') using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- inv_start_count
-- payload: {location_id, count_type, freeze_location?, counted_by_staff}
-- ----------------------------------------------------------------------------
create or replace function public.inv_start_count(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_start_count';
  v_acc record;
  v_loc record;
  v_branch bigint;
  v_replay jsonb;
  v_code text;
  v_type text := public.fn_inv_jtext(p_payload->'count_type');
  v_staff text := public.fn_inv_jtext(p_payload->'counted_by_staff');
  v_freeze boolean;
  v_snapshot bigint;
  v_count_id bigint;
  v_count_no text;
  v_n int;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_loc from public.fn_inv_location_of(public.fn_inv_jbigint(p_payload->'location_id'));
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_branch := v_loc.branch_id;
  if not public.fn_inv_can('COUNT', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, public.fn_inv_today()),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('COUNT')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_type is null or v_type not in ('MONTHLY_STORE','WEEKLY_FLOOR','AD_HOC') then
    return public.fn_inv_err('INVALID_COUNT_TYPE');
  end if;
  v_freeze := coalesce(case when jsonb_typeof(p_payload->'freeze_location') = 'boolean'
                            then (p_payload->>'freeze_location')::boolean end, v_type = 'MONTHLY_STORE');

  -- location first (postings hold it FOR SHARE, D-104), then the counter
  perform 1 from public.tbl_inv_locations l where l.id = v_loc.id for update;
  if not (select l.is_active from public.tbl_inv_locations l where l.id = v_loc.id) then
    return public.fn_inv_err('LOCATION_INACTIVE');
  end if;
  -- counts never post: an unreviewed count or an undecided count adjustment still
  -- carries this location's variance, so a new count would apply it twice
  if exists (select 1 from public.tbl_inv_counts c where c.location_id = v_loc.id
               and c.status in ('IN_PROGRESS','SUBMITTED')) then
    return public.fn_inv_err('COUNT_IN_PROGRESS');
  end if;
  if exists (select 1 from public.tbl_inv_adjustments a where a.location_id = v_loc.id
               and a.count_id is not null and a.status = 'PENDING') then
    return public.fn_inv_err('COUNT_ADJUSTMENT_PENDING');
  end if;
  perform public.fn_inv_lock('[]'::jsonb, null, jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'doc_type', 'CNT')));
  v_count_no := public.fn_inv_next_no(v_branch, 'CNT');
  select coalesce(max(tl.id), 0) into v_snapshot from public.tbl_inv_txn_lines tl;

  insert into public.tbl_inv_counts (count_no, branch_id, location_id, count_type, status, freeze_location,
    snapshot_line_id, started_at, counted_by_staff, created_by_account)
  values (v_count_no, v_branch, v_loc.id, v_type, 'IN_PROGRESS', v_freeze, v_snapshot, now(), v_staff, v_acc.account_id)
  returning id into v_count_id;

  -- D-123 sheet: active stock items visible to the branch with a non-zero bucket here
  -- or an effective max > 0 here (TRANSIT: one line per product + resident bucket)
  insert into public.tbl_inv_count_lines (count_id, branch_id, product_id, resident_id)
  select v_count_id, v_branch, s.product_id, s.resident_id
    from (
      select b.product_id, b.resident_id
        from public.tbl_inv_balances b
       where b.location_id = v_loc.id and b.qty <> 0
      union
      select p.id, null::bigint
        from public.tbl_inv_products p
        left join public.tbl_inv_stock_levels sl on sl.location_id = v_loc.id and sl.product_id = p.id
       where v_loc.kind in ('STORE','FLOOR')
         and coalesce(sl.max_qty, case v_loc.kind when 'STORE' then p.default_max_store else p.default_max_floor end, 0) > 0
    ) s
    join public.tbl_inv_products p on p.id = s.product_id
   where p.is_stock_item and p.is_active and (p.owner_branch_id is null or p.owner_branch_id = v_branch)
   order by p.name, s.product_id, s.resident_id;
  get diagnostics v_n = row_count;

  v_result := public.fn_inv_ok(jsonb_build_object('count_id', v_count_id, 'count_no', v_count_no,
    'status', 'IN_PROGRESS', 'freeze_location', v_freeze, 'snapshot_line_id', v_snapshot, 'line_count', v_n));
  perform public.fn_inv_audit('COUNT_STARTED', 'count', v_count_id::text, v_branch, v_staff, null, p_key, v_type,
    jsonb_build_object('count_no', v_count_no, 'location_id', v_loc.id, 'freeze_location', v_freeze,
                       'snapshot_line_id', v_snapshot, 'line_count', v_n));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_save_count_lines (blind: expected_qty is never touched or returned)
-- payload: {count_id, performed_by_staff?, lines:[{count_line_id, physical_qty|null}],
--   found:[{product_id, resident_id?, physical_qty}]}
-- A found item cannot be removed; count it as 0 if it turns out not to be there.
-- ----------------------------------------------------------------------------
create or replace function public.inv_save_count_lines(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_save_count_lines';
  v_acc record;
  v_count record;
  v_replay jsonb;
  v_code text;
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_status text;
  l jsonb;
  v_n int := 0;
  v_line_id bigint;
  v_qty numeric;
  v_ids bigint[] := '{}';
  v_prod record;
  v_res bigint;
  v_res_branch bigint;
  v_new_id bigint;
  v_found_ids bigint[] := '{}';
  v_saved int := 0;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select c.* into v_count from public.tbl_inv_counts c where c.id = public.fn_inv_jbigint(p_payload->'count_id');
  if not found or not public.fn_inv_can('COUNT', v_count.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_staff is not null then
    v_code := public.fn_inv_check_staff(v_staff, v_count.branch_id, false);
    if v_code is not null then
      return public.fn_inv_err(v_code);
    end if;
  end if;
  if (p_payload->'lines' is not null and jsonb_typeof(p_payload->'lines') not in ('array','null'))
     or (p_payload->'found' is not null and jsonb_typeof(p_payload->'found') not in ('array','null'))
     or jsonb_array_length(coalesce(nullif(p_payload->'lines', 'null'::jsonb), '[]'::jsonb)) > 1000
     or jsonb_array_length(coalesce(nullif(p_payload->'found', 'null'::jsonb), '[]'::jsonb)) > 200 then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;

  select c.status into v_status from public.tbl_inv_counts c where c.id = v_count.id for update;
  if v_status <> 'IN_PROGRESS' then
    return public.fn_inv_err('COUNT_BAD_STATUS');
  end if;
  perform set_config('inv.posting', 'on', true);
  begin
  for l in select * from jsonb_array_elements(coalesce(nullif(p_payload->'lines', 'null'::jsonb), '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_line_id := public.fn_inv_jbigint(l->'count_line_id');
    if v_line_id is null or v_line_id = any (v_ids) then
      return public.fn_inv_err_x(case when v_line_id is null then 'INVALID_PAYLOAD' else 'DUPLICATE_LINE' end,
                               null, jsonb_build_object('line', v_n));
    end if;
    v_ids := v_ids || v_line_id;
    if l->'physical_qty' is null or jsonb_typeof(l->'physical_qty') = 'null' then
      v_qty := null;
    else
      v_qty := public.fn_inv_jnum(l->'physical_qty');
      if v_qty is null or v_qty < 0 or v_qty <> round(v_qty, 4) or v_qty > 1000000 then
        return public.fn_inv_err_x('INVALID_QTY', null, jsonb_build_object('line', v_n));
      end if;
    end if;
    select cl.id, uo.allow_fraction into v_prod
      from public.tbl_inv_count_lines cl
      join public.tbl_inv_products p on p.id = cl.product_id
      join public.tbl_inv_uoms uo on uo.id = p.base_uom_id
     where cl.id = v_line_id and cl.count_id = v_count.id;
    if not found then
      return public.fn_inv_err_x('COUNT_LINE_NOT_FOUND', null, jsonb_build_object('line', v_n));
    end if;
    if v_qty is not null and not v_prod.allow_fraction and v_qty <> trunc(v_qty) then
      return public.fn_inv_err_x('QTY_NOT_INTEGRAL', null, jsonb_build_object('line', v_n));
    end if;
    update public.tbl_inv_count_lines cl set physical_qty = v_qty where cl.id = v_line_id;
    v_saved := v_saved + 1;
  end loop;

  v_n := 0;
  for l in select * from jsonb_array_elements(coalesce(nullif(p_payload->'found', 'null'::jsonb), '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_qty := public.fn_inv_jnum(l->'physical_qty');
    if v_qty is null or v_qty < 0 or v_qty <> round(v_qty, 4) or v_qty > 1000000 then
      return public.fn_inv_err_x('INVALID_QTY', null, jsonb_build_object('found', v_n));
    end if;
    select p.id, p.is_active, p.is_stock_item, uo.allow_fraction into v_prod
      from public.tbl_inv_products p
      join public.tbl_inv_uoms uo on uo.id = p.base_uom_id
     where p.id = public.fn_inv_jbigint(l->'product_id')
       and (p.owner_branch_id is null or p.owner_branch_id = v_count.branch_id);
    if not found then
      return public.fn_inv_err_x('PRODUCT_NOT_FOUND', null, jsonb_build_object('found', v_n));
    end if;
    if not v_prod.is_active then
      return public.fn_inv_err_x('PRODUCT_INACTIVE', null, jsonb_build_object('found', v_n));
    end if;
    if not v_prod.is_stock_item then
      return public.fn_inv_err_x('NOT_STOCK_ITEM', null, jsonb_build_object('found', v_n));
    end if;
    if not v_prod.allow_fraction and v_qty <> trunc(v_qty) then
      return public.fn_inv_err_x('QTY_NOT_INTEGRAL', null, jsonb_build_object('found', v_n));
    end if;
    v_res := null;
    if (select l2.kind from public.tbl_inv_locations l2 where l2.id = v_count.location_id) = 'TRANSIT' then
      select r.id, r.branch_id into v_res, v_res_branch from public.tbl_residents r
       where r.id = public.fn_inv_jbigint(l->'resident_id');
      if v_res is null then
        return public.fn_inv_err_x('RESIDENT_NOT_FOUND', null, jsonb_build_object('found', v_n));
      end if;
      if v_res_branch <> v_count.branch_id and not exists (select 1 from public.tbl_inv_balances b
           where b.location_id = v_count.location_id and b.resident_id = v_res and b.product_id = v_prod.id) then
        return public.fn_inv_err_x('RESIDENT_WRONG_BRANCH', null, jsonb_build_object('found', v_n));
      end if;
    end if;
    if exists (select 1 from public.tbl_inv_count_lines cl
                where cl.count_id = v_count.id and cl.product_id = v_prod.id and cl.resident_id is not distinct from v_res) then
      return public.fn_inv_err_x('DUPLICATE_LINE', null, jsonb_build_object('found', v_n));
    end if;
    insert into public.tbl_inv_count_lines (count_id, branch_id, product_id, resident_id, is_found_item, physical_qty)
    values (v_count.id, v_count.branch_id, v_prod.id, v_res, true, v_qty)
    returning id into v_new_id;
    v_found_ids := v_found_ids || v_new_id;
  end loop;
  exception when sqlstate 'INV01' then
    return public.fn_inv_finish(sqlerrm::jsonb);
  end;

  v_result := public.fn_inv_ok(jsonb_build_object('count_id', v_count.id, 'saved', v_saved,
    'found_line_ids', to_jsonb(v_found_ids),
    'counted', (select count(*) from public.tbl_inv_count_lines cl where cl.count_id = v_count.id and cl.physical_qty is not null),
    'total', (select count(*) from public.tbl_inv_count_lines cl where cl.count_id = v_count.id)));
  perform public.fn_inv_audit('COUNT_LINES_SAVED', 'count', v_count.id::text, v_count.branch_id, v_staff, null, p_key,
    null, jsonb_build_object('saved', v_saved, 'found_line_ids', to_jsonb(v_found_ids)));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_submit_count
-- payload: {count_id}
-- ----------------------------------------------------------------------------
create or replace function public.inv_submit_count(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_submit_count';
  v_acc record;
  v_count record;
  v_replay jsonb;
  v_status text;
  v_missing jsonb;
  v_total int;
  v_variances int;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select c.* into v_count from public.tbl_inv_counts c where c.id = public.fn_inv_jbigint(p_payload->'count_id');
  if not found or not public.fn_inv_can('COUNT', v_count.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;

  -- header first, then the location (blocks in-flight postings so the snapshot split is exact)
  select c.status into v_status from public.tbl_inv_counts c where c.id = v_count.id for update;
  if v_status <> 'IN_PROGRESS' then
    return public.fn_inv_err('COUNT_BAD_STATUS');
  end if;
  perform 1 from public.tbl_inv_locations l where l.id = v_count.location_id for update;
  perform set_config('inv.posting', 'on', true);

  select count(*), coalesce(jsonb_agg(cl.id order by cl.id) filter (where cl.physical_qty is null), '[]')
    into v_total, v_missing
    from public.tbl_inv_count_lines cl where cl.count_id = v_count.id;
  if v_total = 0 then
    return public.fn_inv_err('COUNT_EMPTY');
  end if;
  if jsonb_array_length(v_missing) > 0 then
    return public.fn_inv_err('COUNT_INCOMPLETE', null, jsonb_build_object('missing', v_missing));
  end if;

  update public.tbl_inv_count_lines cl
     set expected_qty = coalesce((select sum(tl.qty_base) from public.tbl_inv_txn_lines tl
                                   where tl.location_id = v_count.location_id and tl.product_id = cl.product_id
                                     and tl.resident_id is not distinct from cl.resident_id
                                     and tl.id <= v_count.snapshot_line_id), 0),
         posted_since_start = coalesce((select sum(tl.qty_base) from public.tbl_inv_txn_lines tl
                                         where tl.location_id = v_count.location_id and tl.product_id = cl.product_id
                                           and tl.resident_id is not distinct from cl.resident_id
                                           and tl.id > v_count.snapshot_line_id), 0)
   where cl.count_id = v_count.id;
  update public.tbl_inv_counts c set status = 'SUBMITTED', submitted_at = now(), updated_at = now()
   where c.id = v_count.id;
  select count(*) into v_variances from public.tbl_inv_count_lines cl
   where cl.count_id = v_count.id and cl.variance_qty <> 0;

  v_result := public.fn_inv_ok(jsonb_build_object('count_id', v_count.id, 'status', 'SUBMITTED',
    'line_count', v_total, 'variance_lines', v_variances));
  perform public.fn_inv_audit('COUNT_SUBMITTED', 'count', v_count.id::text, v_count.branch_id, v_count.counted_by_staff,
    null, p_key, null, jsonb_build_object('count_no', v_count.count_no, 'line_count', v_total, 'variance_lines', v_variances));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_review_count (tier COUNT_INVESTIGATE, senior staff performer)
-- payload: {count_id, performed_by_staff, summary?, notes?:[{count_line_id, note}],
--   request_adjustment? (default true)}
-- ----------------------------------------------------------------------------
create or replace function public.inv_review_count(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_review_count';
  v_acc record;
  v_count record;
  v_replay jsonb;
  v_code text;
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_summary text := public.fn_inv_jtext(p_payload->'summary');
  v_request boolean := coalesce(case when jsonb_typeof(p_payload->'request_adjustment') = 'boolean'
                                     then (p_payload->>'request_adjustment')::boolean end, true);
  v_status text;
  nt jsonb;
  v_n int := 0;
  v_line_id bigint;
  v_note text;
  v_ids bigint[] := '{}';
  v_variances int;
  v_adj_id bigint;
  v_adj_no text;
  v_warning text;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select c.* into v_count from public.tbl_inv_counts c where c.id = public.fn_inv_jbigint(p_payload->'count_id');
  if not found or not public.fn_inv_can('COUNT_INVESTIGATE', v_count.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := public.fn_inv_check_staff(v_staff, v_count.branch_id, public.fn_inv_needs_senior_staff('COUNT_INVESTIGATE'));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_summary is not null and length(v_summary) > 2000 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'summary'));
  end if;
  if p_payload->'notes' is not null and jsonb_typeof(p_payload->'notes') <> 'null'
     and (jsonb_typeof(p_payload->'notes') <> 'array' or jsonb_array_length(p_payload->'notes') > 1000) then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'notes'));
  end if;
  if v_request and not public.fn_inv_can('ADJUSTMENT_REQUEST', v_count.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;

  select c.status into v_status from public.tbl_inv_counts c where c.id = v_count.id for update;
  if v_status <> 'SUBMITTED' then
    return public.fn_inv_err('COUNT_BAD_STATUS');
  end if;
  select count(*) into v_variances from public.tbl_inv_count_lines cl
   where cl.count_id = v_count.id and cl.variance_qty <> 0;
  if v_variances > 0 and (v_summary is null or length(v_summary) < 5) then
    return public.fn_inv_err('JUSTIFICATION_REQUIRED');
  end if;
  perform set_config('inv.posting', 'on', true);

  begin
  for nt in select * from jsonb_array_elements(coalesce(nullif(p_payload->'notes', 'null'::jsonb), '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_line_id := public.fn_inv_jbigint(nt->'count_line_id');
    v_note := public.fn_inv_jtext(nt->'note');
    if v_line_id is null or v_line_id = any (v_ids) or (v_note is not null and length(v_note) > 500) then
      return public.fn_inv_err_x('INVALID_PAYLOAD', null, jsonb_build_object('field', 'notes', 'line', v_n));
    end if;
    v_ids := v_ids || v_line_id;
    if not exists (select 1 from public.tbl_inv_count_lines cl where cl.id = v_line_id and cl.count_id = v_count.id) then
      return public.fn_inv_err_x('COUNT_LINE_NOT_FOUND', null, jsonb_build_object('line', v_n));
    end if;
    update public.tbl_inv_count_lines cl set investigation_note = v_note where cl.id = v_line_id;
  end loop;
  exception when sqlstate 'INV01' then
    return public.fn_inv_finish(sqlerrm::jsonb);
  end;

  if v_request and v_variances > 0 then
    perform public.fn_inv_lock('[]'::jsonb, null, jsonb_build_array(jsonb_build_object('branch_id', v_count.branch_id, 'doc_type', 'ADJ')));
    v_adj_no := public.fn_inv_next_no(v_count.branch_id, 'ADJ');
    insert into public.tbl_inv_adjustments (adjustment_no, branch_id, location_id, count_id, status, reason_code,
      justification, requested_by_staff, requested_by_account)
    values (v_adj_no, v_count.branch_id, v_count.location_id, v_count.id, 'PENDING', 'COUNT_VARIANCE',
            left(v_summary, 1000), v_staff, v_acc.account_id)
    returning id into v_adj_id;
    insert into public.tbl_inv_adjustment_lines (adjustment_id, branch_id, product_id, resident_id, qty_delta_base, count_line_id)
    select v_adj_id, v_count.branch_id, cl.product_id, cl.resident_id, cl.variance_qty, cl.id
      from public.tbl_inv_count_lines cl
     where cl.count_id = v_count.id and cl.variance_qty <> 0
     order by cl.id;
  end if;

  update public.tbl_inv_counts c
     set status = 'CLOSED', investigated_by_staff = v_staff, investigated_by_account = v_acc.account_id,
         investigation_summary = v_summary, closed_at = now(), updated_at = now()
   where c.id = v_count.id;
  if v_staff = v_count.counted_by_staff then
    v_warning := 'SOD_SAME_STAFF';                                          -- D-123: warn, do not block
  end if;

  v_result := public.fn_inv_ok(jsonb_build_object('count_id', v_count.id, 'status', 'CLOSED',
    'variance_lines', v_variances, 'adjustment_id', v_adj_id, 'adjustment_no', v_adj_no, 'warning', v_warning));
  perform public.fn_inv_audit('COUNT_REVIEWED', 'count', v_count.id::text, v_count.branch_id, v_staff, null, p_key,
    v_summary, jsonb_build_object('count_no', v_count.count_no, 'variance_lines', v_variances,
      'adjustment_id', v_adj_id, 'adjustment_no', v_adj_no, 'warning', v_warning));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_cancel_count
-- payload: {count_id, reason, performed_by_staff?}  (staff required, senior, for SUBMITTED)
-- The reason is kept in investigation_summary of the cancelled count.
-- ----------------------------------------------------------------------------
create or replace function public.inv_cancel_count(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_cancel_count';
  v_acc record;
  v_count record;
  v_replay jsonb;
  v_code text;
  v_reason text := public.fn_inv_jtext(p_payload->'reason');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_status text;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select c.* into v_count from public.tbl_inv_counts c where c.id = public.fn_inv_jbigint(p_payload->'count_id');
  if not found or not public.fn_inv_can('COUNT', v_count.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_reason is null or length(v_reason) not between 5 and 500 then
    return public.fn_inv_err('JUSTIFICATION_REQUIRED');
  end if;

  select c.status into v_status from public.tbl_inv_counts c where c.id = v_count.id for update;
  if v_status not in ('IN_PROGRESS','SUBMITTED') then
    return public.fn_inv_err('COUNT_BAD_STATUS');
  end if;
  if v_status = 'SUBMITTED' and not public.fn_inv_can('COUNT_INVESTIGATE', v_count.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if v_staff is not null or v_status = 'SUBMITTED' then
    v_code := public.fn_inv_check_staff(v_staff, v_count.branch_id, v_status = 'SUBMITTED');
    if v_code is not null then
      return public.fn_inv_err(v_code);
    end if;
  end if;
  perform set_config('inv.posting', 'on', true);
  update public.tbl_inv_counts c
     set status = 'CANCELLED', investigation_summary = v_reason, closed_at = now(), updated_at = now()
   where c.id = v_count.id;

  v_result := public.fn_inv_ok(jsonb_build_object('count_id', v_count.id, 'status', 'CANCELLED'));
  perform public.fn_inv_audit('COUNT_CANCELLED', 'count', v_count.id::text, v_count.branch_id, v_staff, null, p_key,
    v_reason, jsonb_build_object('count_no', v_count.count_no, 'from_status', v_status));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- Grants: RE-RUN schema/013_inventory_grants.sql after this file (catalog-driven).

-- Nothing this file created is reachable through the API until 013 (audit V-1).
select public.fn_inv_lockdown();

commit;
