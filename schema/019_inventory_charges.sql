-- ============================================================================
-- 019 — General Inventory: Charging and month-end (Phase 6)
-- ============================================================================
-- inv_price_charge              tier PRICE_PENDING: MOD/ADMIN prices a PRICE_PENDING charge
--                               by inserting one PRICING child (D-121, D-160)
-- inv_manual_charge_adjustment  tier MANUAL_CHARGE_ADJ: management correction posted into
--                               an OPEN month (D-75, D-161)
-- inv_set_resident_billing_code tier BILLING_CODES: the Bukku customer code per resident (D-122)
-- inv_export_charges            tier EXPORT: ITEMISED / SUMMARY charge export, delta by default
--                               (D-122, D-163). The CSV itself is built in the app.
-- v_inv_exceptions              month-end exception list (D-108, D-164), MOD+ only
--
-- Also: tbl_inv_charges may hold a MANUAL_ADJUSTMENT without a related charge
-- (the 007 check demanded one), and tbl_inv_charge_exports gets is_full.
-- Apply after 018, then RE-RUN 013_inventory_grants.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Schema tweaks
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname from pg_catalog.pg_constraint c
     where c.conrelid = 'public.tbl_inv_charges'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%related_charge_id IS NOT NULL%'
       and pg_get_constraintdef(c.oid) not like '%product_id%'
  loop
    execute format('alter table public.tbl_inv_charges drop constraint %I', r.conname);
  end loop;
  alter table public.tbl_inv_charges add constraint chk_inv_charges_related
    check (charge_kind in ('ISSUE','SERVICE','MANUAL_ADJUSTMENT') or related_charge_id is not null);
exception when duplicate_object then
  null;   -- re-run: the new constraint is already there
end $$;

alter table public.tbl_inv_charge_exports add column if not exists is_full boolean not null default false;

-- ----------------------------------------------------------------------------
-- inv_price_charge (tier MODERATOR) — D-121
-- payload: {charge_id, unit_charge_price, reason, performed_by_staff}
-- The original must be an unpriced, unreversed ISSUE/SERVICE resident charge in
-- an OPEN month. amount = round(net qty × price, 2), net qty = original qty
-- less what was already returned (D-160), so a return posted before pricing is
-- not billed twice.
-- ----------------------------------------------------------------------------
create or replace function public.inv_price_charge(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_price_charge';
  v_acc record;
  v_c record;
  v_replay jsonb;
  v_code text;
  v_price numeric := public.fn_inv_jnum(p_payload->'unit_charge_price');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := public.fn_inv_jtext(p_payload->'reason');
  v_lock jsonb;
  v_net numeric;
  v_amount numeric;
  v_new_id bigint;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_c from public.tbl_inv_charges c where c.id = public.fn_inv_jbigint(p_payload->'charge_id');
  if not found or not public.fn_inv_can('PRICE_PENDING', v_c.branch_id) then
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := public.fn_inv_check_staff(v_staff, v_c.branch_id, public.fn_inv_needs_senior_staff('PRICE_PENDING'));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_price is null or v_price < 0 or v_price > 100000 or v_price <> round(v_price, 4) then
    return public.fn_inv_err('INVALID_PRICE');
  end if;
  if v_reason is null or length(v_reason) not between 5 and 500 then
    return public.fn_inv_err('INVALID_REASON');
  end if;
  if v_c.charge_kind not in ('ISSUE','SERVICE') or v_c.target <> 'RESIDENT' or v_c.unit_charge_price is not null then
    return public.fn_inv_err('NOT_PRICE_PENDING');
  end if;
  perform 1 from public.tbl_inv_charges c where c.id = v_c.id for update;
  -- same per-issue-line lock as inv_post_return_from_issue: a return racing this
  -- call either commits first (counted in the net qty) or sees the PRICING row
  if v_c.txn_line_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('inv_ret:' || v_c.txn_line_id::text, 0));
  end if;
  if exists (select 1 from public.tbl_inv_charges x where x.related_charge_id = v_c.id and x.charge_kind = 'PRICING') then
    return public.fn_inv_err('ALREADY_PRICED');
  end if;
  if exists (select 1 from public.tbl_inv_charges x where x.related_charge_id = v_c.id and x.charge_kind = 'REVERSAL') then
    return public.fn_inv_err('ALREADY_REVERSED');
  end if;
  if exists (select 1 from public.tbl_inv_billing_periods p where p.id = v_c.billing_period_id and p.status = 'LOCKED') then
    return public.fn_inv_err('PERIOD_LOCKED');
  end if;
  v_lock := public.fn_inv_lock(null, jsonb_build_array(jsonb_build_object('branch_id', v_c.branch_id,
              'date', v_c.charge_date)), null);
  if public.fn_inv_lock_problem(v_lock) is not null then
    return public.fn_inv_finish(public.fn_inv_lock_problem(v_lock));
  end if;

  select v_c.qty_base + coalesce(sum(x.qty_base), 0) into v_net
    from public.tbl_inv_charges x
   where (x.related_charge_id = v_c.id and x.charge_kind = 'RETURN_CREDIT')
      or (x.charge_kind = 'REVERSAL' and x.related_charge_id in
            (select y.id from public.tbl_inv_charges y where y.related_charge_id = v_c.id and y.charge_kind = 'RETURN_CREDIT'));
  v_amount := round(v_net * v_price, 2);

  insert into public.tbl_inv_charges (branch_id, billing_period_id, charge_date, charge_kind, target, resident_id,
    related_charge_id, product_id, product_name, sku, uom_code, qty_base, unit_charge_price, charge_amount, cost_amount,
    reason, request_key, created_by_account, created_by_staff)
  values (v_c.branch_id, v_c.billing_period_id, v_c.charge_date, 'PRICING', v_c.target, v_c.resident_id,
    v_c.id, v_c.product_id, v_c.product_name, v_c.sku, v_c.uom_code, 0, v_price, v_amount, 0,
    v_reason, p_key, v_acc.account_id, v_staff)
  returning id into v_new_id;

  v_result := public.fn_inv_ok(jsonb_build_object('pricing_charge_id', v_new_id, 'charge_amount', v_amount));
  perform public.fn_inv_audit('CHARGE_PRICED', 'charge', v_c.id::text, v_c.branch_id, v_staff, null, p_key, v_reason,
    jsonb_build_object('pricing_charge_id', v_new_id, 'unit_charge_price', v_price, 'charge_amount', v_amount));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_manual_charge_adjustment (tier MODERATOR) — D-75
-- payload: {resident_id?, related_charge_id?, amount (≠ 0, 2 dp, may be negative),
--   reason (≥ 5), charge_date? (default today), performed_by_staff}
-- The branch comes from the related charge or the resident, never from the
-- payload. The date must fall in an OPEN month.
-- ----------------------------------------------------------------------------
create or replace function public.inv_manual_charge_adjustment(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_manual_charge_adjustment';
  v_acc record;
  v_rel_id bigint;
  v_rel_target text;
  v_res record;
  v_branch bigint;
  v_res_id bigint;
  v_replay jsonb;
  v_code text;
  v_amount numeric := public.fn_inv_jnum(p_payload->'amount');
  v_date date := coalesce(public.fn_inv_jdate(p_payload->'charge_date'), public.fn_inv_today());
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := public.fn_inv_jtext(p_payload->'reason');
  v_lock jsonb;
  v_period bigint;
  v_new_id bigint;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  if p_payload->'related_charge_id' is not null and p_payload->'related_charge_id' <> 'null'::jsonb then
    select c.id, c.branch_id, c.resident_id, c.target into v_rel_id, v_branch, v_res_id, v_rel_target
      from public.tbl_inv_charges c where c.id = public.fn_inv_jbigint(p_payload->'related_charge_id');
    if v_rel_id is null then
      return public.fn_inv_err('FORBIDDEN');
    end if;
  end if;
  if p_payload->'resident_id' is not null and p_payload->'resident_id' <> 'null'::jsonb then
    select r.id, r.branch_id into v_res from public.tbl_residents r where r.id = public.fn_inv_jbigint(p_payload->'resident_id');
    if v_res.id is null then
      return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
    end if;
    if v_branch is not null and v_res.branch_id <> v_branch then
      return public.fn_inv_err('RESIDENT_MISMATCH');
    end if;
    if v_res_id is not null and v_res.id <> v_res_id then
      return public.fn_inv_err('RESIDENT_MISMATCH');
    end if;
    v_branch := v_res.branch_id;
    v_res_id := v_res.id;
  end if;
  if v_branch is null or not public.fn_inv_can('MANUAL_CHARGE_ADJ', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_res_id is null then
    return public.fn_inv_err('INVALID_PAYLOAD', 'A resident or a related resident charge is required');
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, v_date),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('MANUAL_CHARGE_ADJ')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_amount is null or v_amount = 0 or v_amount <> round(v_amount, 2) or abs(v_amount) > 1000000 then
    return public.fn_inv_err('INVALID_AMOUNT');
  end if;
  if v_reason is null or length(v_reason) not between 5 and 500 then
    return public.fn_inv_err('INVALID_REASON');
  end if;
  if v_rel_id is not null and v_rel_target <> 'RESIDENT' then
    return public.fn_inv_err('NOT_RESIDENT_CHARGE');
  end if;
  if public.fn_inv_state_problem(null, jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'date', v_date))) is not null then
    return public.fn_inv_err('PERIOD_LOCKED');
  end if;
  v_lock := public.fn_inv_lock(null, jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'date', v_date)), null);
  if public.fn_inv_lock_problem(v_lock) is not null then
    return public.fn_inv_finish(public.fn_inv_lock_problem(v_lock));
  end if;
  select p.id into v_period from public.tbl_inv_billing_periods p
   where p.branch_id = v_branch and p.period_month = date_trunc('month', v_date)::date;

  insert into public.tbl_inv_charges (branch_id, billing_period_id, charge_date, charge_kind, target, resident_id,
    related_charge_id, product_name, sku, uom_code, qty_base, unit_charge_price, charge_amount, cost_amount,
    reason, request_key, created_by_account, created_by_staff)
  values (v_branch, v_period, v_date, 'MANUAL_ADJUSTMENT', 'RESIDENT', v_res_id,
    v_rel_id, 'Manual adjustment', 'MANUAL', 'NA', 0, null, v_amount, 0,
    v_reason, p_key, v_acc.account_id, v_staff)
  returning id into v_new_id;

  v_result := public.fn_inv_ok(jsonb_build_object('charge_id', v_new_id, 'charge_amount', v_amount));
  perform public.fn_inv_audit('CHARGE_MANUAL_ADJUSTED', 'charge', v_new_id::text, v_branch, v_staff, null, p_key, v_reason,
    jsonb_build_object('resident_id', v_res_id, 'related_charge_id', v_rel_id, 'charge_amount', v_amount,
                       'charge_date', v_date));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_set_resident_billing_code (tier MODERATOR) — D-122
-- payload: {resident_id, billing_code}   (the Bukku customer code, 1–40 chars, unique)
-- ----------------------------------------------------------------------------
create or replace function public.inv_set_resident_billing_code(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_set_resident_billing_code';
  v_acc record;
  v_res record;
  v_replay jsonb;
  v_code text := public.fn_inv_jtext(p_payload->'billing_code');
  v_before text;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select r.id, r.branch_id into v_res from public.tbl_residents r where r.id = public.fn_inv_jbigint(p_payload->'resident_id');
  if v_res.id is null or not public.fn_inv_can('BILLING_CODES', v_res.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_code is null or length(v_code) > 40 then
    return public.fn_inv_err('INVALID_BILLING_CODE');
  end if;
  if exists (select 1 from public.tbl_inv_resident_billing b where b.billing_code = v_code and b.resident_id <> v_res.id) then
    return public.fn_inv_err('DUPLICATE_BILLING_CODE');
  end if;
  select b.billing_code into v_before from public.tbl_inv_resident_billing b where b.resident_id = v_res.id;
  insert into public.tbl_inv_resident_billing (resident_id, branch_id, billing_code, updated_by_account)
  values (v_res.id, v_res.branch_id, v_code, v_acc.account_id)
  on conflict (resident_id) do update
    set billing_code = excluded.billing_code, updated_at = now(), updated_by_account = excluded.updated_by_account;
  v_result := public.fn_inv_ok(jsonb_build_object('resident_id', v_res.id, 'billing_code', v_code));
  perform public.fn_inv_audit('BILLING_CODE_SET', 'resident_billing', v_res.id::text, v_res.branch_id, null, null, p_key,
    null, jsonb_build_object('billing_code', v_code), jsonb_build_object('billing_code', v_before));
  return public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result);
end $$;

-- ----------------------------------------------------------------------------
-- Export helpers (internal)
-- ----------------------------------------------------------------------------

-- The resident charges an export of this branch × period covers. Delta (default):
-- charges not in any earlier export of the period. Full: all of them.
create or replace function public.fn_inv_export_charge_ids(p_branch_id bigint, p_period_id bigint, p_full boolean)
returns table (charge_id bigint) language sql stable set search_path = '' as $$
  select c.id from public.tbl_inv_charges c
   where c.branch_id = p_branch_id and c.billing_period_id = p_period_id and c.target = 'RESIDENT'
     and (p_full or not exists (select 1 from public.tbl_inv_charge_export_items i where i.charge_id = c.id))
$$;

-- Residents in that scope with no billing code: [{resident_id, resident_ref, resident_name}]
create or replace function public.fn_inv_export_missing_codes(p_branch_id bigint, p_period_id bigint, p_full boolean)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('resident_id', r.id, 'resident_ref', r."ResidentID",
                                               'resident_name', r.resident_name) order by r."ResidentID"), '[]'::jsonb)
    from public.tbl_residents r
   where r.id in (select c.resident_id from public.tbl_inv_charges c
                   where c.id in (select x.charge_id from public.fn_inv_export_charge_ids(p_branch_id, p_period_id, p_full) x))
     and not exists (select 1 from public.tbl_inv_resident_billing b where b.resident_id = r.id)
$$;

-- ----------------------------------------------------------------------------
-- inv_export_charges (tier MODERATOR) — D-122, D-163
-- payload: {branch_id, period 'YYYY-MM', layout ITEMISED|SUMMARY, full? (default false)}
-- Returns the rows for the app to write as CSV; columns[] gives their order.
-- A delta export with nothing new returns row_count 0 and writes nothing.
-- file_sha256 = sha256 of the UTF-8 text of the rows array (jsonb text form is
-- canonical: sorted keys), NOT of the CSV bytes, which the app builds.
-- ----------------------------------------------------------------------------
create or replace function public.inv_export_charges(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_export_charges';
  v_acc record;
  v_branch bigint := public.fn_inv_jbigint(p_payload->'branch_id');
  v_period_txt text := public.fn_inv_jtext(p_payload->'period');
  v_layout text := public.fn_inv_jtext(p_payload->'layout');
  v_full boolean := public.fn_inv_jbool(p_payload->'full');
  v_month date;
  v_period record;
  v_replay jsonb;
  v_missing jsonb;
  v_rows jsonb;
  v_columns jsonb;
  v_total numeric;
  v_export_id bigint;
  v_export_no text;
  v_sha bytea;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or v_branch is null or v_period_txt is null
     or v_period_txt !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or v_layout is null or v_layout not in ('ITEMISED','SUMMARY') then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  if not public.fn_inv_can('EXPORT', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_month := (v_period_txt || '-01')::date;
  select * into v_period from public.tbl_inv_billing_periods p where p.branch_id = v_branch and p.period_month = v_month;
  if not found then
    return public.fn_inv_err('PERIOD_NOT_FOUND');
  end if;
  v_missing := public.fn_inv_export_missing_codes(v_branch, v_period.id, v_full);
  if jsonb_array_length(v_missing) > 0 then
    return public.fn_inv_err('MISSING_BILLING_CODE', null, jsonb_build_object('residents', v_missing));
  end if;

  -- serialise exports of the same period (two delta exports must not share charges)
  perform public.fn_inv_lock(null, jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'date', v_month)),
    jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'doc_type', 'EXP')), 'UPDATE');
  v_missing := public.fn_inv_export_missing_codes(v_branch, v_period.id, v_full);
  if jsonb_array_length(v_missing) > 0 then
    return public.fn_inv_finish(public.fn_inv_err('MISSING_BILLING_CODE', null, jsonb_build_object('residents', v_missing)));
  end if;

  select coalesce(sum(c.charge_amount), 0) into v_total from public.tbl_inv_charges c
   where c.id in (select x.charge_id from public.fn_inv_export_charge_ids(v_branch, v_period.id, v_full) x);

  if v_layout = 'ITEMISED' then
    v_columns := '["billing_code","resident_ref","resident_name","charge_date","sku","product_name","qty","uom",
                   "unit_price","amount","kind","txn_no","related_charge_period","is_prior_period_credit"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object(
             'billing_code', b.billing_code, 'resident_ref', r."ResidentID", 'resident_name', r.resident_name,
             'charge_date', c.charge_date, 'sku', c.sku, 'product_name', c.product_name, 'qty', c.qty_base,
             'uom', c.uom_code, 'unit_price', c.unit_charge_price, 'amount', c.charge_amount, 'kind', c.charge_kind,
             'txn_no', t.txn_no, 'related_charge_period', to_char(rp.period_month, 'YYYY-MM'),
             'is_prior_period_credit', coalesce(rp.period_month < v_month, false))
           order by r."ResidentID", c.charge_date, c.id), '[]'::jsonb)
      into v_rows
      from public.tbl_inv_charges c
      join public.tbl_residents r on r.id = c.resident_id
      join public.tbl_inv_resident_billing b on b.resident_id = c.resident_id
      left join public.tbl_inv_txns t on t.id = c.txn_id
      left join public.tbl_inv_charges rc on rc.id = c.related_charge_id
      left join public.tbl_inv_billing_periods rp on rp.id = rc.billing_period_id
     where c.id in (select x.charge_id from public.fn_inv_export_charge_ids(v_branch, v_period.id, v_full) x);
  else
    v_columns := '["billing_code","resident_ref","resident_name","line_count","amount"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object(
             'billing_code', s.billing_code, 'resident_ref', s.resident_ref, 'resident_name', s.resident_name,
             'line_count', s.line_count, 'amount', s.amount) order by s.resident_ref), '[]'::jsonb)
      into v_rows
      from (select b.billing_code, r."ResidentID" as resident_ref, r.resident_name, count(*) as line_count,
                   sum(c.charge_amount) as amount
              from public.tbl_inv_charges c
              join public.tbl_residents r on r.id = c.resident_id
              join public.tbl_inv_resident_billing b on b.resident_id = c.resident_id
             where c.id in (select x.charge_id from public.fn_inv_export_charge_ids(v_branch, v_period.id, v_full) x)
             group by b.billing_code, r."ResidentID", r.resident_name) s;
  end if;

  if jsonb_array_length(v_rows) > 0 then
    v_sha := sha256(convert_to(v_rows::text, 'UTF8'));
    v_export_no := public.fn_inv_next_no(v_branch, 'EXP');
    insert into public.tbl_inv_charge_exports (export_no, branch_id, billing_period_id, layout, exported_by_account,
      row_count, total_amount, file_sha256, is_full)
    values (v_export_no, v_branch, v_period.id, v_layout, v_acc.account_id, jsonb_array_length(v_rows), v_total, v_sha, v_full)
    returning id into v_export_id;
    insert into public.tbl_inv_charge_export_items (export_id, charge_id, branch_id)
    select v_export_id, x.charge_id, v_branch from public.fn_inv_export_charge_ids(v_branch, v_period.id, v_full) x;
  end if;

  v_result := public.fn_inv_ok(jsonb_build_object('export_id', v_export_id, 'export_no', v_export_no,
    'layout', v_layout, 'is_full', v_full, 'period', v_period_txt, 'period_locked', v_period.status = 'LOCKED',
    'row_count', jsonb_array_length(v_rows), 'total_amount', v_total,
    'file_sha256', case when v_sha is not null then encode(v_sha, 'hex') end,
    'columns', v_columns, 'rows', v_rows));
  if v_export_id is not null then
    perform public.fn_inv_audit('CHARGES_EXPORTED', 'charge_export', v_export_id::text, v_branch, null, null, p_key, null,
      jsonb_build_object('export_no', v_export_no, 'layout', v_layout, 'is_full', v_full, 'period', v_period_txt,
                         'row_count', jsonb_array_length(v_rows), 'total_amount', v_total));
  end if;
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_posted_from_branch_login (policy-style helper, granted by 013)
-- True when the account is a STAFF (shared branch) login. Answers only for
-- MODERATOR+ callers, so it reveals nothing to anyone else.
-- ----------------------------------------------------------------------------
create or replace function public.inv_posted_from_branch_login(p_account_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select a.rights::text = 'STAFF' from public.tbl_user_accounts a where a.id = p_account_id), false)
         and public.inv_my_rank() >= 3
$$;

-- ----------------------------------------------------------------------------
-- v_inv_exceptions (D-108, D-164): one row per exception, MODERATOR+ in scope.
-- security_invoker: the caller's RLS decides the branches (DEMO isolation
-- included). Only what persisted data can prove; see docs §14.
-- ----------------------------------------------------------------------------
create or replace view public.v_inv_exceptions with (security_invoker = true) as
with tx as (
  select t.id, t.txn_no, t.txn_type, t.branch_id, t.txn_date, bp.period_month, t.performed_by_staff,
         t.posted_by_account, t.negative_stock_confirmed, t.inactive_resident_confirmed, t.sanity_confirmed,
         a.product_id, a.resident_id, a.qty, a.amount, a.has_pending_cost
    from public.tbl_inv_txns t
    join public.tbl_inv_billing_periods bp on bp.id = t.billing_period_id
    cross join lateral (
      select case when count(distinct l.product_id) = 1 then min(l.product_id) end as product_id,
             case when count(distinct l.resident_id) = 1 and bool_and(l.resident_id is not null) then min(l.resident_id) end as resident_id,
             greatest(coalesce(sum(l.qty_base) filter (where l.qty_base > 0), 0),
                      coalesce(-sum(l.qty_base) filter (where l.qty_base < 0), 0)) as qty,
             greatest(coalesce(sum(l.value) filter (where l.qty_base > 0), 0),
                      coalesce(-sum(l.value) filter (where l.qty_base < 0), 0)) as amount,
             coalesce(bool_or(l.cost_source = 'PENDING_COST'), false) as has_pending_cost
        from public.tbl_inv_txn_lines l where l.txn_id = t.id) a
   where t.txn_type <> 'REVERSAL'
     and not exists (select 1 from public.tbl_inv_txns r where r.reverses_txn_id = t.id)
), rows_all as (
  select tx.branch_id, tx.period_month, k.kind, 'TXN'::text as ref_type, tx.id as ref_id, tx.txn_no as reference,
         tx.txn_date as event_date, tx.product_id, tx.resident_id, tx.qty, tx.amount,
         tx.performed_by_staff, tx.posted_by_account, false as is_blocking
    from tx
    cross join lateral (values
      ('WRITE_OFF', tx.txn_type = 'DAMAGED_EXPIRED'),
      ('TRANSIT_RELEASE', tx.txn_type = 'TRANSIT_RELEASE'),
      ('RELEASE_REALLOCATE_7D', tx.txn_type = 'TRANSIT_ALLOCATE' and exists (
          select 1 from public.tbl_inv_txns rt
            join public.tbl_inv_txn_lines rl on rl.txn_id = rt.id and rl.location_kind = 'TRANSIT' and rl.qty_base < 0
            join public.tbl_inv_txn_lines al on al.txn_id = tx.id and al.location_kind = 'TRANSIT' and al.qty_base > 0
           where rt.txn_type = 'TRANSIT_RELEASE' and rt.branch_id = tx.branch_id and rt.id < tx.id
             and rt.txn_date between tx.txn_date - 7 and tx.txn_date
             and rl.resident_id = al.resident_id and rl.product_id = al.product_id
             and not exists (select 1 from public.tbl_inv_txns rr where rr.reverses_txn_id = rt.id))),
      ('NEGATIVE_STOCK_CONFIRMED', tx.negative_stock_confirmed),
      ('INACTIVE_RESIDENT_ISSUE', tx.inactive_resident_confirmed),
      ('PENDING_COST', tx.has_pending_cost),
      ('SANITY_CONFIRMED', tx.sanity_confirmed)
    ) as k(kind, hit)
   where k.hit
  union all
  -- OSEM-expense charges and unpriced resident charges
  select c.branch_id, bp.period_month, k.kind, 'CHARGE', c.id, coalesce(t.txn_no, 'CHG-' || c.id), c.charge_date,
         c.product_id, c.resident_id, c.qty_base,
         case when k.kind = 'OSEM_EXPENSE_ISSUE' then c.cost_amount else c.charge_amount end,
         c.created_by_staff, c.created_by_account, k.kind = 'PRICE_PENDING'
    from public.tbl_inv_charges c
    join public.tbl_inv_billing_periods bp on bp.id = c.billing_period_id
    left join public.tbl_inv_txns t on t.id = c.txn_id
    cross join lateral (values
      ('OSEM_EXPENSE_ISSUE', c.target = 'OSEM_EXPENSE' and c.charge_kind in ('ISSUE','SERVICE')
         and not exists (select 1 from public.tbl_inv_charges x where x.related_charge_id = c.id and x.charge_kind = 'REVERSAL')),
      ('PRICE_PENDING', c.target = 'RESIDENT' and c.charge_kind in ('ISSUE','SERVICE') and c.unit_charge_price is null
         and not exists (select 1 from public.tbl_inv_charges x where x.related_charge_id = c.id
                           and x.charge_kind in ('PRICING','REVERSAL')))
    ) as k(kind, hit)
   where k.hit
  union all
  -- approved adjustments (the requester is who may be a branch login)
  select tx.branch_id, tx.period_month, 'ADJUSTMENT_APPROVED', 'ADJUSTMENT', a.id, a.adjustment_no, tx.txn_date,
         tx.product_id, tx.resident_id, tx.qty, tx.amount, a.requested_by_staff, a.requested_by_account, false
    from public.tbl_inv_adjustments a
    join tx on tx.id = a.txn_id
   where a.status = 'APPROVED'
  union all
  -- pending adjustments block every month ending on or after their creation
  select a.branch_id, date_trunc('month', a.created_at at time zone 'Asia/Kuala_Lumpur')::date, 'ADJUSTMENT_PENDING',
         'ADJUSTMENT', a.id, a.adjustment_no, (a.created_at at time zone 'Asia/Kuala_Lumpur')::date,
         null::bigint, null::bigint, null::numeric, null::numeric, a.requested_by_staff, a.requested_by_account, true
    from public.tbl_inv_adjustments a
   where a.status = 'PENDING'
  union all
  -- Transit stock with no movement for 30 days (dated in the current month; not period-bound)
  select b.branch_id, date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur'))::date, 'STALE_TRANSIT', 'BUCKET',
         b.id, 'TRANSIT-' || b.id, ll.txn_date, b.product_id, b.resident_id, b.qty, null::numeric,
         null::text, null::bigint, false
    from public.tbl_inv_balances b
    join public.tbl_inv_locations l on l.id = b.location_id and l.kind = 'TRANSIT'
    join public.tbl_inv_txn_lines ll on ll.id = b.last_line_id
   where b.qty > 0 and ll.txn_date < (now() at time zone 'Asia/Kuala_Lumpur')::date - 30
)
select u.branch_id, u.period_month, u.kind, u.ref_type, u.ref_id, u.reference, u.event_date, u.product_id,
       p.name as product_name, u.resident_id, u.qty, u.amount, u.performed_by_staff, u.posted_by_account,
       public.inv_posted_from_branch_login(u.posted_by_account) as from_branch_login, u.is_blocking
  from rows_all u
  left join public.tbl_inv_products p on p.id = u.product_id
 where (select public.inv_my_rank()) >= 3;

-- Grants: RE-RUN schema/013_inventory_grants.sql after this file (catalog-driven).

-- Nothing this file created is reachable through the API until 013 (audit V-1).
-- ============================================================================
-- inv_post_return_from_issue, re-issued here (D-72 with PRICING): 015 is already
-- live, so this file carries the fix. Keep identical to the copy in 015.
-- ============================================================================
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
         t.id, rl.id, c.id, c.product_id, c.product_name, c.sku, c.uom_code, -rl.qty_base,
         coalesce(c.unit_charge_price, pr.unit_charge_price),   -- D-72: the PRICING price once a PRICE_PENDING line is priced
         case when c.target <> 'RESIDENT' then 0
              -- the last units back credit exactly what is left of the charge (no 1-sen residue)
              when (k->>'last')::boolean then
                -(c.charge_amount + coalesce(pr.charge_amount, 0)
                  + coalesce((select sum(x.charge_amount) from public.tbl_inv_charges x
                               where x.related_charge_id = c.id and x.charge_kind = 'RETURN_CREDIT'
                                 and x.txn_id <> t.id), 0)
                  + coalesce((select sum(y.charge_amount) from public.tbl_inv_charges y
                                join public.tbl_inv_charges x on x.id = y.related_charge_id
                               where x.related_charge_id = c.id and x.charge_kind = 'RETURN_CREDIT'
                                 and y.charge_kind = 'REVERSAL'), 0))
              else -coalesce(round(rl.qty_base * coalesce(c.unit_charge_price, pr.unit_charge_price), 2), 0) end,
         -rl.value, p_key, v_acc.account_id, v_staff
    from jsonb_array_elements(v_links) k
    join public.tbl_inv_txn_lines rl on rl.id = (k->>'line_id')::bigint
    join public.tbl_inv_txns t on t.id = rl.txn_id
    join public.tbl_inv_charges c on c.id = (k->>'charge_id')::bigint
    left join public.tbl_inv_charges pr on pr.related_charge_id = c.id and pr.charge_kind = 'PRICING';
  select coalesce(sum(c.charge_amount), 0) into v_credit from public.tbl_inv_charges c where c.txn_id = v_txn_id;

  v_result := public.fn_inv_ok(jsonb_build_object('txn_id', v_txn_id, 'txn_no', v_res_w->'written'->'txns'->0->>'txn_no',
    'credit_amount', v_credit));
  perform public.fn_inv_audit('RETURN_FROM_ISSUE_POSTED', 'txn', v_txn_id::text, v_branch, v_staff, v_txn_id, p_key, null,
    jsonb_build_object('lines', jsonb_array_length(v_lines), 'credit_amount', v_credit));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

select public.fn_inv_lockdown();

commit;
