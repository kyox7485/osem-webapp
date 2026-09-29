-- ============================================================================
-- 009 — General Inventory: posting engine (internal; never granted to API roles)
-- ============================================================================
-- Building blocks the inv_* RPCs in 010 are made of:
--   * payload readers (fn_inv_j*), result envelopes (fn_inv_ok / fn_inv_err)
--   * idempotency (D-110): advisory lock on the key, stored result, hash check
--   * WAC maths (D-50…D-58, D-118): fn_inv_pool_in / _out_wac / _out_spec
--   * lock plan (D-111): periods → locations → pools → buckets → counters,
--     each sorted, all taken before anything is written
--   * bucket check: negative-stock confirm / Transit hard block (D-18)
--   * writer: pre-allocated ids, header + lines, caches updated in the same
--     statement batch, no UPDATE of a posted row (D-112)
--   * verify / rebuild caches (D-116), DEMO purge (Q-21) — postgres only
--
-- A posting "plan" is a jsonb array of txns, each with a lines array. Line
-- modes: IN_SPEC (inflow at a given value), OUT_WAC (outflow at pool WAC),
-- OUT_SPEC (outflow at a given value, i.e. reversing an inflow), INT_OUT /
-- INT_IN (paired internal legs, pool unchanged), INT_FIXED (reversal of an
-- internal leg), FIXED (value and revaluation precomputed: netted corrections).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Small helpers
-- ----------------------------------------------------------------------------

create or replace function public.fn_inv_today()          -- D-129: the single KL "today"
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date
$$;

create or replace function public.fn_inv_err(p_code text, p_message text default null, p_data jsonb default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', coalesce(p_message, p_code), 'data', p_data)
$$;

create or replace function public.fn_inv_ok(p_data jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', true, 'code', 'OK', 'data', p_data)
$$;

-- Ends an RPC: switches the engine GUC off again and returns the result.
create or replace function public.fn_inv_finish(p_result jsonb)
returns jsonb language plpgsql set search_path = '' as $$
begin
  perform set_config('inv.posting', 'off', true);
  return p_result;
end $$;

-- Payload readers: return NULL for a missing or malformed value (D-126).
create or replace function public.fn_inv_jbigint(p jsonb)
returns bigint language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p) = 'number' and p::text ~ '^[0-9]{1,15}$' then p::text::bigint
    when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^[0-9]{1,15}$' then (p #>> '{}')::bigint
  end
$$;

create or replace function public.fn_inv_jnum(p jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p) = 'number' and p::text ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' then p::text::numeric
    when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' then (p #>> '{}')::numeric
  end
$$;

create or replace function public.fn_inv_jtext(p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'string' then nullif(btrim(p #>> '{}'), '') end
$$;

create or replace function public.fn_inv_jbool(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(case when jsonb_typeof(p) = 'boolean' then (p #>> '{}')::boolean end, false)
$$;

create or replace function public.fn_inv_jdate(p jsonb)
returns date language plpgsql immutable set search_path = '' as $$
declare
  v_text text := case when jsonb_typeof(p) = 'string' then p #>> '{}' end;
  v_date date;
begin
  if v_text is null or v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  v_date := to_date(v_text, 'YYYY-MM-DD');
  return case when to_char(v_date, 'YYYY-MM-DD') = v_text then v_date end;
exception when others then
  return null;
end $$;

create or replace function public.fn_inv_next_id(p_table text)
returns bigint language sql volatile set search_path = '' as $$
  select nextval(pg_catalog.pg_get_serial_sequence('public.' || p_table, 'id'))
$$;

-- ----------------------------------------------------------------------------
-- 2. Context checks
-- ----------------------------------------------------------------------------

-- The branch posts at all, and the business date is allowed (D-57, Q-10).
create or replace function public.fn_inv_check_branch_date(p_branch_id bigint, p_date date)
returns text language plpgsql stable set search_path = '' as $$
declare
  v record;
begin
  select s.is_enabled, s.go_live_date into v from public.tbl_inv_branch_settings s where s.branch_id = p_branch_id;
  if not found or not v.is_enabled or v.go_live_date is null then
    return 'INVENTORY_NOT_ENABLED';
  end if;
  if p_date is null then
    return 'INVALID_DATE';
  end if;
  if p_date > public.fn_inv_today() then
    return 'DATE_IN_FUTURE';
  end if;
  if p_date < v.go_live_date then
    return 'DATE_BEFORE_GO_LIVE';
  end if;
  return null;
end $$;

-- Resolve a product + UOM + quantity for a branch. Returns {"error": code}
-- or the frozen facts every posting needs.
create or replace function public.fn_inv_resolve_item(p_branch_id bigint, p_product_id bigint, p_uom_id bigint,
                                                      p_qty numeric, p_stock_item boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  p record;
  u record;
  v_qty_base numeric;
begin
  select pr.*, bu.code as base_uom_code into p
    from public.tbl_inv_products pr
    join public.tbl_inv_uoms bu on bu.id = pr.base_uom_id
   where pr.id = p_product_id
     and (pr.owner_branch_id is null or pr.owner_branch_id = p_branch_id);
  if not found then
    return jsonb_build_object('error', 'PRODUCT_NOT_FOUND');
  end if;
  if not p.is_active then
    return jsonb_build_object('error', 'PRODUCT_INACTIVE');
  end if;
  if p.is_stock_item <> p_stock_item then
    return jsonb_build_object('error', case when p_stock_item then 'NOT_STOCK_ITEM' else 'NOT_SERVICE_ITEM' end);
  end if;
  select pu.factor_to_base, uo.code, uo.allow_fraction into u
    from public.tbl_inv_product_uoms pu
    join public.tbl_inv_uoms uo on uo.id = pu.uom_id
   where pu.product_id = p_product_id and pu.uom_id = p_uom_id and pu.is_active and uo.is_active;
  if not found then
    return jsonb_build_object('error', 'UOM_NOT_CONVERTIBLE');
  end if;
  if p_qty is null or p_qty <= 0 or p_qty <> round(p_qty, 4) then
    return jsonb_build_object('error', 'INVALID_QTY');
  end if;
  if not u.allow_fraction and p_qty <> trunc(p_qty) then
    return jsonb_build_object('error', 'QTY_NOT_INTEGRAL');
  end if;
  v_qty_base := round(p_qty * u.factor_to_base, 4);
  if v_qty_base > 1000000 then                       -- D-109 hard cap
    return jsonb_build_object('error', 'QTY_TOO_LARGE');
  end if;
  return jsonb_build_object(
    'product_id', p.id, 'product_name', p.name, 'sku', p.sku,
    'uom_id', p_uom_id, 'uom_code', u.code, 'factor', u.factor_to_base,
    'qty_entered', p_qty, 'qty_base', v_qty_base,
    'base_uom_id', p.base_uom_id, 'base_uom_code', p.base_uom_code,
    'is_chargeable', p.is_chargeable, 'charge_price', p.charge_price,
    'standard_unit_cost', p.standard_unit_cost,
    'default_max_store', p.default_max_store, 'default_max_floor', p.default_max_floor);
end $$;

-- D-109: quantity sanity — more than max(10 × effective max, 1000) base units.
create or replace function public.fn_inv_qty_insane(p_location_id bigint, p_product_id bigint, p_qty_base numeric)
returns boolean language sql stable set search_path = '' as $$
  select abs(p_qty_base) > greatest(10 * coalesce((
    select case l.kind when 'STORE' then coalesce(sl.max_qty, p.default_max_store)
                       when 'FLOOR' then coalesce(sl.max_qty, p.default_max_floor) end
    from public.tbl_inv_locations l
    join public.tbl_inv_products p on p.id = p_product_id
    left join public.tbl_inv_stock_levels sl on sl.location_id = l.id and sl.product_id = p.id
    where l.id = p_location_id), 0), 1000)
$$;

-- ----------------------------------------------------------------------------
-- 3. Idempotency (D-110)
-- ----------------------------------------------------------------------------

create or replace function public.fn_inv_request_hash(p_payload jsonb)
returns bytea language sql immutable set search_path = '' as $$
  -- confirmation flags are excluded so a confirm round-trip reuses the key
  select sha256(convert_to((p_payload - array['allow_negative','sanity_confirmed','inactive_resident_confirmed'])::text, 'UTF8'))
$$;

-- NULL = first call, go ahead. Otherwise the stored result (replayed) or
-- IDEMPOTENCY_KEY_REUSED. Holds a transaction advisory lock on the key.
create or replace function public.fn_inv_idem_lookup(p_key uuid, p_rpc text, p_payload jsonb, p_account_id bigint)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  r record;
begin
  perform pg_advisory_xact_lock(hashtextextended('inv_key:' || p_key::text, 0));
  select * into r from public.tbl_inv_idempotency i where i.key = p_key;
  if not found then
    return null;
  end if;
  if r.rpc = p_rpc and r.account_id = p_account_id and r.request_hash = public.fn_inv_request_hash(p_payload) then
    return r.result || jsonb_build_object('replayed', true);
  end if;
  return public.fn_inv_err('IDEMPOTENCY_KEY_REUSED');
end $$;

create or replace function public.fn_inv_idem_store(p_key uuid, p_rpc text, p_payload jsonb, p_account_id bigint, p_result jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  insert into public.tbl_inv_idempotency (key, rpc, account_id, request_hash, result)
  values (p_key, p_rpc, p_account_id, public.fn_inv_request_hash(p_payload), p_result);
  return p_result;
end $$;

-- ----------------------------------------------------------------------------
-- 4. WAC maths (§5.3). Pure functions; the SQL test suite checks them directly.
-- ----------------------------------------------------------------------------

-- Inflow of p_dq > 0 units carrying total value p_pv.
create or replace function public.fn_inv_pool_in(p_q numeric, p_v numeric, p_w numeric, p_dq numeric, p_pv numeric,
  out value numeric, out reval numeric, out q numeric, out v numeric, out w numeric)
language plpgsql immutable set search_path = '' as $$
declare
  c numeric;
begin
  if p_dq <= 0 then
    raise exception 'INV_ENGINE: inflow needs a positive quantity';
  end if;
  value := p_pv;
  q := p_q + p_dq;
  if p_q > 0 then
    v := p_v + p_pv;
    reval := 0;
    w := round(v / q, 6);
  elsif p_pv = 0 then
    -- zero-value inflow into Q <= 0 (owner rule D-157, supersedes D-149): the
    -- negative value is written off and the incoming cost (0) becomes W, same
    -- as any other true-up; an unknown W (PENDING_COST) stays unknown.
    w := case when p_w is null then null else 0 end;
    v := 0;
    reval := -p_v;
  else                                      -- negative-stock true-up (D-55)
    c := p_pv / p_dq;
    v := case when q = 0 then 0 else round(q * c, 4) end;
    reval := v - (p_v + p_pv);
    w := round(c, 6);
  end if;
end $$;

-- Outflow of p_dq < 0 units at the effective cost p_ws (WAC, fallback or 0).
create or replace function public.fn_inv_pool_out_wac(p_q numeric, p_v numeric, p_ws numeric, p_dq numeric,
  out value numeric, out q numeric, out v numeric)
language plpgsql immutable set search_path = '' as $$
begin
  if p_dq >= 0 then
    raise exception 'INV_ENGINE: outflow needs a negative quantity';
  end if;
  q := p_q + p_dq;
  if q > 0 then
    value := -round(-p_dq * p_ws, 4);
    v := p_v + value;
  elsif q = 0 then
    value := -p_v;                           -- the last unit out clears any residue (I3)
    v := 0;
  else
    v := round(q * p_ws, 4);                 -- I2
    value := v - p_v;
  end if;
end $$;

-- Outflow of p_dq < 0 units at a specified total value p_pv < 0 (reversing an inflow).
create or replace function public.fn_inv_pool_out_spec(p_q numeric, p_v numeric, p_w numeric, p_dq numeric, p_pv numeric,
  out value numeric, out reval numeric, out q numeric, out v numeric, out w numeric)
language plpgsql immutable set search_path = '' as $$
begin
  if p_dq >= 0 then
    raise exception 'INV_ENGINE: outflow needs a negative quantity';
  end if;
  value := p_pv;
  q := p_q + p_dq;
  if q > 0 and p_v + p_pv > 0 then
    v := p_v + p_pv;
    reval := 0;
    w := round(v / q, 6);
  else
    w := coalesce(p_w, round(p_pv / p_dq, 6));
    v := case when q = 0 then 0 else round(q * w, 4) end;
    reval := v - (p_v + p_pv);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Lock plan (D-111). Everything an RPC will touch, locked once, in order:
--    periods → locations → pools → buckets → counters. Document headers are
--    locked by the RPC itself before calling this.
-- ----------------------------------------------------------------------------
create or replace function public.fn_inv_lock(p_txns jsonb, p_extra_periods jsonb, p_counters jsonb,
                                              p_period_mode text default 'SHARE')
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_year int := extract(year from public.fn_inv_today())::int;
  v_periods jsonb;
  v_lines jsonb;
  v_counters jsonb;
  v_locked jsonb;
  v_inactive jsonb;
  v_frozen jsonb;
begin
  perform set_config('inv.posting', 'on', true);

  -- what the plan touches (no temp tables: nothing a caller could pre-create)
  select coalesce(jsonb_agg(distinct jsonb_build_object('b', x.b, 'm', x.m)), '[]') into v_periods from (
    select (t->>'branch_id')::bigint as b, date_trunc('month', (t->>'txn_date')::date)::date as m
      from jsonb_array_elements(coalesce(p_txns, '[]')) t
    union
    select (e->>'branch_id')::bigint, date_trunc('month', (e->>'date')::date)::date
      from jsonb_array_elements(coalesce(p_extra_periods, '[]')) e
  ) x;
  select coalesce(jsonb_agg(distinct jsonb_build_object('b', (t->>'branch_id')::bigint,
           'loc', (l->>'location_id')::bigint, 'p', (l->>'product_id')::bigint, 'r', (l->>'resident_id')::bigint)), '[]')
    into v_lines
    from jsonb_array_elements(coalesce(p_txns, '[]')) t, jsonb_array_elements(t->'lines') l;
  select coalesce(jsonb_agg(distinct jsonb_build_object('b', x.b, 'd', x.d)), '[]') into v_counters from (
    select (t->>'branch_id')::bigint as b, 'TXN' as d from jsonb_array_elements(coalesce(p_txns, '[]')) t
    union
    select (c->>'branch_id')::bigint, c->>'doc_type' from jsonb_array_elements(coalesce(p_counters, '[]')) c
  ) x;

  -- 1. periods
  insert into public.tbl_inv_billing_periods (branch_id, period_month)
  select w.b, w.m from jsonb_to_recordset(v_periods) as w(b bigint, m date) order by w.b, w.m
  on conflict (branch_id, period_month) do nothing;
  if p_period_mode = 'UPDATE' then
    perform 1 from public.tbl_inv_billing_periods p
      join jsonb_to_recordset(v_periods) as w(b bigint, m date) on w.b = p.branch_id and w.m = p.period_month
      order by p.branch_id, p.period_month for update of p;
  else
    perform 1 from public.tbl_inv_billing_periods p
      join jsonb_to_recordset(v_periods) as w(b bigint, m date) on w.b = p.branch_id and w.m = p.period_month
      order by p.branch_id, p.period_month for share of p;
  end if;
  select jsonb_agg(jsonb_build_object('branch_id', p.branch_id, 'period_month', p.period_month))
    into v_locked
    from public.tbl_inv_billing_periods p
    join jsonb_to_recordset(v_periods) as w(b bigint, m date) on w.b = p.branch_id and w.m = p.period_month
   where p.status = 'LOCKED';

  -- 2. locations (FOR SHARE: a count START takes FOR UPDATE, D-104)
  perform 1 from public.tbl_inv_locations l
    where l.id in (select w.loc from jsonb_to_recordset(v_lines) as w(loc bigint))
    order by l.id for share;
  select jsonb_agg(l.id order by l.id) into v_inactive from public.tbl_inv_locations l
   where l.id in (select w.loc from jsonb_to_recordset(v_lines) as w(loc bigint)) and not l.is_active;
  select jsonb_agg(distinct c.location_id) into v_frozen from public.tbl_inv_counts c
   where c.location_id in (select w.loc from jsonb_to_recordset(v_lines) as w(loc bigint))
     and c.status = 'IN_PROGRESS' and c.freeze_location;

  -- 3. cost pools
  insert into public.tbl_inv_cost_pools (branch_id, product_id)
  select distinct w.b, w.p from jsonb_to_recordset(v_lines) as w(b bigint, p bigint) order by 1, 2
  on conflict (branch_id, product_id) do nothing;
  perform 1 from public.tbl_inv_cost_pools cp
    where (cp.branch_id, cp.product_id) in (select w.b, w.p from jsonb_to_recordset(v_lines) as w(b bigint, p bigint))
    order by cp.branch_id, cp.product_id for update;

  -- 4. buckets
  insert into public.tbl_inv_balances (branch_id, location_id, product_id, resident_id)
  select w.b, w.loc, w.p, w.r from jsonb_to_recordset(v_lines) as w(b bigint, loc bigint, p bigint, r bigint)
   order by w.loc, w.p, coalesce(w.r, 0)
  on conflict on constraint uq_inv_balances_bucket do nothing;
  perform 1 from public.tbl_inv_balances bal
    where exists (select 1 from jsonb_to_recordset(v_lines) as w(loc bigint, p bigint, r bigint)
                  where w.loc = bal.location_id and w.p = bal.product_id and w.r is not distinct from bal.resident_id)
    order by bal.location_id, bal.product_id, coalesce(bal.resident_id, 0) for update;

  -- 5. counters
  insert into public.tbl_inv_counters (branch_id, doc_type, year)
  select w.b, w.d, v_year from jsonb_to_recordset(v_counters) as w(b bigint, d text) order by 1, 2
  on conflict (branch_id, doc_type, year) do nothing;
  perform 1 from public.tbl_inv_counters c
    where c.year = v_year
      and (c.branch_id, c.doc_type) in (select w.b, w.d from jsonb_to_recordset(v_counters) as w(b bigint, d text))
    order by c.branch_id, c.doc_type for update;

  return jsonb_build_object('locked_periods', v_locked, 'inactive_locations', v_inactive,
                            'frozen_locations', v_frozen);
end $$;

-- Turns the lock result into the first applicable business rejection.
create or replace function public.fn_inv_lock_problem(p_lock jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when p_lock->'locked_periods' <> 'null'::jsonb then
      public.fn_inv_err('PERIOD_LOCKED', null, p_lock->'locked_periods')
    when p_lock->'inactive_locations' <> 'null'::jsonb then
      public.fn_inv_err('LOCATION_INACTIVE', null, p_lock->'inactive_locations')
    when p_lock->'frozen_locations' <> 'null'::jsonb then
      public.fn_inv_err('LOCATION_COUNT_IN_PROGRESS', null, p_lock->'frozen_locations')
  end
$$;

-- Read-only pre-check of the same period/location rules fn_inv_lock reports,
-- run BEFORE the lock plan inserts any period, pool, bucket or counter row, so
-- the common rejections leave nothing behind (audit P1-13). The lock plan
-- re-checks under locks; that result is authoritative.
create or replace function public.fn_inv_state_problem(p_txns jsonb, p_extra_periods jsonb default null)
returns jsonb language sql stable set search_path = '' as $$
  with per as (
    select (t->>'branch_id')::bigint as b, date_trunc('month', (t->>'txn_date')::date)::date as m
      from jsonb_array_elements(coalesce(p_txns, '[]')) t
    union
    select (e->>'branch_id')::bigint, date_trunc('month', (e->>'date')::date)::date
      from jsonb_array_elements(coalesce(p_extra_periods, '[]')) e
  ), loc as (
    select distinct (l->>'location_id')::bigint as id
      from jsonb_array_elements(coalesce(p_txns, '[]')) t, jsonb_array_elements(t->'lines') l
  )
  select public.fn_inv_lock_problem(jsonb_build_object(
    'locked_periods', (select jsonb_agg(jsonb_build_object('branch_id', p.branch_id, 'period_month', p.period_month))
                         from public.tbl_inv_billing_periods p join per on per.b = p.branch_id and per.m = p.period_month
                        where p.status = 'LOCKED'),
    'inactive_locations', (select jsonb_agg(l.id order by l.id) from public.tbl_inv_locations l
                            where l.id in (select id from loc) and not l.is_active),
    'frozen_locations', (select jsonb_agg(distinct c.location_id) from public.tbl_inv_counts c
                          where c.location_id in (select id from loc) and c.status = 'IN_PROGRESS' and c.freeze_location)))
$$;

-- Net quantity per bucket across every txn of the call (so a netted correction
-- is judged on its net effect, D-103). Transit never goes negative (D-18);
-- elsewhere going negative needs allow_negative (NEGATIVE_STOCK_CONFIRM).
-- Returns {"code": null|..., "negative": bool, "buckets": [...]}.
create or replace function public.fn_inv_check_buckets(p_txns jsonb, p_allow_negative boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_transit jsonb;
  v_negative jsonb;
begin
  with d as (
    select (l->>'location_id')::bigint as location_id, l->>'location_kind' as kind,
           (l->>'product_id')::bigint as product_id, (l->>'resident_id')::bigint as resident_id,
           sum((l->>'qty_base')::numeric) as net
      from jsonb_array_elements(p_txns) t, jsonb_array_elements(t->'lines') l
     group by 1, 2, 3, 4
  ), s as (
    select d.*, coalesce(b.qty, 0) as before_qty, coalesce(b.qty, 0) + d.net as after_qty
      from d left join public.tbl_inv_balances b
        on b.location_id = d.location_id and b.product_id = d.product_id
       and b.resident_id is not distinct from d.resident_id
  )
  select jsonb_agg(jsonb_build_object('location_id', location_id, 'product_id', product_id, 'resident_id', resident_id,
                                      'before', before_qty, 'after', after_qty)) filter (where kind = 'TRANSIT'),
         jsonb_agg(jsonb_build_object('location_id', location_id, 'product_id', product_id, 'resident_id', resident_id,
                                      'before', before_qty, 'after', after_qty)) filter (where kind <> 'TRANSIT')
    into v_transit, v_negative
    from s where net < 0 and after_qty < 0;

  if v_transit is not null then
    return jsonb_build_object('code', 'TRANSIT_NEGATIVE', 'negative', true, 'buckets', v_transit);
  end if;
  if v_negative is not null and not p_allow_negative then
    return jsonb_build_object('code', 'NEGATIVE_STOCK_CONFIRM', 'negative', true, 'buckets', v_negative);
  end if;
  return jsonb_build_object('code', null, 'negative', v_negative is not null, 'buckets', v_negative);
end $$;

-- ----------------------------------------------------------------------------
-- 6. Writer
-- ----------------------------------------------------------------------------

-- Next document number <BranchCode>-<DOC>-<YYYY>-<000123>; the counter row
-- is already locked by fn_inv_lock (D-129: year = KL year of posting).
create or replace function public.fn_inv_next_no(p_branch_id bigint, p_doc_type text)
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_year int := extract(year from public.fn_inv_today())::int;
  v_no int;
  v_code text;
begin
  update public.tbl_inv_counters c set last_no = c.last_no + 1
   where c.branch_id = p_branch_id and c.doc_type = p_doc_type and c.year = v_year
  returning c.last_no into v_no;
  if v_no is null then
    raise exception 'INV_ENGINE: counter %/% was not in the lock plan', p_branch_id, p_doc_type;
  end if;
  select b."BranchCode" into v_code from public.tbl_branches b where b."BranchID" = p_branch_id;
  return v_code || '-' || p_doc_type || '-' || v_year || '-' || lpad(v_no::text, 6, '0');
end $$;

create or replace function public.fn_inv_write_txns(p_txns jsonb, p_account_id bigint, p_key uuid)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  t jsonb;
  l jsonb;
  v_branch bigint;
  v_date date;
  v_txn_id bigint;
  v_txn_no text;
  v_period bigint;
  v_mode text;
  v_dq numeric;
  v_q numeric; v_v numeric; v_w numeric;
  v_q2 numeric; v_v2 numeric; v_w2 numeric;
  v_bq numeric;
  v_value numeric; v_reval numeric; v_unit numeric; v_ws numeric; v_std numeric;
  v_src text;
  r_in record;      -- one record per result shape: never reuse a record
  r_out record;     -- across different row types in one call
  r_spec record;
  v_int jsonb := '{}';
  v_lines jsonb := '{}';
  v_out jsonb := '[]';
  v_sum_q numeric;
  v_sum_v numeric;
begin
  if coalesce(current_setting('inv.posting', true), '') <> 'on' then
    raise exception 'INV_ENGINE: fn_inv_write_txns called outside a lock plan';
  end if;

  for t in select * from jsonb_array_elements(p_txns) loop
    v_branch := (t->>'branch_id')::bigint;
    v_date := (t->>'txn_date')::date;
    v_txn_id := (t->>'id')::bigint;
    v_txn_no := public.fn_inv_next_no(v_branch, 'TXN');
    select p.id into v_period from public.tbl_inv_billing_periods p
     where p.branch_id = v_branch and p.period_month = date_trunc('month', v_date)::date and p.status = 'OPEN';
    if v_period is null then
      raise exception 'INV_ENGINE: no open period for branch % on %', v_branch, v_date;
    end if;

    insert into public.tbl_inv_txns (id, txn_no, txn_type, branch_id, txn_date, billing_period_id,
      performed_by_staff, posted_by_account, reason_code, remarks, expense_note,
      negative_stock_confirmed, inactive_resident_confirmed, sanity_confirmed,
      reverses_txn_id, correction_of_txn_id, cascade_of_txn_id, source_doc_type, source_doc_id, request_key)
    values (v_txn_id, v_txn_no, t->>'txn_type', v_branch, v_date, v_period,
      t->>'performed_by_staff', p_account_id, t->>'reason_code', t->>'remarks', t->>'expense_note',
      coalesce((t->>'negative_stock_confirmed')::boolean, false),
      coalesce((t->>'inactive_resident_confirmed')::boolean, false),
      coalesce((t->>'sanity_confirmed')::boolean, false),
      (t->>'reverses_txn_id')::bigint, (t->>'correction_of_txn_id')::bigint, (t->>'cascade_of_txn_id')::bigint,
      t->>'source_doc_type', (t->>'source_doc_id')::bigint, p_key);

    v_sum_q := 0;
    v_sum_v := 0;
    for l in select * from jsonb_array_elements(t->'lines') loop
      v_mode := l->>'mode';
      v_dq := (l->>'qty_base')::numeric;
      select cp.qty, cp.value, cp.wac into v_q, v_v, v_w from public.tbl_inv_cost_pools cp
       where cp.branch_id = v_branch and cp.product_id = (l->>'product_id')::bigint;
      if not found then
        raise exception 'INV_ENGINE: pool not in the lock plan';
      end if;
      select b.qty into v_bq from public.tbl_inv_balances b
       where b.location_id = (l->>'location_id')::bigint and b.product_id = (l->>'product_id')::bigint
         and b.resident_id is not distinct from (l->>'resident_id')::bigint;
      if not found then
        raise exception 'INV_ENGINE: bucket not in the lock plan';
      end if;

      v_reval := 0;
      v_q2 := v_q; v_v2 := v_v; v_w2 := v_w;
      v_src := coalesce(l->>'cost_source', 'ORIGINAL');

      if v_mode in ('OUT_WAC', 'INT_OUT') then
        select pr.standard_unit_cost into v_std from public.tbl_inv_products pr where pr.id = (l->>'product_id')::bigint;
        if v_w is not null then
          v_ws := v_w; v_src := 'WAC';
        elsif v_std is not null then
          v_ws := v_std; v_src := 'MASTER_FALLBACK';
        else
          v_ws := 0; v_src := 'PENDING_COST';                   -- D-118
        end if;
      end if;

      case v_mode
        when 'IN_SPEC' then
          select * into r_in from public.fn_inv_pool_in(v_q, v_v, v_w, v_dq, (l->>'value')::numeric);
          v_value := r_in.value; v_reval := r_in.reval; v_q2 := r_in.q; v_v2 := r_in.v; v_w2 := r_in.w;
          v_unit := round(v_value / v_dq, 6);
        when 'OUT_SPEC' then
          select * into r_spec from public.fn_inv_pool_out_spec(v_q, v_v, v_w, v_dq, (l->>'value')::numeric);
          v_value := r_spec.value; v_reval := r_spec.reval; v_q2 := r_spec.q; v_v2 := r_spec.v; v_w2 := r_spec.w;
          v_unit := round(v_value / v_dq, 6);
        when 'OUT_WAC' then
          select * into r_out from public.fn_inv_pool_out_wac(v_q, v_v, v_ws, v_dq);
          v_value := r_out.value; v_q2 := r_out.q; v_v2 := r_out.v;
          v_w2 := case when v_src = 'PENDING_COST' then v_w else v_ws end;
          v_unit := v_ws;
        when 'INT_OUT' then
          v_value := -round(-v_dq * v_ws, 4);
          v_unit := v_ws;
          v_int := v_int || jsonb_build_object(l->>'id', v_value);
        when 'INT_IN' then
          v_value := -((v_int->>(l->>'pair_ref'))::numeric);
          if v_value is null then
            raise exception 'INV_ENGINE: internal in-leg before its out-leg';
          end if;
          v_unit := round(v_value / v_dq, 6);
          v_src := 'TRANSFER';
        when 'INT_FIXED' then
          v_value := (l->>'value')::numeric;
          v_unit := round(abs(v_value) / abs(v_dq), 6);
        when 'FIXED' then
          v_value := (l->>'value')::numeric;
          v_reval := coalesce((l->>'reval')::numeric, 0);
          v_q2 := v_q + v_dq;
          v_v2 := v_v + v_value + v_reval;
          v_w2 := coalesce((l->>'w_after')::numeric, v_w);
          v_unit := round(abs(v_value) / abs(v_dq), 6);
        else
          raise exception 'INV_ENGINE: unknown line mode %', v_mode;
      end case;

      if v_mode like 'INT\_%' then
        v_sum_q := v_sum_q + v_dq;
        v_sum_v := v_sum_v + v_value;
      end if;

      insert into public.tbl_inv_txn_lines (id, txn_id, line_no, branch_id, txn_date, txn_type, location_id,
        location_kind, resident_id, product_id, qty_base, uom_id, uom_code, qty_entered, factor_to_base, unit_cost,
        value, revaluation_value, cost_source, bucket_qty_after, pool_qty_after, pool_value_after, pool_wac_after,
        pair_line_id, source_line_id)
      values ((l->>'id')::bigint, v_txn_id, (l->>'line_no')::smallint, v_branch, v_date, t->>'txn_type',
        (l->>'location_id')::bigint, l->>'location_kind', (l->>'resident_id')::bigint, (l->>'product_id')::bigint,
        v_dq, (l->>'uom_id')::bigint, l->>'uom_code', (l->>'qty_entered')::numeric, (l->>'factor')::numeric,
        v_unit, v_value, v_reval, v_src, v_bq + v_dq, v_q2, v_v2, v_w2,
        (l->>'pair_line_id')::bigint, (l->>'source_line_id')::bigint);

      update public.tbl_inv_cost_pools cp
         set qty = v_q2, value = v_v2, wac = v_w2, last_line_id = (l->>'id')::bigint, updated_at = now()
       where cp.branch_id = v_branch and cp.product_id = (l->>'product_id')::bigint;
      update public.tbl_inv_balances b
         set qty = b.qty + v_dq, last_line_id = (l->>'id')::bigint, updated_at = now()
       where b.location_id = (l->>'location_id')::bigint and b.product_id = (l->>'product_id')::bigint
         and b.resident_id is not distinct from (l->>'resident_id')::bigint;

      v_lines := v_lines || jsonb_build_object(l->>'id',
        jsonb_build_object('value', v_value, 'unit_cost', v_unit, 'cost_source', v_src, 'reval', v_reval));
    end loop;

    -- internal legs net to zero in quantity and value (§4.3)
    if v_sum_q <> 0 or v_sum_v <> 0 then
      raise exception 'INV_ENGINE: internal legs of txn % do not net to zero', v_txn_id;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_no', v_txn_no));
  end loop;

  return jsonb_build_object('txns', v_out, 'lines', v_lines);
end $$;

-- One semantic audit event (D-90).
create or replace function public.fn_inv_audit(p_action text, p_entity text, p_entity_id text, p_branch_id bigint,
  p_staff text, p_txn_id bigint, p_key uuid, p_reason text, p_after jsonb, p_before jsonb default null)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_acc record;
begin
  select * into v_acc from public.fn_inv_current_account();
  insert into public.tbl_inv_audit_log (action, entity, entity_id, branch_id, account_id, auth_user_id, staff_id,
                                        txn_id, request_key, reason, before_data, after_data)
  values (p_action, p_entity, p_entity_id, p_branch_id, v_acc.account_id, v_acc.auth_user_id, p_staff,
          p_txn_id, p_key, left(p_reason, 500), p_before, p_after);
end $$;

-- ----------------------------------------------------------------------------
-- 7. Cache verification, rebuild, DEMO purge (D-116, Q-21)
-- ----------------------------------------------------------------------------

-- Drift between the caches and the ledger (I1). Empty array = clean.
create or replace function public.fn_inv_verify_balances(p_branch_id bigint)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'POOL', 'product_id', coalesce(p.product_id, s.product_id),
             'cache_qty', p.qty, 'ledger_qty', s.q, 'cache_value', p.value, 'ledger_value', s.v) as x
      from (select * from public.tbl_inv_cost_pools where branch_id = p_branch_id) p
      full join (select l.product_id, sum(l.qty_base) as q, sum(l.value + l.revaluation_value) as v
                   from public.tbl_inv_txn_lines l where l.branch_id = p_branch_id group by l.product_id) s
        on s.product_id = p.product_id
     where coalesce(p.qty, 0) <> coalesce(s.q, 0) or coalesce(p.value, 0) <> coalesce(s.v, 0)
    union all
    select jsonb_build_object('kind', 'BUCKET', 'location_id', coalesce(b.location_id, s.location_id),
             'product_id', coalesce(b.product_id, s.product_id), 'resident_id', coalesce(b.resident_id, s.resident_id),
             'cache_qty', b.qty, 'ledger_qty', s.q)
      from (select * from public.tbl_inv_balances where branch_id = p_branch_id) b
      full join (select l.location_id, l.product_id, l.resident_id, sum(l.qty_base) as q
                   from public.tbl_inv_txn_lines l where l.branch_id = p_branch_id
                  group by l.location_id, l.product_id, l.resident_id) s
        on s.location_id = b.location_id and s.product_id = b.product_id and s.resident_id is not distinct from b.resident_id
     where coalesce(b.qty, 0) <> coalesce(s.q, 0)
  ) d
$$;

-- Recompute a branch's caches from the ledger. SQL editor (postgres) only.
create or replace function public.fn_inv_rebuild_caches(p_branch_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_drift jsonb;
begin
  if session_user <> 'postgres' then
    raise exception 'INV_FORBIDDEN: fn_inv_rebuild_caches runs from the SQL editor only';
  end if;
  v_drift := public.fn_inv_verify_balances(p_branch_id);
  perform set_config('inv.rebuild', 'on', true);

  insert into public.tbl_inv_cost_pools (branch_id, product_id)
  select distinct p_branch_id, l.product_id from public.tbl_inv_txn_lines l where l.branch_id = p_branch_id
  on conflict (branch_id, product_id) do nothing;
  update public.tbl_inv_cost_pools cp
     set qty = coalesce(s.q, 0), value = coalesce(s.v, 0), wac = s.w, last_line_id = s.last_id, updated_at = now()
    from (select l.product_id, sum(l.qty_base) as q, sum(l.value + l.revaluation_value) as v, max(l.id) as last_id,
                 (array_agg(l.pool_wac_after order by l.id desc))[1] as w
            from public.tbl_inv_txn_lines l where l.branch_id = p_branch_id group by l.product_id) s
   where cp.branch_id = p_branch_id and cp.product_id = s.product_id;

  insert into public.tbl_inv_balances (branch_id, location_id, product_id, resident_id)
  select distinct p_branch_id, l.location_id, l.product_id, l.resident_id
    from public.tbl_inv_txn_lines l where l.branch_id = p_branch_id
  on conflict on constraint uq_inv_balances_bucket do nothing;
  update public.tbl_inv_balances b
     set qty = coalesce((select sum(l.qty_base) from public.tbl_inv_txn_lines l
                          where l.location_id = b.location_id and l.product_id = b.product_id
                            and l.resident_id is not distinct from b.resident_id), 0),
         updated_at = now()
   where b.branch_id = p_branch_id;

  perform set_config('inv.rebuild', 'off', true);
  insert into public.tbl_inv_audit_log (action, entity, entity_id, branch_id, reason, before_data)
  values ('REBUILD_CACHES', 'branch', p_branch_id::text, p_branch_id, 'fn_inv_rebuild_caches', v_drift);
  return jsonb_build_object('drift_before', v_drift, 'drift_after', public.fn_inv_verify_balances(p_branch_id));
end $$;

-- Delete every inventory row of demo branches, plus demo-owned master data.
-- SQL editor (postgres) only; the immutability triggers allow it only here.
create or replace function public.fn_inv_purge_demo()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_demo bigint[];
  v_accounts bigint[];
begin
  if session_user <> 'postgres' then
    raise exception 'INV_FORBIDDEN: fn_inv_purge_demo runs from the SQL editor only';
  end if;
  select array_agg(b."BranchID") into v_demo from public.tbl_branches b where b.is_demo;
  if v_demo is null then
    return jsonb_build_object('purged', false);
  end if;
  select array_agg(a.id) into v_accounts from public.tbl_user_accounts a where a.branch_id = any (v_demo);
  perform set_config('inv.demo_purge', 'on', true);
  set constraints all deferred;

  delete from public.tbl_inv_charge_export_items where branch_id = any (v_demo);
  delete from public.tbl_inv_charge_exports where branch_id = any (v_demo);
  delete from public.tbl_inv_charges where branch_id = any (v_demo);
  delete from public.tbl_inv_audit_log where branch_id = any (v_demo) or owner_branch_id = any (v_demo)
     or (branch_id is null and account_id = any (coalesce(v_accounts, '{}')));
  delete from public.tbl_inv_period_closing where branch_id = any (v_demo);
  delete from public.tbl_inv_branch_transfer_receipts where branch_id = any (v_demo);
  delete from public.tbl_inv_adjustment_lines where branch_id = any (v_demo);
  delete from public.tbl_inv_adjustments where branch_id = any (v_demo);
  delete from public.tbl_inv_count_lines where branch_id = any (v_demo);
  delete from public.tbl_inv_counts where branch_id = any (v_demo);
  delete from public.tbl_inv_branch_transfer_lines where branch_id = any (v_demo);
  delete from public.tbl_inv_branch_transfers where from_branch_id = any (v_demo);
  delete from public.tbl_inv_receipt_lines where branch_id = any (v_demo);
  delete from public.tbl_inv_receipts where branch_id = any (v_demo);
  delete from public.tbl_inv_stock_request_events where branch_id = any (v_demo);
  delete from public.tbl_inv_stock_request_lines where branch_id = any (v_demo);
  delete from public.tbl_inv_stock_requests where branch_id = any (v_demo);
  delete from public.tbl_inv_balances where branch_id = any (v_demo);
  delete from public.tbl_inv_cost_pools where branch_id = any (v_demo);
  delete from public.tbl_inv_txn_lines where branch_id = any (v_demo);
  delete from public.tbl_inv_txns where branch_id = any (v_demo);
  delete from public.tbl_inv_billing_periods where branch_id = any (v_demo);
  delete from public.tbl_inv_counters where branch_id = any (v_demo);
  delete from public.tbl_inv_idempotency where account_id = any (coalesce(v_accounts, '{}'));
  delete from public.tbl_inv_stock_levels where branch_id = any (v_demo);
  delete from public.tbl_inv_resident_billing where branch_id = any (v_demo);
  delete from public.tbl_inv_product_barcodes where owner_branch_id = any (v_demo);
  delete from public.tbl_inv_product_uoms pu using public.tbl_inv_products p
   where p.id = pu.product_id and p.owner_branch_id = any (v_demo);
  delete from public.tbl_inv_products where owner_branch_id = any (v_demo);
  delete from public.tbl_inv_suppliers where owner_branch_id = any (v_demo);

  perform set_config('inv.demo_purge', 'off', true);
  return jsonb_build_object('purged', true, 'branches', to_jsonb(v_demo));
end $$;

-- Grants: schema/013_inventory_grants.sql (re-run after every inventory migration, audit P1-17).

-- Nothing this file created is reachable through the API until 013 (audit V-1).
select public.fn_inv_lockdown();

commit;
