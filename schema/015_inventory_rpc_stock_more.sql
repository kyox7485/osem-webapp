-- ============================================================================
-- 015 — General Inventory: the deferred stock RPCs Phase 3 screens need
-- ============================================================================
-- inv_post_opening_balance    OPENING_BALANCE (ADMIN; D-117 window; cost INPUT)
-- inv_post_return_from_issue  RETURN_FROM_ISSUE (STAFF; cost ORIGINAL; RETURN_CREDIT, D-51/D-131)
-- inv_post_return_to_supplier RETURN_TO_SUPPLIER (Head-Nurse tier; cost WAC; D-52)
-- inv_request_adjustment      PENDING adjustment (Head-Nurse tier; D-61)
-- inv_decide_adjustment       APPROVE (posts ADJUSTMENT, MOD/ADMIN ≠ requester, D-82)
--                             / REJECT (MOD/ADMIN) / CANCEL (requester tier)
-- + a guard: an ISSUE with standing returns cannot be reversed (reverse the
--   returns first), so a return and the issue reversal never both credit it.
--
-- Same RPC contract and posting path as 010 (payload shape → capability on the
-- branch of the row acted on → idempotency → plan → lock → rules → write →
-- audit → store). Apply after 014, then RE-RUN 013_inventory_grants.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Guard: no reversal of an ISSUE that still has standing returns
-- ----------------------------------------------------------------------------
create or replace function public.fn_inv_guard_issue_reversal() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.txn_type = 'REVERSAL'
     and exists (select 1 from public.tbl_inv_txns o where o.id = new.reverses_txn_id and o.txn_type = 'ISSUE')
     and exists (select 1 from public.tbl_inv_txn_lines il
                   join public.tbl_inv_txn_lines rl on rl.source_line_id = il.id
                   join public.tbl_inv_txns rt on rt.id = rl.txn_id and rt.txn_type = 'RETURN_FROM_ISSUE'
                  where il.txn_id = new.reverses_txn_id
                    and not exists (select 1 from public.tbl_inv_txns x where x.reverses_txn_id = rt.id)) then
    raise exception 'INV_ISSUE_HAS_RETURNS: reverse the returns of this issue first' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_inv_issue_reversal_guard on public.tbl_inv_txns;
create trigger trg_inv_issue_reversal_guard before insert on public.tbl_inv_txns
  for each row execute function public.fn_inv_guard_issue_reversal();

-- Base-unit qty already returned against an issue line (standing returns only).
create or replace function public.fn_inv_returned_qty(p_issue_line_id bigint)
returns table (qty numeric, value numeric)
language sql stable set search_path = '' as $$
  select coalesce(sum(rl.qty_base), 0), coalesce(sum(rl.value), 0)
    from public.tbl_inv_txn_lines rl
    join public.tbl_inv_txns rt on rt.id = rl.txn_id and rt.txn_type = 'RETURN_FROM_ISSUE'
   where rl.source_line_id = p_issue_line_id
     and not exists (select 1 from public.tbl_inv_txns x where x.reverses_txn_id = rt.id)
$$;

-- ----------------------------------------------------------------------------
-- inv_post_opening_balance (tier ADMIN; D-117)
-- payload: {performed_by_staff, remarks?, lines:[{location_id, product_id, uom_id,
--   qty, unit_cost (per entered UOM), resident_id? (TRANSIT only)}], sanity_confirmed?}
-- Allowed only while fn_inv_today() is within opening_window_days of the
-- branch go-live date (either side); always dated go_live_date; per product
-- only while the branch pool holds nothing but opening lines (and their
-- reversals).
-- ----------------------------------------------------------------------------
create or replace function public.inv_post_opening_balance(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_post_opening_balance';
  v_acc record;
  v_branch bigint;
  v_n int;
  v_missing boolean;
  v_replay jsonb;
  v_set record;
  v_code text;
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  l jsonb;
  v_loc record;
  v_item jsonb;
  v_cost numeric;
  v_res bigint;
  v_res_branch bigint;
  v_seen jsonb := '[]';
  v_lines jsonb := '[]';
  v_value numeric;
  v_sanity jsonb := '[]';
  v_txn_id bigint;
  v_txns jsonb;
  v_res_w jsonb;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') not between 1 and 200 then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select min(lo.branch_id), count(distinct lo.branch_id), bool_or(lo.id is null)
    into v_branch, v_n, v_missing
    from jsonb_array_elements(p_payload->'lines') x
    left join public.tbl_inv_locations lo on lo.id = public.fn_inv_jbigint(x->'location_id');
  if v_missing or v_n <> 1 then
    return public.fn_inv_err(case when v_missing then 'FORBIDDEN' else 'MIXED_BRANCHES' end);
  end if;
  if not public.fn_inv_can('OPENING_BALANCE', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  select s.is_enabled, s.go_live_date, s.opening_window_days into v_set
    from public.tbl_inv_branch_settings s where s.branch_id = v_branch;
  if not found or not v_set.is_enabled or v_set.go_live_date is null then
    return public.fn_inv_err('INVENTORY_NOT_ENABLED');
  end if;
  if public.fn_inv_today() not between v_set.go_live_date - v_set.opening_window_days
                                   and v_set.go_live_date + v_set.opening_window_days then
    return public.fn_inv_err('OPENING_WINDOW_CLOSED', null,
      jsonb_build_object('go_live_date', v_set.go_live_date, 'window_days', v_set.opening_window_days));
  end if;
  v_code := public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('OPENING_BALANCE'));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_remarks is not null and length(v_remarks) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'remarks'));
  end if;

  v_n := 0;
  for l in select * from jsonb_array_elements(p_payload->'lines') loop
    v_n := v_n + 1;
    select * into v_loc from public.fn_inv_location_of(public.fn_inv_jbigint(l->'location_id'));
    v_item := public.fn_inv_resolve_item(v_branch, public.fn_inv_jbigint(l->'product_id'),
                public.fn_inv_jbigint(l->'uom_id'), public.fn_inv_jnum(l->'qty'), true);
    if v_item ? 'error' then
      return public.fn_inv_err(v_item->>'error', null, jsonb_build_object('line', v_n));
    end if;
    v_cost := public.fn_inv_jnum(l->'unit_cost');
    if v_cost is null or v_cost < 0 then
      return public.fn_inv_err('INVALID_COST', null, jsonb_build_object('line', v_n));
    end if;
    if v_cost > 100000 then
      return public.fn_inv_err('COST_TOO_LARGE', null, jsonb_build_object('line', v_n));
    end if;
    v_res := null;
    if v_loc.kind = 'TRANSIT' then
      select r.id, r.branch_id into v_res, v_res_branch from public.tbl_residents r
       where r.id = public.fn_inv_jbigint(l->'resident_id');
      if v_res is null then
        return public.fn_inv_err('RESIDENT_NOT_FOUND', null, jsonb_build_object('line', v_n));
      end if;
      if v_res_branch <> v_branch then
        return public.fn_inv_err('RESIDENT_WRONG_BRANCH', null, jsonb_build_object('line', v_n));
      end if;
    end if;
    if v_seen @> jsonb_build_array(jsonb_build_array(v_loc.id, (v_item->>'product_id')::bigint, coalesce(v_res, 0))) then
      return public.fn_inv_err('DUPLICATE_LINE', null, jsonb_build_object('line', v_n));
    end if;
    v_seen := v_seen || jsonb_build_array(jsonb_build_array(v_loc.id, (v_item->>'product_id')::bigint, coalesce(v_res, 0)));
    if exists (select 1 from public.tbl_inv_txn_lines tl
                 join public.tbl_inv_txns t on t.id = tl.txn_id
                where tl.branch_id = v_branch and tl.product_id = (v_item->>'product_id')::bigint
                  and not (t.txn_type = 'OPENING_BALANCE'
                           or (t.txn_type = 'REVERSAL' and exists (select 1 from public.tbl_inv_txns o
                                where o.id = t.reverses_txn_id and o.txn_type = 'OPENING_BALANCE')))) then
      return public.fn_inv_err('OPENING_POOL_HAS_ACTIVITY', null, jsonb_build_object('line', v_n));
    end if;
    v_value := round((v_item->>'qty_entered')::numeric * v_cost, 4);
    if v_value > 5000 or public.fn_inv_qty_insane(v_loc.id, (v_item->>'product_id')::bigint, (v_item->>'qty_base')::numeric) then
      v_sanity := v_sanity || jsonb_build_array(jsonb_build_object('line_no', v_n,
        'product_id', (v_item->>'product_id')::bigint, 'reason', case when v_value > 5000 then 'LINE_TOTAL' else 'QTY' end));
    end if;
    v_lines := v_lines || jsonb_build_array(public.fn_inv_line_spec(public.fn_inv_next_id('tbl_inv_txn_lines'), v_n,
                 v_loc.id, v_loc.kind, v_res, v_item, 1, 'IN_SPEC', v_value, 'INPUT'));
  end loop;
  if jsonb_array_length(v_sanity) > 0 and not public.fn_inv_jbool(p_payload->'sanity_confirmed') then
    return public.fn_inv_err('SANITY_CONFIRM', 'Please re-check the flagged lines', v_sanity);
  end if;

  v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  v_txns := jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_type', 'OPENING_BALANCE', 'branch_id', v_branch,
    'txn_date', v_set.go_live_date, 'performed_by_staff', v_staff, 'remarks', v_remarks,
    'sanity_confirmed', public.fn_inv_jbool(p_payload->'sanity_confirmed'), 'lines', v_lines));
  v_res_w := public.fn_inv_lock_and_write(v_txns, null, false, v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;
  v_result := public.fn_inv_ok(jsonb_build_object('txn_id', v_txn_id, 'txn_no', v_res_w->'written'->'txns'->0->>'txn_no',
    'txn_date', v_set.go_live_date));
  perform public.fn_inv_audit('OPENING_POSTED', 'txn', v_txn_id::text, v_branch, v_staff, v_txn_id, p_key, null,
    jsonb_build_object('lines', jsonb_array_length(v_lines)));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_post_return_from_issue (tier STAFF; D-51, D-131)
-- payload: {location_id (where the goods go back: STORE, FLOOR, or TRANSIT for
--   the issue's own resident), txn_date, performed_by_staff, remarks?,
--   lines:[{issue_line_id, uom_id, qty}]}
-- Comes back at the issue line's unit cost; qty ≤ issued − already returned.
-- Each line credits the issue's charge: RETURN_CREDIT at the frozen price for a
-- resident (0 when that charge was PRICE_PENDING), cost-only for OSEM expense.
-- ----------------------------------------------------------------------------
create or replace function public.inv_post_return_from_issue(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_post_return_from_issue';
  v_acc record;
  v_loc record;
  v_branch bigint;
  v_replay jsonb;
  v_code text;
  v_date date := public.fn_inv_jdate(p_payload->'txn_date');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  l jsonb;
  v_ids bigint[] := '{}';
  v_line_id bigint;
  v_il record;
  v_ret record;
  v_item jsonb;
  v_avail numeric;
  v_value numeric;
  v_n int := 0;
  v_lines jsonb := '[]';
  v_links jsonb := '[]';
  v_new_id bigint;
  v_txn_id bigint;
  v_txns jsonb;
  v_res_w jsonb;
  v_credit numeric;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') not between 1 and 200 then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_loc from public.fn_inv_location_of(public.fn_inv_jbigint(p_payload->'location_id'));
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_branch := v_loc.branch_id;
  if not public.fn_inv_can('RETURN_FROM_ISSUE', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, v_date),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('RETURN_FROM_ISSUE')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_remarks is not null and length(v_remarks) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'remarks'));
  end if;

  -- issue lines: same branch, duplicates rejected; then serialise per line (§4.6 step 2)
  for l in select * from jsonb_array_elements(p_payload->'lines') loop
    v_n := v_n + 1;
    v_line_id := public.fn_inv_jbigint(l->'issue_line_id');
    if v_line_id is null or not exists (select 1 from public.tbl_inv_txn_lines il
                                          where il.id = v_line_id and il.branch_id = v_branch and il.txn_type = 'ISSUE') then
      return public.fn_inv_err('ISSUE_LINE_NOT_FOUND', null, jsonb_build_object('line', v_n));
    end if;
    if v_line_id = any (v_ids) then
      return public.fn_inv_err('DUPLICATE_LINE', null, jsonb_build_object('line', v_n));
    end if;
    v_ids := v_ids || v_line_id;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('inv_ret:' || x::text, 0))
     from unnest(v_ids) x order by x;

  v_n := 0;
  v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  for l in select * from jsonb_array_elements(p_payload->'lines') loop
    v_n := v_n + 1;
    select il.id, il.txn_id, il.product_id, il.qty_base, il.value, il.unit_cost,
           c.id as charge_id, c.target, c.resident_id
      into v_il
      from public.tbl_inv_txn_lines il
      left join public.tbl_inv_charges c on c.txn_line_id = il.id and c.charge_kind = 'ISSUE'
     where il.id = public.fn_inv_jbigint(l->'issue_line_id');
    if exists (select 1 from public.tbl_inv_txns r where r.reverses_txn_id = v_il.txn_id) then
      return public.fn_inv_err('ISSUE_REVERSED', null, jsonb_build_object('line', v_n));
    end if;
    v_item := public.fn_inv_resolve_item(v_branch, v_il.product_id, public.fn_inv_jbigint(l->'uom_id'),
                public.fn_inv_jnum(l->'qty'), true);
    if v_item ? 'error' then
      return public.fn_inv_err(v_item->>'error', null, jsonb_build_object('line', v_n));
    end if;
    if v_loc.kind = 'TRANSIT' and (v_il.target is distinct from 'RESIDENT' or v_il.resident_id is null) then
      return public.fn_inv_err('INVALID_LOCATIONS', null, jsonb_build_object('line', v_n));   -- D-22
    end if;
    select * into v_ret from public.fn_inv_returned_qty(v_il.id);
    v_avail := -v_il.qty_base - v_ret.qty;
    if (v_item->>'qty_base')::numeric > v_avail then
      return public.fn_inv_err('RETURN_EXCEEDS_ISSUED', null,
        jsonb_build_object('line', v_n, 'available_base', v_avail));
    end if;
    -- the last units back take the exact remaining issue value (no rounding residue)
    v_value := case when (v_item->>'qty_base')::numeric = v_avail then -v_il.value - v_ret.value
                    else round((v_item->>'qty_base')::numeric * v_il.unit_cost, 4) end;
    v_new_id := public.fn_inv_next_id('tbl_inv_txn_lines');
    v_lines := v_lines || jsonb_build_array(public.fn_inv_line_spec(v_new_id, v_n, v_loc.id, v_loc.kind,
                 case when v_loc.kind = 'TRANSIT' then v_il.resident_id end, v_item, 1, 'IN_SPEC', v_value, 'ORIGINAL',
                 null, v_il.id));
    v_links := v_links || jsonb_build_array(jsonb_build_object('line_id', v_new_id, 'charge_id', v_il.charge_id,
                 'last', (v_item->>'qty_base')::numeric = v_avail));
  end loop;

  v_txns := jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_type', 'RETURN_FROM_ISSUE', 'branch_id', v_branch,
    'txn_date', v_date, 'performed_by_staff', v_staff, 'remarks', v_remarks, 'lines', v_lines));
  v_res_w := public.fn_inv_lock_and_write(v_txns, null, false, v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;

  -- credits (D-72: original price; OSEM expense: cost only)
  insert into public.tbl_inv_charges (branch_id, billing_period_id, charge_date, charge_kind, target, resident_id,
    expense_note, txn_id, txn_line_id, related_charge_id, product_id, product_name, sku, uom_code, qty_base,
    unit_charge_price, charge_amount, cost_amount, request_key, created_by_account, created_by_staff)
  select t.branch_id, t.billing_period_id, t.txn_date, 'RETURN_CREDIT', c.target, c.resident_id, c.expense_note,
         t.id, rl.id, c.id, c.product_id, c.product_name, c.sku, c.uom_code, -rl.qty_base, c.unit_charge_price,
         case when c.target <> 'RESIDENT' then 0
              -- the last units back credit exactly what is left of the charge (no 1-sen residue)
              when (k->>'last')::boolean then
                -(c.charge_amount
                  + coalesce((select sum(x.charge_amount) from public.tbl_inv_charges x
                               where x.related_charge_id = c.id and x.charge_kind = 'RETURN_CREDIT'
                                 and x.txn_id <> t.id), 0)
                  + coalesce((select sum(y.charge_amount) from public.tbl_inv_charges y
                                join public.tbl_inv_charges x on x.id = y.related_charge_id
                               where x.related_charge_id = c.id and x.charge_kind = 'RETURN_CREDIT'
                                 and y.charge_kind = 'REVERSAL'), 0))
              else -coalesce(round(rl.qty_base * c.unit_charge_price, 2), 0) end,
         -rl.value, p_key, v_acc.account_id, v_staff
    from jsonb_array_elements(v_links) k
    join public.tbl_inv_txn_lines rl on rl.id = (k->>'line_id')::bigint
    join public.tbl_inv_txns t on t.id = rl.txn_id
    join public.tbl_inv_charges c on c.id = (k->>'charge_id')::bigint;
  select coalesce(sum(c.charge_amount), 0) into v_credit from public.tbl_inv_charges c where c.txn_id = v_txn_id;

  v_result := public.fn_inv_ok(jsonb_build_object('txn_id', v_txn_id, 'txn_no', v_res_w->'written'->'txns'->0->>'txn_no',
    'credit_amount', v_credit));
  perform public.fn_inv_audit('RETURN_FROM_ISSUE_POSTED', 'txn', v_txn_id::text, v_branch, v_staff, v_txn_id, p_key, null,
    jsonb_build_object('lines', jsonb_array_length(v_lines), 'credit_amount', v_credit));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_post_return_to_supplier (tier HEAD_NURSE, senior staff; D-52)
-- payload: {location_id (STORE), supplier_id, receipt_id?, supplier_credit_value?,
--   txn_date, performed_by_staff, remarks?, lines:[{product_id, uom_id, qty}],
--   allow_negative?, sanity_confirmed?}
-- Goes out at WAC; the supplier's credit value is information only (audit).
-- With receipt_id every product must be on that (non-voided) receipt.
-- ----------------------------------------------------------------------------
create or replace function public.inv_post_return_to_supplier(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_post_return_to_supplier';
  v_acc record;
  v_loc record;
  v_branch bigint;
  v_replay jsonb;
  v_code text;
  v_date date := public.fn_inv_jdate(p_payload->'txn_date');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_credit numeric := public.fn_inv_jnum_opt(p_payload->'supplier_credit_value', 10000000, 2);
  v_supplier record;
  v_receipt_id bigint;
  v_resolved jsonb;
  v_item jsonb;
  v_lines jsonb := '[]';
  v_txn_id bigint;
  v_txns jsonb;
  v_sanity jsonb;
  v_res_w jsonb;
  v_value numeric;
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
  if not public.fn_inv_can('RETURN_TO_SUPPLIER', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_loc.kind <> 'STORE' then
    return public.fn_inv_err('LOCATION_NOT_STORE');
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, v_date),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('RETURN_TO_SUPPLIER')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if (v_remarks is not null and length(v_remarks) > 500) or v_credit = -1 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'remarks/supplier_credit_value'));
  end if;
  select s.id, s.name into v_supplier from public.tbl_inv_suppliers s
   where s.id = public.fn_inv_jbigint(p_payload->'supplier_id')
     and (s.owner_branch_id is null or s.owner_branch_id = v_branch);
  if not found then
    return public.fn_inv_err('SUPPLIER_NOT_FOUND');
  end if;
  if p_payload->'receipt_id' is not null and jsonb_typeof(p_payload->'receipt_id') <> 'null' then
    select r.id into v_receipt_id from public.tbl_inv_receipts r
     where r.id = public.fn_inv_jbigint(p_payload->'receipt_id') and r.branch_id = v_branch
       and not r.is_voided and r.supplier_id = v_supplier.id;
    if v_receipt_id is null then
      return public.fn_inv_err('RECEIPT_NOT_FOUND');
    end if;
  end if;
  v_resolved := public.fn_inv_resolve_lines(v_branch, p_payload->'lines', true);
  if v_resolved ? 'error' then
    return public.fn_inv_err(v_resolved->>'error', null, v_resolved);
  end if;
  v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  for v_item in select * from jsonb_array_elements(v_resolved->'items') loop
    if v_receipt_id is not null and not exists (select 1 from public.tbl_inv_receipt_lines rl
         where rl.receipt_id = v_receipt_id and rl.product_id = (v_item->>'product_id')::bigint) then
      return public.fn_inv_err('PRODUCT_NOT_ON_RECEIPT', null, jsonb_build_object('line', v_item->'line_no'));
    end if;
    v_lines := v_lines || jsonb_build_array(public.fn_inv_line_spec(public.fn_inv_next_id('tbl_inv_txn_lines'),
                 (v_item->>'line_no')::int, v_loc.id, 'STORE', null, v_item, -1, 'OUT_WAC'));
  end loop;
  v_txns := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', v_txn_id, 'txn_type', 'RETURN_TO_SUPPLIER',
    'branch_id', v_branch, 'txn_date', v_date, 'performed_by_staff', v_staff, 'remarks', v_remarks,
    'sanity_confirmed', public.fn_inv_jbool(p_payload->'sanity_confirmed'),
    'source_doc_type', case when v_receipt_id is not null then 'RECEIPT' end, 'source_doc_id', v_receipt_id,
    'lines', v_lines)));
  v_sanity := public.fn_inv_plan_qty_sanity(v_txns);
  if v_sanity is not null and not public.fn_inv_jbool(p_payload->'sanity_confirmed') then
    return public.fn_inv_err('SANITY_CONFIRM', 'Please re-check the flagged lines', v_sanity);
  end if;
  v_res_w := public.fn_inv_lock_and_write(v_txns, null, public.fn_inv_jbool(p_payload->'allow_negative'),
                                          v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;
  select -coalesce(sum(l.value), 0) into v_value from public.tbl_inv_txn_lines l where l.txn_id = v_txn_id;
  v_result := public.fn_inv_ok(jsonb_build_object('txn_id', v_txn_id, 'txn_no', v_res_w->'written'->'txns'->0->>'txn_no',
    'value', v_value, 'supplier_credit_value', v_credit, 'negative_stock', v_res_w->'negative'));
  perform public.fn_inv_audit('RETURN_TO_SUPPLIER_POSTED', 'txn', v_txn_id::text, v_branch, v_staff, v_txn_id, p_key, null,
    jsonb_build_object('supplier_id', v_supplier.id, 'supplier_name', v_supplier.name, 'receipt_id', v_receipt_id,
                       'value', v_value, 'supplier_credit_value', v_credit));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_request_adjustment (tier HEAD_NURSE, senior staff; D-61)
-- payload: {location_id, reason_code, justification, performed_by_staff,
--   branch_transfer_id? (D-33: must be a transfer INTO this branch),
--   lines:[{product_id, resident_id? (TRANSIT only), qty_delta_base (signed, base UOM)}],
--   sanity_confirmed?}
-- Nothing posts until a MODERATOR/ADMIN (another login) approves it.
-- ----------------------------------------------------------------------------
create or replace function public.inv_request_adjustment(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_request_adjustment';
  v_acc record;
  v_loc record;
  v_branch bigint;
  v_replay jsonb;
  v_code text;
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := public.fn_inv_jtext(p_payload->'reason_code');
  v_just text := public.fn_inv_jtext(p_payload->'justification');
  v_transfer bigint;
  l jsonb;
  v_n int := 0;
  v_base_uom bigint;
  v_delta numeric;
  v_item jsonb;
  v_res bigint;
  v_res_branch bigint;
  v_lines jsonb := '[]';
  v_sanity jsonb := '[]';
  v_lock jsonb;
  v_adj_id bigint;
  v_adj_no text;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') not between 1 and 200 then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_loc from public.fn_inv_location_of(public.fn_inv_jbigint(p_payload->'location_id'));
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_branch := v_loc.branch_id;
  if not public.fn_inv_can('ADJUSTMENT_REQUEST', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, public.fn_inv_today()),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('ADJUSTMENT_REQUEST')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_reason is null or v_reason not in ('DAMAGED','EXPIRED','COUNT_VARIANCE','FOUND','LOST','TRANSFER_DISCREPANCY',
                                          'DATA_ENTRY','OTHER') then
    return public.fn_inv_err('INVALID_REASON');
  end if;
  if v_just is null or length(v_just) not between 5 and 1000 then
    return public.fn_inv_err('JUSTIFICATION_REQUIRED');
  end if;
  if p_payload->'branch_transfer_id' is not null and jsonb_typeof(p_payload->'branch_transfer_id') <> 'null' then
    select t.id into v_transfer from public.tbl_inv_branch_transfers t
     where t.id = public.fn_inv_jbigint(p_payload->'branch_transfer_id') and t.to_branch_id = v_branch;
    if v_transfer is null then
      return public.fn_inv_err('TRANSFER_NOT_FOUND');
    end if;
  end if;

  for l in select * from jsonb_array_elements(p_payload->'lines') loop
    v_n := v_n + 1;
    v_delta := public.fn_inv_jnum(l->'qty_delta_base');
    if v_delta is null or v_delta = 0 then
      return public.fn_inv_err('INVALID_QTY', null, jsonb_build_object('line', v_n));
    end if;
    v_base_uom := (select p.base_uom_id from public.tbl_inv_products p where p.id = public.fn_inv_jbigint(l->'product_id'));
    v_item := public.fn_inv_resolve_item(v_branch, public.fn_inv_jbigint(l->'product_id'), v_base_uom,
                abs(v_delta), true);
    if v_item ? 'error' then
      return public.fn_inv_err(v_item->>'error', null, jsonb_build_object('line', v_n));
    end if;
    v_res := null;
    if v_loc.kind = 'TRANSIT' then
      select r.id, r.branch_id into v_res, v_res_branch from public.tbl_residents r
       where r.id = public.fn_inv_jbigint(l->'resident_id');
      if v_res is null then
        return public.fn_inv_err('RESIDENT_NOT_FOUND', null, jsonb_build_object('line', v_n));
      end if;
      -- an existing bucket is authoritative (D-107); a new + bucket needs a resident of the branch
      if v_res_branch <> v_branch and not exists (select 1 from public.tbl_inv_balances b
           where b.location_id = v_loc.id and b.resident_id = v_res and b.product_id = (v_item->>'product_id')::bigint) then
        return public.fn_inv_err('RESIDENT_WRONG_BRANCH', null, jsonb_build_object('line', v_n));
      end if;
    end if;
    if exists (select 1 from jsonb_array_elements(v_lines) x
                where (x->>'product_id')::bigint = (v_item->>'product_id')::bigint
                  and (x->>'resident_id')::bigint is not distinct from v_res) then
      return public.fn_inv_err('DUPLICATE_LINE', null, jsonb_build_object('line', v_n));
    end if;
    if public.fn_inv_qty_insane(v_loc.id, (v_item->>'product_id')::bigint, v_delta) then
      v_sanity := v_sanity || jsonb_build_array(jsonb_build_object('line_no', v_n,
        'product_id', (v_item->>'product_id')::bigint, 'qty_base', v_delta));
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', (v_item->>'product_id')::bigint,
      'resident_id', v_res, 'qty', v_delta));
  end loop;
  if jsonb_array_length(v_sanity) > 0 and not public.fn_inv_jbool(p_payload->'sanity_confirmed') then
    return public.fn_inv_err('SANITY_CONFIRM', 'Please re-check the flagged lines', v_sanity);
  end if;

  v_lock := public.fn_inv_lock('[]'::jsonb, null, jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'doc_type', 'ADJ')));
  v_adj_no := public.fn_inv_next_no(v_branch, 'ADJ');
  insert into public.tbl_inv_adjustments (adjustment_no, branch_id, location_id, branch_transfer_id, status, reason_code,
    justification, requested_by_staff, requested_by_account)
  values (v_adj_no, v_branch, v_loc.id, v_transfer, 'PENDING', v_reason, v_just, v_staff, v_acc.account_id)
  returning id into v_adj_id;
  insert into public.tbl_inv_adjustment_lines (adjustment_id, branch_id, product_id, resident_id, qty_delta_base)
  select v_adj_id, v_branch, (x->>'product_id')::bigint, (x->>'resident_id')::bigint, (x->>'qty')::numeric
    from jsonb_array_elements(v_lines) x;

  v_result := public.fn_inv_ok(jsonb_build_object('adjustment_id', v_adj_id, 'adjustment_no', v_adj_no));
  perform public.fn_inv_audit('ADJUSTMENT_REQUESTED', 'adjustment', v_adj_id::text, v_branch, v_staff, null, p_key,
    v_reason, jsonb_build_object('adjustment_no', v_adj_no, 'lines', v_lines));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_decide_adjustment
-- payload: {adjustment_id, decision: APPROVE|REJECT|CANCEL, performed_by_staff,
--   note?, allow_negative?}
--   APPROVE (MOD/ADMIN, another login and another staff member than the
--     requester, D-82): posts one ADJUSTMENT txn dated today (D-61):
--     − lines at WAC (fallback/pending as usual); + lines at WAC, else the
--     standard cost, else 0 with PENDING_COST (D-53, D-118).
--   REJECT (MOD/ADMIN, another login).  CANCEL (the requesting login).
-- ----------------------------------------------------------------------------
create or replace function public.inv_decide_adjustment(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_decide_adjustment';
  v_acc record;
  v_adj record;
  v_replay jsonb;
  v_code text;
  v_decision text := public.fn_inv_jtext(p_payload->'decision');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_note text := public.fn_inv_jtext(p_payload->'note');
  v_status text;
  v_today date := public.fn_inv_today();
  v_l record;
  v_n int := 0;
  v_item jsonb;
  v_unit numeric;
  v_src text;
  v_lines jsonb := '[]';
  v_txn_id bigint;
  v_txns jsonb;
  v_res_w jsonb;
  v_txn_no text;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or v_decision is null
     or v_decision not in ('APPROVE','REJECT','CANCEL') then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select a.* into v_adj from public.tbl_inv_adjustments a where a.id = public.fn_inv_jbigint(p_payload->'adjustment_id');
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if not public.fn_inv_can(case when v_decision = 'CANCEL' then 'ADJUSTMENT_REQUEST' else 'ADJUSTMENT_APPROVE' end,
                           v_adj.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := public.fn_inv_check_staff(v_staff, v_adj.branch_id, false);
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_note is not null and length(v_note) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'note'));
  end if;
  if v_decision = 'CANCEL' and v_adj.requested_by_account <> v_acc.account_id then
    return public.fn_inv_err('FORBIDDEN', 'Only the requesting login can cancel');
  end if;
  if v_decision <> 'CANCEL' and v_adj.requested_by_account = v_acc.account_id then
    return public.fn_inv_err('SOD_SAME_ACCOUNT');                           -- D-82
  end if;
  if v_decision = 'APPROVE' and v_adj.requested_by_staff = v_staff then
    return public.fn_inv_err('SOD_SAME_STAFF');                             -- D-82
  end if;

  -- document lock first (D-111 step 1), then the state it guards
  select a.status into v_status from public.tbl_inv_adjustments a where a.id = v_adj.id for update;
  if v_status <> 'PENDING' then
    return public.fn_inv_err('ADJUSTMENT_NOT_PENDING');
  end if;

  if v_decision = 'APPROVE' then
    v_code := public.fn_inv_check_branch_date(v_adj.branch_id, v_today);
    if v_code is not null then
      return public.fn_inv_err(v_code);
    end if;
    v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
    for v_l in
      select al.product_id, al.resident_id, al.qty_delta_base, lo.kind, p.base_uom_id, u.code as uom_code,
             p.standard_unit_cost, cp.wac
        from public.tbl_inv_adjustment_lines al
        join public.tbl_inv_locations lo on lo.id = v_adj.location_id
        join public.tbl_inv_products p on p.id = al.product_id
        join public.tbl_inv_uoms u on u.id = p.base_uom_id
        left join public.tbl_inv_cost_pools cp on cp.branch_id = v_adj.branch_id and cp.product_id = al.product_id
       where al.adjustment_id = v_adj.id
       order by al.id
    loop
      v_n := v_n + 1;
      v_item := jsonb_build_object('product_id', v_l.product_id, 'uom_id', v_l.base_uom_id, 'uom_code', v_l.uom_code,
        'qty_entered', abs(v_l.qty_delta_base), 'factor', 1, 'qty_base', abs(v_l.qty_delta_base));
      if v_l.qty_delta_base < 0 then
        v_lines := v_lines || jsonb_build_array(public.fn_inv_line_spec(public.fn_inv_next_id('tbl_inv_txn_lines'), v_n,
                     v_adj.location_id, v_l.kind, v_l.resident_id, v_item, -1, 'OUT_WAC'));
      else
        v_unit := coalesce(v_l.wac, v_l.standard_unit_cost, 0);
        v_src := case when v_l.wac is not null then 'WAC' when v_l.standard_unit_cost is not null then 'MASTER_FALLBACK'
                      else 'PENDING_COST' end;
        v_lines := v_lines || jsonb_build_array(public.fn_inv_line_spec(public.fn_inv_next_id('tbl_inv_txn_lines'), v_n,
                     v_adj.location_id, v_l.kind, v_l.resident_id, v_item, 1, 'IN_SPEC',
                     round(v_l.qty_delta_base * v_unit, 4), v_src));
      end if;
    end loop;
    v_txns := jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_type', 'ADJUSTMENT', 'branch_id', v_adj.branch_id,
      'txn_date', v_today, 'performed_by_staff', v_adj.requested_by_staff, 'reason_code', v_adj.reason_code,
      'remarks', left(v_adj.adjustment_no || ': ' || v_adj.justification, 500),
      'source_doc_type', 'ADJUSTMENT', 'source_doc_id', v_adj.id, 'lines', v_lines));
    v_res_w := public.fn_inv_lock_and_write(v_txns, null, public.fn_inv_jbool(p_payload->'allow_negative'),
                                            v_acc.account_id, p_key);
    if not (v_res_w->>'ok')::boolean then
      return public.fn_inv_finish(v_res_w);
    end if;
    v_txn_no := v_res_w->'written'->'txns'->0->>'txn_no';
    update public.tbl_inv_adjustments a
       set status = 'APPROVED', txn_id = v_txn_id, decided_by_staff = v_staff, decided_by_account = v_acc.account_id,
           decided_at = now(), decision_note = v_note
     where a.id = v_adj.id;
  else
    perform set_config('inv.posting', 'on', true);
    update public.tbl_inv_adjustments a
       set status = case when v_decision = 'REJECT' then 'REJECTED' else 'CANCELLED' end,
           decided_by_staff = v_staff,
           decided_by_account = case when v_decision = 'REJECT' then v_acc.account_id end,   -- CHECK ≠ requester
           decided_at = now(), decision_note = v_note
     where a.id = v_adj.id;
  end if;

  v_result := public.fn_inv_ok(jsonb_build_object('adjustment_id', v_adj.id, 'decision', v_decision,
    'txn_id', v_txn_id, 'txn_no', v_txn_no,
    'negative_stock', case when v_res_w is not null then v_res_w->'negative' end));
  perform public.fn_inv_audit('ADJUSTMENT_' || v_decision, 'adjustment', v_adj.id::text, v_adj.branch_id, v_staff, v_txn_id,
    p_key, v_note, jsonb_build_object('adjustment_no', v_adj.adjustment_no));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- Grants: RE-RUN schema/013_inventory_grants.sql after this file (catalog-driven).

-- Nothing this file created is reachable through the API until 013 (audit V-1).
select public.fn_inv_lockdown();

commit;
