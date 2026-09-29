-- ============================================================================
-- 010 — General Inventory: stock-movement RPCs (called by the webapp)
-- ============================================================================
-- inv_post_receipt            RECEIPT (+ receive & allocate → TRANSIT_ALLOCATE)
-- inv_post_issue              ISSUE to a resident or to OSEM expense (+ charges)
-- inv_post_transfer           INTERNAL_TRANSFER / TRANSIT_ALLOCATE / TRANSIT_RELEASE
-- inv_post_write_off          DAMAGED_EXPIRED up to the branch threshold
-- inv_dispatch_branch_transfer / inv_receive_branch_transfer / inv_cancel_branch_transfer
--
-- Every RPC: (p_payload jsonb, p_key uuid) → jsonb {ok, code, message, data}.
-- Order (§8.7): shape → capability (branch derived from the row acted on) →
-- idempotency → plan → lock → business rules → write → audit → store result.
-- Business rejections return a code before anything is posted; anything that
-- fails after the first write raises and rolls the whole call back.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Shared helpers (internal)
-- ----------------------------------------------------------------------------

create or replace function public.fn_inv_jnum_default(p jsonb, p_default numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) = 'null' then p_default else public.fn_inv_jnum(p) end
$$;

create or replace function public.fn_inv_location_of(p_location_id bigint)
returns table (id bigint, branch_id bigint, kind text, is_active boolean)
language sql stable set search_path = '' as $$
  select l.id, l.branch_id, l.kind, l.is_active from public.tbl_inv_locations l where l.id = p_location_id
$$;

create or replace function public.fn_inv_branch_location(p_branch_id bigint, p_kind text)
returns bigint language sql stable set search_path = '' as $$
  select l.id from public.tbl_inv_locations l where l.branch_id = p_branch_id and l.kind = p_kind and l.is_active
$$;

-- Validates payload lines [{product_id, uom_id, qty}] for one branch.
-- Returns {"error": code, "line": n} or {"items": [resolved item, ...]}.
create or replace function public.fn_inv_resolve_lines(p_branch_id bigint, p_lines jsonb, p_stock_item boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  l jsonb;
  v_item jsonb;
  v_items jsonb := '[]';
  v_n int := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    return jsonb_build_object('error', 'INVALID_PAYLOAD', 'field', 'lines');
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    if jsonb_typeof(l) <> 'object' then
      return jsonb_build_object('error', 'INVALID_PAYLOAD', 'line', v_n);
    end if;
    v_item := public.fn_inv_resolve_item(p_branch_id, public.fn_inv_jbigint(l->'product_id'),
                public.fn_inv_jbigint(l->'uom_id'), public.fn_inv_jnum(l->'qty'), p_stock_item);
    if v_item ? 'error' then
      return v_item || jsonb_build_object('line', v_n);
    end if;
    if exists (select 1 from jsonb_array_elements(v_items) x where (x->>'product_id')::bigint = (v_item->>'product_id')::bigint) then
      return jsonb_build_object('error', 'DUPLICATE_LINE', 'line', v_n);
    end if;
    v_items := v_items || jsonb_build_array(v_item || jsonb_build_object('line_no', v_n, 'raw', l));
  end loop;
  return jsonb_build_object('items', v_items);
end $$;

-- A ledger line spec for the writer.
create or replace function public.fn_inv_line_spec(p_id bigint, p_line_no int, p_location_id bigint, p_kind text,
  p_resident_id bigint, p_item jsonb, p_sign int, p_mode text, p_value numeric default null,
  p_cost_source text default null, p_pair_line_id bigint default null, p_source_line_id bigint default null,
  p_pair_ref bigint default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_id, 'line_no', p_line_no, 'location_id', p_location_id, 'location_kind', p_kind,
    'resident_id', p_resident_id, 'product_id', (p_item->>'product_id')::bigint,
    'qty_base', p_sign * (p_item->>'qty_base')::numeric,
    'uom_id', (p_item->>'uom_id')::bigint, 'uom_code', p_item->>'uom_code',
    'qty_entered', (p_item->>'qty_entered')::numeric, 'factor', (p_item->>'factor')::numeric,
    'mode', p_mode, 'value', p_value, 'cost_source', p_cost_source,
    'pair_line_id', p_pair_line_id, 'source_line_id', p_source_line_id, 'pair_ref', p_pair_ref::text))
$$;

-- The same item expressed in base units (used for allocation/transfer-in legs).
create or replace function public.fn_inv_item_in_base(p_item jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select p_item || jsonb_build_object('uom_id', (p_item->>'base_uom_id')::bigint, 'uom_code', p_item->>'base_uom_code',
                                      'qty_entered', (p_item->>'qty_base')::numeric, 'factor', 1)
$$;

-- Lines of a posting plan whose quantity trips the D-109 sanity rule.
create or replace function public.fn_inv_plan_qty_sanity(p_txns jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_agg(jsonb_build_object('line_no', (l->>'line_no')::int, 'product_id', (l->>'product_id')::bigint,
                                      'qty_base', (l->>'qty_base')::numeric))
    from jsonb_array_elements(p_txns) t, jsonb_array_elements(t->'lines') l
   where (l->>'qty_base')::numeric < 0
     and public.fn_inv_qty_insane((l->>'location_id')::bigint, (l->>'product_id')::bigint, (l->>'qty_base')::numeric)
$$;

-- Charges for the lines of an ISSUE txn (D-70, D-71, D-121; Q-28, Q-31:
-- the catalogue price at the moment of posting is frozen onto the charge).
create or replace function public.fn_inv_issue_charges(p_txn_id bigint, p_target text, p_resident_id bigint,
  p_expense_note text, p_staff text, p_account_id bigint, p_key uuid)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_ids jsonb;
begin
  with ins as (
    insert into public.tbl_inv_charges (branch_id, billing_period_id, charge_date, charge_kind, target, resident_id,
      expense_note, txn_id, txn_line_id, product_id, product_name, sku, uom_code, qty_base, unit_charge_price,
      charge_amount, cost_amount, request_key, created_by_account, created_by_staff)
    select t.branch_id, t.billing_period_id, t.txn_date, 'ISSUE', p_target,
           case when p_target = 'RESIDENT' then p_resident_id end,
           case when p_target = 'OSEM_EXPENSE' then p_expense_note end,
           t.id, l.id, p.id, p.name, p.sku, bu.code, -l.qty_base,
           case when p_target = 'RESIDENT' then p.charge_price end,
           case when p_target = 'RESIDENT' then coalesce(round(-l.qty_base * p.charge_price, 2), 0) else 0 end,
           -l.value, p_key, p_account_id, p_staff
      from public.tbl_inv_txns t
      join public.tbl_inv_txn_lines l on l.txn_id = t.id
      join public.tbl_inv_products p on p.id = l.product_id
      join public.tbl_inv_uoms bu on bu.id = p.base_uom_id
     where t.id = p_txn_id
     order by l.line_no
    returning id, unit_charge_price, target
  )
  select jsonb_build_object('charge_ids', jsonb_agg(id order by id),
                            'price_pending', coalesce(bool_or(target = 'RESIDENT' and unit_charge_price is null), false))
    into v_ids from ins;
  return v_ids;
end $$;

-- Common tail of a posting RPC: lock, rules, write. Returns the lock/bucket
-- rejection (jsonb with ok=false) or {"written": ..., "negative": bool}.
create or replace function public.fn_inv_lock_and_write(p_txns jsonb, p_counters jsonb, p_allow_negative boolean,
  p_account_id bigint, p_key uuid, p_transit_code text default 'TRANSIT_NEGATIVE')
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_lock jsonb;
  v_problem jsonb;
  v_check jsonb;
  v_txns jsonb := p_txns;
  v_written jsonb;
begin
  -- read-only pre-checks first: a rejected call inserts nothing (audit P1-13)
  v_problem := public.fn_inv_state_problem(p_txns);
  if v_problem is not null then
    return v_problem;
  end if;
  v_check := public.fn_inv_check_buckets(p_txns, p_allow_negative);
  if v_check->>'code' = 'TRANSIT_NEGATIVE' then
    return public.fn_inv_err(p_transit_code, 'Transit stock cannot go below zero', v_check->'buckets');
  end if;
  if v_check->>'code' is not null then
    return public.fn_inv_err(v_check->>'code', 'Stock would go below zero; confirm to continue', v_check->'buckets');
  end if;
  -- then the lock plan, and the same rules again on locked rows (authoritative)
  v_lock := public.fn_inv_lock(p_txns, null, p_counters);
  v_problem := public.fn_inv_lock_problem(v_lock);
  if v_problem is not null then
    return v_problem;
  end if;
  v_check := public.fn_inv_check_buckets(p_txns, p_allow_negative);
  if v_check->>'code' = 'TRANSIT_NEGATIVE' then
    return public.fn_inv_err(p_transit_code, 'Transit stock cannot go below zero', v_check->'buckets');
  end if;
  if v_check->>'code' is not null then
    return public.fn_inv_err(v_check->>'code', 'Stock would go below zero; confirm to continue', v_check->'buckets');
  end if;
  if (v_check->>'negative')::boolean then
    select jsonb_agg(t || jsonb_build_object('negative_stock_confirmed', true)) into v_txns
      from jsonb_array_elements(p_txns) t;
  end if;
  v_written := public.fn_inv_write_txns(v_txns, p_account_id, p_key);
  return jsonb_build_object('ok', true, 'written', v_written, 'negative', (v_check->>'negative')::boolean);
end $$;

-- ----------------------------------------------------------------------------
-- Receipt helpers (D-105 as narrowed by D-138)
-- ----------------------------------------------------------------------------

-- Validates the receipt header + lines and computes landed values: tax, other
-- charges and rounding minus discount, spread pro-rata by line_total, the
-- remainder cent on the largest line (§5.4). FOC lines carry zero cost.
create or replace function public.fn_inv_build_receipt_body(p_branch_id bigint, p_body jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  l jsonb;
  v_item jsonb;
  v_lines jsonb := '[]';
  v_n int := 0;
  v_paid numeric; v_foc numeric; v_cost numeric;
  v_lines_total numeric := 0;
  v_disc numeric := public.fn_inv_jnum_default(p_body->'discount_total', 0);
  v_tax numeric := public.fn_inv_jnum_default(p_body->'tax_total', 0);
  v_other numeric := public.fn_inv_jnum_default(p_body->'other_charges_total', 0);
  v_round numeric := public.fn_inv_jnum_default(p_body->'rounding_adj', 0);
  v_extra numeric;
  v_alloc_sum numeric := 0;
  v_largest int;
  v_supplier record;
  v_doc_type text := public.fn_inv_jtext(p_body->'doc_type');
  v_invoice_no text := public.fn_inv_jtext(p_body->'invoice_no');
  v_invoice_date date := public.fn_inv_jdate(p_body->'invoice_date');
  v_remarks text := public.fn_inv_jtext(p_body->'remarks');
  v_paper numeric := public.fn_inv_jnum_default(p_body->'invoice_total_paper', -1);
begin
  if v_doc_type is null or v_doc_type not in ('INVOICE','CASH_BILL') then
    return jsonb_build_object('error', 'INVALID_DOC_TYPE');
  end if;
  if v_invoice_no is null or length(v_invoice_no) > 60 then
    return jsonb_build_object('error', 'INVOICE_REQUIRED');           -- D-138: no receipt without the invoice
  end if;
  if v_invoice_date is null or v_invoice_date > public.fn_inv_today() then
    return jsonb_build_object('error', 'INVALID_INVOICE_DATE');
  end if;
  if v_disc is null or v_tax is null or v_other is null or v_round is null
     or v_disc < 0 or v_tax < 0 or v_other < 0 or abs(v_round) > 1
     or greatest(v_disc, v_tax, v_other) > 10000000
     or round(v_disc, 2) <> v_disc or round(v_tax, 2) <> v_tax or round(v_other, 2) <> v_other
     or round(v_round, 2) <> v_round then
    return jsonb_build_object('error', 'INVALID_TOTALS');
  end if;
  if v_remarks is not null and length(v_remarks) > 500 then
    return jsonb_build_object('error', 'INVALID_PAYLOAD', 'field', 'remarks');
  end if;
  -- the total printed on the invoice: stored for information only, never blocks (D-138, P1-18)
  if v_paper is null or (v_paper <> -1 and (v_paper < 0 or v_paper > 100000000 or round(v_paper, 2) <> v_paper)) then
    return jsonb_build_object('error', 'INVALID_TOTALS', 'field', 'invoice_total_paper');
  end if;

  select s.id, s.name, s.is_active, s.owner_branch_id into v_supplier
    from public.tbl_inv_suppliers s
   where s.id = public.fn_inv_jbigint(p_body->'supplier_id')
     and (s.owner_branch_id is null or s.owner_branch_id = p_branch_id);
  if not found then
    return jsonb_build_object('error', 'SUPPLIER_NOT_FOUND');
  end if;
  if not v_supplier.is_active then
    return jsonb_build_object('error', 'SUPPLIER_INACTIVE');
  end if;

  if jsonb_typeof(p_body->'lines') <> 'array' or jsonb_array_length(p_body->'lines') not between 1 and 200 then
    return jsonb_build_object('error', 'INVALID_PAYLOAD', 'field', 'lines');
  end if;
  for l in select * from jsonb_array_elements(p_body->'lines') loop
    v_n := v_n + 1;
    v_paid := public.fn_inv_jnum_default(l->'qty', 0);
    v_foc := public.fn_inv_jnum_default(l->'foc_qty', 0);
    v_cost := public.fn_inv_jnum(l->'unit_cost');
    if v_paid is null or v_foc is null or v_paid < 0 or v_foc < 0 or v_paid + v_foc <= 0 then
      return jsonb_build_object('error', 'INVALID_QTY', 'line', v_n);
    end if;
    if v_cost is null or v_cost < 0 then
      return jsonb_build_object('error', 'INVALID_COST', 'line', v_n);
    end if;
    if v_cost > 100000 then                                            -- D-109 hard cap
      return jsonb_build_object('error', 'COST_TOO_LARGE', 'line', v_n);
    end if;
    v_item := public.fn_inv_resolve_item(p_branch_id, public.fn_inv_jbigint(l->'product_id'),
                public.fn_inv_jbigint(l->'uom_id'), v_paid + v_foc, true);
    if v_item ? 'error' then
      return v_item || jsonb_build_object('line', v_n);
    end if;
    if (v_paid <> trunc(v_paid) or v_foc <> trunc(v_foc))
       and not exists (select 1 from public.tbl_inv_uoms u where u.id = (v_item->>'uom_id')::bigint and u.allow_fraction) then
      return jsonb_build_object('error', 'QTY_NOT_INTEGRAL', 'line', v_n);
    end if;
    if exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'product_id')::bigint = (v_item->>'product_id')::bigint) then
      return jsonb_build_object('error', 'DUPLICATE_LINE', 'line', v_n);
    end if;
    v_lines := v_lines || jsonb_build_array(v_item || jsonb_build_object(
      'line_no', v_n, 'qty_paid', v_paid, 'foc_qty', v_foc, 'unit_cost_entered', v_cost,
      'line_total', round(v_paid * v_cost, 2),
      'allocate_resident_id', public.fn_inv_jbigint(l->'allocate_resident_id'),
      'allocate_raw', l->'allocate_resident_id'));
    v_lines_total := v_lines_total + round(v_paid * v_cost, 2);
  end loop;

  -- landed cost (Q-11): pro-rata by line_total, remainder cent on the largest line
  v_extra := v_tax + v_other + v_round - v_disc;
  if v_extra <> 0 and v_lines_total = 0 then
    return jsonb_build_object('error', 'EXTRA_WITHOUT_LINE_VALUE');
  end if;
  select (x->>'line_no')::int into v_largest from jsonb_array_elements(v_lines) x
   order by (x->>'line_total')::numeric desc, (x->>'line_no')::int limit 1;
  select jsonb_agg(x || jsonb_build_object('alloc',
           case when v_lines_total = 0 then 0 else round(v_extra * (x->>'line_total')::numeric / v_lines_total, 2) end)
           order by (x->>'line_no')::int)
    into v_lines from jsonb_array_elements(v_lines) x;
  select coalesce(sum((x->>'alloc')::numeric), 0) into v_alloc_sum from jsonb_array_elements(v_lines) x;
  select jsonb_agg(x || jsonb_build_object('landed_value',
           (x->>'line_total')::numeric + (x->>'alloc')::numeric
           + case when (x->>'line_no')::int = v_largest then v_extra - v_alloc_sum else 0 end)
           order by (x->>'line_no')::int)
    into v_lines from jsonb_array_elements(v_lines) x;
  if exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'landed_value')::numeric < 0) then
    return jsonb_build_object('error', 'NEGATIVE_LANDED_COST');
  end if;

  return jsonb_build_object(
    'supplier_id', v_supplier.id, 'supplier_name', v_supplier.name, 'doc_type', v_doc_type,
    'invoice_no', v_invoice_no, 'invoice_date', v_invoice_date, 'remarks', v_remarks,
    'discount_total', v_disc, 'tax_total', v_tax, 'other_charges_total', v_other, 'rounding_adj', v_round,
    'lines_total', v_lines_total, 'landed_total', v_lines_total + v_extra,
    'invoice_total_paper', case when v_paper <> -1 then v_paper end, 'lines', v_lines);
end $$;

-- D-109 sanity for receipt lines: qty rule, line total > 5000, and a landed
-- unit cost more than 50% away from every existing reference (last receipt
-- cost, pool WAC). Run after the lock so the references are stable.
create or replace function public.fn_inv_receipt_sanity(p_branch_id bigint, p_location_id bigint, p_lines jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with x as (
    select (l->>'line_no')::int as line_no, (l->>'product_id')::bigint as product_id,
           (l->>'qty_base')::numeric as qty_base, (l->>'line_total')::numeric as line_total,
           (l->>'landed_value')::numeric / (l->>'qty_base')::numeric as unit_cost,
           (select tl.unit_cost from public.tbl_inv_txn_lines tl
             where tl.branch_id = p_branch_id and tl.product_id = (l->>'product_id')::bigint
               and tl.txn_type = 'RECEIPT' and tl.qty_base > 0
             order by tl.id desc limit 1) as last_cost,
           (select cp.wac from public.tbl_inv_cost_pools cp
             where cp.branch_id = p_branch_id and cp.product_id = (l->>'product_id')::bigint) as wac
      from jsonb_array_elements(p_lines) l
  )
  select jsonb_agg(jsonb_build_object('line_no', line_no, 'product_id', product_id, 'reason', reason) order by line_no)
    from (
      select line_no, product_id, 'QTY' as reason from x
       where public.fn_inv_qty_insane(p_location_id, product_id, qty_base)
      union all
      select line_no, product_id, 'LINE_TOTAL' from x where line_total > 5000
      union all
      select line_no, product_id, 'UNIT_COST' from x
       where unit_cost > 0 and (coalesce(last_cost, 0) > 0 or coalesce(wac, 0) > 0)
         and (coalesce(last_cost, 0) <= 0 or abs(unit_cost - last_cost) > 0.5 * last_cost)
         and (coalesce(wac, 0) <= 0 or abs(unit_cost - wac) > 0.5 * wac)
    ) f
$$;

-- ----------------------------------------------------------------------------
-- inv_post_receipt (tier HEAD_NURSE, senior staff attributed — D-134)
-- payload: {location_id (STORE), supplier_id, doc_type, invoice_no, invoice_date,
--   received_date, received_by_staff, discount_total, tax_total, other_charges_total,
--   rounding_adj, remarks, lines:[{product_id, uom_id, qty, foc_qty, unit_cost,
--   allocate_resident_id?}], allow_negative?, sanity_confirmed?}
-- ----------------------------------------------------------------------------
create or replace function public.inv_post_receipt(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_post_receipt';
  v_acc record;
  v_loc record;
  v_branch bigint;
  v_replay jsonb;
  v_code text;
  v_date date := public.fn_inv_jdate(p_payload->'received_date');
  v_staff text := public.fn_inv_jtext(p_payload->'received_by_staff');
  v_body jsonb;
  v_transit bigint;
  v_item jsonb;
  v_res record;
  v_receipt_id bigint;
  v_txn_id bigint;
  v_alloc_txn_id bigint;
  v_line_ids jsonb := '{}';
  v_lines jsonb := '[]';
  v_alloc_lines jsonb := '[]';
  v_n int := 0;
  v_out_id bigint;
  v_in_id bigint;
  v_txns jsonb;
  v_sanity jsonb;
  v_res_w jsonb;
  v_receipt_no text;
  v_result jsonb;
  v_constraint text;
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
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  v_branch := v_loc.branch_id;
  if not public.fn_inv_can('RECEIPT', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_loc.kind <> 'STORE' then
    return public.fn_inv_err('LOCATION_NOT_STORE');                    -- D-23
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, v_date),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('RECEIPT')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  v_body := public.fn_inv_build_receipt_body(v_branch, p_payload);
  if v_body ? 'error' then
    return public.fn_inv_err(v_body->>'error', null, v_body);
  end if;
  if exists (select 1 from public.tbl_inv_receipts r
              where r.supplier_id = (v_body->>'supplier_id')::bigint and not r.is_voided
                and r.invoice_key = upper(regexp_replace(v_body->>'invoice_no', '[^A-Za-z0-9]', '', 'g'))) then
    return public.fn_inv_err('DUPLICATE_INVOICE');
  end if;

  -- receive & allocate (D-40): resident ACTIVE and in the branch
  for v_item in select * from jsonb_array_elements(v_body->'lines') loop
    if v_item->'allocate_raw' is not null and jsonb_typeof(v_item->'allocate_raw') <> 'null' then
      select r.id, r.branch_id, r.status into v_res from public.tbl_residents r
       where r.id = (v_item->>'allocate_resident_id')::bigint;
      if not found then
        return public.fn_inv_err('RESIDENT_NOT_FOUND', null, jsonb_build_object('line', v_item->'line_no'));
      end if;
      if v_res.branch_id <> v_branch then
        return public.fn_inv_err('RESIDENT_WRONG_BRANCH', null, jsonb_build_object('line', v_item->'line_no'));
      end if;
      if v_res.status <> 'ACTIVE' then
        return public.fn_inv_err('RESIDENT_NOT_ACTIVE', null, jsonb_build_object('line', v_item->'line_no'));
      end if;
      v_transit := public.fn_inv_branch_location(v_branch, 'TRANSIT');
      if v_transit is null then
        return public.fn_inv_err('TRANSIT_LOCATION_MISSING');
      end if;
    end if;
  end loop;

  -- plan with pre-allocated ids (D-112)
  v_receipt_id := public.fn_inv_next_id('tbl_inv_receipts');
  v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  for v_item in select * from jsonb_array_elements(v_body->'lines') loop
    v_out_id := public.fn_inv_next_id('tbl_inv_txn_lines');
    v_line_ids := v_line_ids || jsonb_build_object(v_item->>'line_no', v_out_id);
    v_lines := v_lines || jsonb_build_array(public.fn_inv_line_spec(v_out_id, (v_item->>'line_no')::int, v_loc.id,
                 'STORE', null, v_item, 1, 'IN_SPEC', (v_item->>'landed_value')::numeric, 'LANDED'));
  end loop;
  v_txns := jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_type', 'RECEIPT', 'branch_id', v_branch,
    'txn_date', v_date, 'performed_by_staff', v_staff, 'remarks', v_body->>'remarks',
    'sanity_confirmed', public.fn_inv_jbool(p_payload->'sanity_confirmed'),
    'source_doc_type', 'RECEIPT', 'source_doc_id', v_receipt_id, 'lines', v_lines));

  for v_item in select * from jsonb_array_elements(v_body->'lines')
                 where (value->>'allocate_resident_id') is not null loop
    v_n := v_n + 1;
    v_out_id := public.fn_inv_next_id('tbl_inv_txn_lines');
    v_in_id := public.fn_inv_next_id('tbl_inv_txn_lines');
    v_alloc_lines := v_alloc_lines
      || jsonb_build_array(public.fn_inv_line_spec(v_out_id, 2 * v_n - 1, v_loc.id, 'STORE', null,
           public.fn_inv_item_in_base(v_item), -1, 'INT_OUT', null, null, v_in_id))
      || jsonb_build_array(public.fn_inv_line_spec(v_in_id, 2 * v_n, v_transit, 'TRANSIT',
           (v_item->>'allocate_resident_id')::bigint, public.fn_inv_item_in_base(v_item), 1, 'INT_IN', null, null,
           v_out_id, null, v_out_id));
  end loop;
  if v_n > 0 then
    v_alloc_txn_id := public.fn_inv_next_id('tbl_inv_txns');
    v_txns := v_txns || jsonb_build_array(jsonb_build_object('id', v_alloc_txn_id, 'txn_type', 'TRANSIT_ALLOCATE',
      'branch_id', v_branch, 'txn_date', v_date, 'performed_by_staff', v_staff,
      'source_doc_type', 'RECEIPT', 'source_doc_id', v_receipt_id, 'lines', v_alloc_lines));
  end if;

  -- lock, then the checks that read locked state
  -- sanity is a soft check on committed data: done before anything is locked or inserted
  v_sanity := public.fn_inv_receipt_sanity(v_branch, v_loc.id, v_body->'lines');
  if v_sanity is not null and not public.fn_inv_jbool(p_payload->'sanity_confirmed') then
    return public.fn_inv_err('SANITY_CONFIRM', 'Please re-check the flagged lines', v_sanity);
  end if;
  -- Everything from here is one sub-block: if a concurrent call just stored the
  -- same invoice, the unique index fires and the whole block (ledger rows
  -- included) is undone and a friendly code returned (audit P1-19).
  begin
  v_res_w := public.fn_inv_lock_and_write(v_txns, jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'doc_type', 'RCV')),
                                          public.fn_inv_jbool(p_payload->'allow_negative'), v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;

  v_receipt_no := public.fn_inv_next_no(v_branch, 'RCV');
  insert into public.tbl_inv_receipts (id, receipt_no, branch_id, location_id, supplier_id, supplier_name, doc_type,
    invoice_no, invoice_date, received_date, received_by_staff, item_count, lines_total, discount_total, tax_total,
    other_charges_total, rounding_adj, landed_total, invoice_total_paper, txn_id, remarks, created_by_account)
  values (v_receipt_id, v_receipt_no, v_branch, v_loc.id, (v_body->>'supplier_id')::bigint, v_body->>'supplier_name',
    v_body->>'doc_type', v_body->>'invoice_no', (v_body->>'invoice_date')::date, v_date, v_staff,
    jsonb_array_length(v_body->'lines'), (v_body->>'lines_total')::numeric, (v_body->>'discount_total')::numeric,
    (v_body->>'tax_total')::numeric, (v_body->>'other_charges_total')::numeric, (v_body->>'rounding_adj')::numeric,
    (v_body->>'landed_total')::numeric, (v_body->>'invoice_total_paper')::numeric, v_txn_id, v_body->>'remarks',
    v_acc.account_id);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'uq_inv_receipts_invoice' then
      return public.fn_inv_finish(public.fn_inv_err('DUPLICATE_INVOICE'));
    end if;
    raise;
  end;
  insert into public.tbl_inv_receipt_lines (receipt_id, branch_id, line_no, product_id, product_name, uom_id,
    factor_to_base, qty_entered, foc_qty, qty_base, unit_cost_entered, line_total, landed_value, allocate_resident_id,
    txn_line_id)
  select v_receipt_id, v_branch, (x->>'line_no')::smallint, (x->>'product_id')::bigint, x->>'product_name',
         (x->>'uom_id')::bigint, (x->>'factor')::numeric, (x->>'qty_paid')::numeric, (x->>'foc_qty')::numeric,
         (x->>'qty_base')::numeric, (x->>'unit_cost_entered')::numeric, (x->>'line_total')::numeric,
         (x->>'landed_value')::numeric, (x->>'allocate_resident_id')::bigint, (v_line_ids->>(x->>'line_no'))::bigint
    from jsonb_array_elements(v_body->'lines') x;

  v_result := public.fn_inv_ok(jsonb_build_object('receipt_id', v_receipt_id, 'receipt_no', v_receipt_no,
    'txn_id', v_txn_id, 'allocation_txn_id', v_alloc_txn_id, 'txns', v_res_w->'written'->'txns',
    'negative_stock', v_res_w->'negative', 'landed_total', (v_body->>'landed_total')::numeric,
    'invoice_total_paper', v_body->'invoice_total_paper',
    'paper_difference', (v_body->>'invoice_total_paper')::numeric - (v_body->>'landed_total')::numeric));
  perform public.fn_inv_audit('RECEIPT_POSTED', 'receipt', v_receipt_id::text, v_branch, v_staff, v_txn_id, p_key, null,
    jsonb_build_object('receipt_no', v_receipt_no, 'invoice_no', v_body->>'invoice_no', 'landed_total', v_body->'landed_total'));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_post_issue (tier STAFF)
-- payload: {txn_date, performed_by_staff, target: RESIDENT|OSEM_EXPENSE, resident_id?,
--   expense_note?, remarks?, lines:[{location_id, product_id, uom_id, qty}],
--   allow_negative?, inactive_resident_confirmed?, sanity_confirmed?}
-- Transit lines are the target resident's bucket (D-22, D-107).
-- ----------------------------------------------------------------------------
create or replace function public.inv_post_issue(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_post_issue';
  v_acc record;
  v_branch bigint;
  v_replay jsonb;
  v_code text;
  v_date date := public.fn_inv_jdate(p_payload->'txn_date');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_target text := public.fn_inv_jtext(p_payload->'target');
  v_note text := public.fn_inv_jtext(p_payload->'expense_note');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_res_id bigint;
  v_res_branch bigint;
  v_res_status text;
  v_missing boolean;
  l jsonb;
  v_loc record;
  v_item jsonb;
  v_n int := 0;
  v_lines jsonb := '[]';
  v_seen jsonb := '[]';
  v_txn_id bigint;
  v_txns jsonb;
  v_sanity jsonb;
  v_res_w jsonb;
  v_charges jsonb;
  v_result jsonb;
  v_has_sf boolean := false;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') not between 1 and 200 then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  -- the branch is the (single) branch of the issuing locations
  select min(lo.branch_id), count(distinct lo.branch_id), bool_or(lo.id is null)
    into v_branch, v_n, v_missing
    from jsonb_array_elements(p_payload->'lines') x
    left join public.tbl_inv_locations lo on lo.id = public.fn_inv_jbigint(x->'location_id');
  if v_missing or v_n <> 1 then
    return public.fn_inv_err(case when v_missing then 'FORBIDDEN' else 'MIXED_BRANCHES' end);
  end if;
  if not public.fn_inv_can('ISSUE', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, v_date),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('ISSUE')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_target is null or v_target not in ('RESIDENT','OSEM_EXPENSE') then
    return public.fn_inv_err('INVALID_TARGET');
  end if;
  if (v_note is not null and length(v_note) > 200) or (v_remarks is not null and length(v_remarks) > 500) then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'expense_note/remarks'));
  end if;
  if v_target = 'RESIDENT' then
    select r.id, r.branch_id, r.status into v_res_id, v_res_branch, v_res_status from public.tbl_residents r
     where r.id = public.fn_inv_jbigint(p_payload->'resident_id');
    if v_res_id is null then
      return public.fn_inv_err('RESIDENT_NOT_FOUND');
    end if;
    if v_res_status <> 'ACTIVE' and not public.fn_inv_jbool(p_payload->'inactive_resident_confirmed') then
      return public.fn_inv_err('INACTIVE_RESIDENT_CONFIRM', 'The resident is not active; confirm to continue');
    end if;
  elsif p_payload->'resident_id' is not null and jsonb_typeof(p_payload->'resident_id') <> 'null' then
    return public.fn_inv_err('INVALID_TARGET', 'An OSEM-expense issue has no resident');
  end if;

  v_n := 0;
  v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  for l in select * from jsonb_array_elements(p_payload->'lines') loop
    v_n := v_n + 1;
    select * into v_loc from public.fn_inv_location_of(public.fn_inv_jbigint(l->'location_id'));
    v_item := public.fn_inv_resolve_item(v_branch, public.fn_inv_jbigint(l->'product_id'),
                public.fn_inv_jbigint(l->'uom_id'), public.fn_inv_jnum(l->'qty'), true);
    if v_item ? 'error' then
      return public.fn_inv_err(v_item->>'error', null, jsonb_build_object('line', v_n));
    end if;
    if v_loc.kind = 'TRANSIT' and v_target <> 'RESIDENT' then
      return public.fn_inv_err('TRANSIT_ISSUE_RESIDENT_ONLY', null, jsonb_build_object('line', v_n));   -- D-22
    end if;
    if v_loc.kind <> 'TRANSIT' then
      v_has_sf := true;
    end if;
    if v_target = 'RESIDENT' and not (v_item->>'is_chargeable')::boolean then
      return public.fn_inv_err('NOT_CHARGEABLE', null, jsonb_build_object('line', v_n));             -- D-121
    end if;
    if v_seen @> jsonb_build_array(jsonb_build_array(v_loc.id, (v_item->>'product_id')::bigint)) then
      return public.fn_inv_err('DUPLICATE_LINE', null, jsonb_build_object('line', v_n));
    end if;
    v_seen := v_seen || jsonb_build_array(jsonb_build_array(v_loc.id, (v_item->>'product_id')::bigint));
    v_lines := v_lines || jsonb_build_array(public.fn_inv_line_spec(public.fn_inv_next_id('tbl_inv_txn_lines'), v_n,
                 v_loc.id, v_loc.kind, case when v_loc.kind = 'TRANSIT' then v_res_id end, v_item, -1, 'OUT_WAC'));
  end loop;
  -- issues from STORE/FLOOR to a resident need the resident in this branch (D-107)
  if v_target = 'RESIDENT' and v_has_sf and v_res_branch <> v_branch then
    return public.fn_inv_err('RESIDENT_WRONG_BRANCH');
  end if;

  v_txns := jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_type', 'ISSUE', 'branch_id', v_branch,
    'txn_date', v_date, 'performed_by_staff', v_staff, 'remarks', v_remarks,
    'expense_note', case when v_target = 'OSEM_EXPENSE' then v_note end,
    'inactive_resident_confirmed', v_target = 'RESIDENT' and v_res_status <> 'ACTIVE',
    'sanity_confirmed', public.fn_inv_jbool(p_payload->'sanity_confirmed'), 'lines', v_lines));
  v_sanity := public.fn_inv_plan_qty_sanity(v_txns);
  if v_sanity is not null and not public.fn_inv_jbool(p_payload->'sanity_confirmed') then
    return public.fn_inv_err('SANITY_CONFIRM', 'Please re-check the flagged lines', v_sanity);
  end if;

  v_res_w := public.fn_inv_lock_and_write(v_txns, null, public.fn_inv_jbool(p_payload->'allow_negative'),
                                          v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;
  v_charges := public.fn_inv_issue_charges(v_txn_id, v_target, v_res_id, v_note, v_staff, v_acc.account_id, p_key);

  v_result := public.fn_inv_ok(jsonb_build_object('txn_id', v_txn_id, 'txn_no', v_res_w->'written'->'txns'->0->>'txn_no',
    'charge_ids', v_charges->'charge_ids', 'price_pending', v_charges->'price_pending',
    'negative_stock', v_res_w->'negative'));
  perform public.fn_inv_audit('ISSUE_POSTED', 'txn', v_txn_id::text, v_branch, v_staff, v_txn_id, p_key, null,
    jsonb_build_object('target', v_target, 'resident_id', v_res_id, 'lines', jsonb_array_length(v_lines)));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_post_transfer (same-branch moves)
--   INTERNAL: STORE ↔ FLOOR                       tier STAFF
--   ALLOCATE: STORE/FLOOR → TRANSIT[r]             tier STAFF, r ACTIVE and in branch
--   RELEASE:  TRANSIT[r] → STORE, fixed reasons    tier HEAD_NURSE (D-124)
-- payload: {kind, from_location_id, to_location_id, resident_id?, txn_date,
--   performed_by_staff, reason_code?, remarks?, lines:[{product_id, uom_id, qty}],
--   allow_negative?, sanity_confirmed?}
-- ----------------------------------------------------------------------------
create or replace function public.inv_post_transfer(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_post_transfer';
  v_acc record;
  v_kind text := public.fn_inv_jtext(p_payload->'kind');
  v_action text;
  v_txn_type text;
  v_from record;
  v_to record;
  v_branch bigint;
  v_replay jsonb;
  v_code text;
  v_date date := public.fn_inv_jdate(p_payload->'txn_date');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := public.fn_inv_jtext(p_payload->'reason_code');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_res_id bigint;
  v_res_branch bigint;
  v_res_status text;
  v_resolved jsonb;
  v_item jsonb;
  v_lines jsonb := '[]';
  v_n int := 0;
  v_out_id bigint;
  v_in_id bigint;
  v_txn_id bigint;
  v_txns jsonb;
  v_sanity jsonb;
  v_res_w jsonb;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or v_kind is null
     or v_kind not in ('INTERNAL','ALLOCATE','RELEASE') then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  v_action := case v_kind when 'INTERNAL' then 'INTERNAL_TRANSFER' when 'ALLOCATE' then 'TRANSIT_ALLOCATE'
                          else 'TRANSIT_RELEASE' end;
  v_txn_type := v_action;
  select * into v_from from public.fn_inv_location_of(public.fn_inv_jbigint(p_payload->'from_location_id'));
  if not found then
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  select * into v_to from public.fn_inv_location_of(public.fn_inv_jbigint(p_payload->'to_location_id'));
  if not found then
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  v_branch := v_from.branch_id;
  if not public.fn_inv_can(v_action, v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_to.branch_id <> v_branch then
    return public.fn_inv_err('MIXED_BRANCHES', 'Use a branch transfer to move stock between branches');
  end if;
  if not ((v_kind = 'INTERNAL' and v_from.kind in ('STORE','FLOOR') and v_to.kind in ('STORE','FLOOR') and v_from.kind <> v_to.kind)
       or (v_kind = 'ALLOCATE' and v_from.kind in ('STORE','FLOOR') and v_to.kind = 'TRANSIT')
       or (v_kind = 'RELEASE' and v_from.kind = 'TRANSIT' and v_to.kind = 'STORE')) then
    return public.fn_inv_err('INVALID_LOCATIONS');                     -- D-22
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, v_date),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff(v_action)));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_remarks is not null and length(v_remarks) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'remarks'));
  end if;
  if v_kind = 'RELEASE' then
    if v_reason is null or v_reason not in ('DISCHARGED','DECEASED','NO_LONGER_REQUIRED','WRONG_ALLOCATION') then
      return public.fn_inv_err('INVALID_REASON');                      -- D-124
    end if;
  else
    v_reason := null;
  end if;
  if v_kind in ('ALLOCATE','RELEASE') then
    select r.id, r.branch_id, r.status into v_res_id, v_res_branch, v_res_status from public.tbl_residents r
     where r.id = public.fn_inv_jbigint(p_payload->'resident_id');
    if v_res_id is null then
      return public.fn_inv_err('RESIDENT_NOT_FOUND');
    end if;
    if v_kind = 'ALLOCATE' and v_res_branch <> v_branch then
      return public.fn_inv_err('RESIDENT_WRONG_BRANCH');               -- new allocations only (D-107)
    end if;
    if v_kind = 'ALLOCATE' and v_res_status <> 'ACTIVE' then
      return public.fn_inv_err('RESIDENT_NOT_ACTIVE');
    end if;
  end if;

  v_resolved := public.fn_inv_resolve_lines(v_branch, p_payload->'lines', true);
  if v_resolved ? 'error' then
    return public.fn_inv_err(v_resolved->>'error', null, v_resolved);
  end if;
  v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  for v_item in select * from jsonb_array_elements(v_resolved->'items') loop
    v_n := v_n + 1;
    v_out_id := public.fn_inv_next_id('tbl_inv_txn_lines');
    v_in_id := public.fn_inv_next_id('tbl_inv_txn_lines');
    v_lines := v_lines
      || jsonb_build_array(public.fn_inv_line_spec(v_out_id, 2 * v_n - 1, v_from.id, v_from.kind,
           case when v_from.kind = 'TRANSIT' then v_res_id end, v_item, -1, 'INT_OUT', null, null, v_in_id))
      || jsonb_build_array(public.fn_inv_line_spec(v_in_id, 2 * v_n, v_to.id, v_to.kind,
           case when v_to.kind = 'TRANSIT' then v_res_id end, v_item, 1, 'INT_IN', null, null, v_out_id, null, v_out_id));
  end loop;
  v_txns := jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_type', v_txn_type, 'branch_id', v_branch,
    'txn_date', v_date, 'performed_by_staff', v_staff, 'reason_code', v_reason, 'remarks', v_remarks,
    'sanity_confirmed', public.fn_inv_jbool(p_payload->'sanity_confirmed'), 'lines', v_lines));
  v_sanity := public.fn_inv_plan_qty_sanity(v_txns);
  if v_sanity is not null and not public.fn_inv_jbool(p_payload->'sanity_confirmed') then
    return public.fn_inv_err('SANITY_CONFIRM', 'Please re-check the flagged lines', v_sanity);
  end if;

  v_res_w := public.fn_inv_lock_and_write(v_txns, null, public.fn_inv_jbool(p_payload->'allow_negative'),
                                          v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;
  v_result := public.fn_inv_ok(jsonb_build_object('txn_id', v_txn_id, 'txn_no', v_res_w->'written'->'txns'->0->>'txn_no',
    'negative_stock', v_res_w->'negative'));
  perform public.fn_inv_audit(v_txn_type || '_POSTED', 'txn', v_txn_id::text, v_branch, v_staff, v_txn_id, p_key,
    v_reason, jsonb_build_object('from', v_from.id, 'to', v_to.id, 'resident_id', v_res_id));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- Write-off limit: removed by the owner (D-158, supersedes D-108/D-152). No
-- threshold and no approval for uncosted items; write-offs post directly and
-- stay visible in the movement report and audit log. Kept as a hook so a
-- limit can return without touching inv_post_write_off.
create or replace function public.fn_inv_writeoff_problem(p_branch_id bigint, p_lines jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  return null;
end $$;

-- ----------------------------------------------------------------------------
-- inv_post_write_off (tier STAFF; value at WAC ≤ branch threshold, D-108, Q-7)
-- payload: {location_id, resident_id? (TRANSIT only), txn_date, performed_by_staff,
--   reason_code: DAMAGED|EXPIRED, remarks?, lines:[{product_id, uom_id, qty}],
--   allow_negative?, sanity_confirmed?}
-- Above the threshold → WRITE_OFF_NEEDS_APPROVAL (becomes an adjustment request).
-- ----------------------------------------------------------------------------
create or replace function public.inv_post_write_off(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_post_write_off';
  v_acc record;
  v_loc record;
  v_branch bigint;
  v_replay jsonb;
  v_code text;
  v_date date := public.fn_inv_jdate(p_payload->'txn_date');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := public.fn_inv_jtext(p_payload->'reason_code');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_resident bigint;
  v_resolved jsonb;
  v_item jsonb;
  v_lines jsonb := '[]';
  v_txn_id bigint;
  v_txns jsonb;
  v_lock jsonb;
  v_value numeric;
  v_limit jsonb;
  v_sanity jsonb;
  v_res_w jsonb;
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
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  v_branch := v_loc.branch_id;
  if not public.fn_inv_can('WRITE_OFF', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, v_date),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('WRITE_OFF')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_reason is null or v_reason not in ('DAMAGED','EXPIRED') then
    return public.fn_inv_err('INVALID_REASON');
  end if;
  if v_remarks is not null and length(v_remarks) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'remarks'));
  end if;
  if v_loc.kind = 'TRANSIT' then
    select r.id into v_resident from public.tbl_residents r where r.id = public.fn_inv_jbigint(p_payload->'resident_id');
    if v_resident is null then
      return public.fn_inv_err('RESIDENT_NOT_FOUND');
    end if;
  end if;
  v_resolved := public.fn_inv_resolve_lines(v_branch, p_payload->'lines', true);
  if v_resolved ? 'error' then
    return public.fn_inv_err(v_resolved->>'error', null, v_resolved);
  end if;
  v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  for v_item in select * from jsonb_array_elements(v_resolved->'items') loop
    v_lines := v_lines || jsonb_build_array(public.fn_inv_line_spec(public.fn_inv_next_id('tbl_inv_txn_lines'),
                 (v_item->>'line_no')::int, v_loc.id, v_loc.kind, v_resident, v_item, -1, 'OUT_WAC'));
  end loop;
  v_txns := jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_type', 'DAMAGED_EXPIRED', 'branch_id', v_branch,
    'txn_date', v_date, 'performed_by_staff', v_staff, 'reason_code', v_reason, 'remarks', v_remarks,
    'sanity_confirmed', public.fn_inv_jbool(p_payload->'sanity_confirmed'), 'lines', v_lines));
  v_sanity := public.fn_inv_plan_qty_sanity(v_txns);
  if v_sanity is not null and not public.fn_inv_jbool(p_payload->'sanity_confirmed') then
    return public.fn_inv_err('SANITY_CONFIRM', 'Please re-check the flagged lines', v_sanity);
  end if;

  -- threshold (D-108, D-152): checked read-only first, then again under the lock plan
  v_limit := public.fn_inv_writeoff_problem(v_branch, v_lines);
  if v_limit is not null then
    return v_limit;
  end if;
  v_lock := public.fn_inv_lock(v_txns, null, null);
  if public.fn_inv_lock_problem(v_lock) is not null then
    return public.fn_inv_finish(public.fn_inv_lock_problem(v_lock));
  end if;
  v_limit := public.fn_inv_writeoff_problem(v_branch, v_lines);
  if v_limit is not null then
    return public.fn_inv_finish(v_limit);
  end if;
  v_value := (select coalesce(sum(round(-(l->>'qty_base')::numeric * coalesce(cp.wac, p.standard_unit_cost), 2)), 0)
                from jsonb_array_elements(v_lines) l
                join public.tbl_inv_products p on p.id = (l->>'product_id')::bigint
                left join public.tbl_inv_cost_pools cp on cp.branch_id = v_branch and cp.product_id = p.id);

  v_res_w := public.fn_inv_lock_and_write(v_txns, null, public.fn_inv_jbool(p_payload->'allow_negative'),
                                          v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;
  v_result := public.fn_inv_ok(jsonb_build_object('txn_id', v_txn_id, 'txn_no', v_res_w->'written'->'txns'->0->>'txn_no',
    'value', v_value, 'negative_stock', v_res_w->'negative'));
  perform public.fn_inv_audit('WRITE_OFF_POSTED', 'txn', v_txn_id::text, v_branch, v_staff, v_txn_id, p_key, v_reason,
    jsonb_build_object('value', v_value));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- Branch transfers (Q-3: dispatch, then receive all-or-nothing; D-31…D-33)
-- ----------------------------------------------------------------------------

-- inv_dispatch_branch_transfer (tier STAFF at the source)
-- payload: {from_location_id (STORE|FLOOR), to_branch_id, txn_date, performed_by_staff,
--   remarks?, lines:[{product_id, uom_id, qty}], allow_negative?, sanity_confirmed?}
create or replace function public.inv_dispatch_branch_transfer(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_dispatch_branch_transfer';
  v_acc record;
  v_from record;
  v_branch bigint;
  v_to_branch record;
  v_to_store bigint;
  v_replay jsonb;
  v_code text;
  v_date date := public.fn_inv_jdate(p_payload->'txn_date');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_from_demo boolean;
  v_resolved jsonb;
  v_item jsonb;
  v_lines jsonb := '[]';
  v_transfer_id bigint;
  v_txn_id bigint;
  v_txns jsonb;
  v_sanity jsonb;
  v_res_w jsonb;
  v_transfer_no text;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_from from public.fn_inv_location_of(public.fn_inv_jbigint(p_payload->'from_location_id'));
  if not found then
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  v_branch := v_from.branch_id;
  if not public.fn_inv_can('BRANCH_DISPATCH', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_from.kind not in ('STORE','FLOOR') then
    return public.fn_inv_err('INVALID_LOCATIONS');                     -- never out of Transit (D-22)
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, v_date),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('BRANCH_DISPATCH')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_remarks is not null and length(v_remarks) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'remarks'));
  end if;
  -- destination: another enabled NUR branch; demo only with demo (D-31, §8.10)
  select b."BranchID", b.is_demo, b."Function", s.is_enabled into v_to_branch
    from public.tbl_branches b left join public.tbl_inv_branch_settings s on s.branch_id = b."BranchID"
   where b."BranchID" = public.fn_inv_jbigint(p_payload->'to_branch_id');
  select b.is_demo into v_from_demo from public.tbl_branches b where b."BranchID" = v_branch;
  if not found or v_to_branch."BranchID" is null or v_to_branch."BranchID" = v_branch
     or v_to_branch."Function" <> 'NUR' or not coalesce(v_to_branch.is_enabled, false)
     or v_to_branch.is_demo <> v_from_demo then
    return public.fn_inv_err('INVALID_DESTINATION');
  end if;
  v_to_store := public.fn_inv_branch_location(v_to_branch."BranchID", 'STORE');
  if v_to_store is null then
    return public.fn_inv_err('INVALID_DESTINATION', 'The destination has no active Store');
  end if;
  v_resolved := public.fn_inv_resolve_lines(v_branch, p_payload->'lines', true);
  if v_resolved ? 'error' then
    return public.fn_inv_err(v_resolved->>'error', null, v_resolved);
  end if;
  if exists (select 1 from jsonb_array_elements(v_resolved->'items') x
              join public.tbl_inv_products p on p.id = (x->>'product_id')::bigint
             where p.owner_branch_id is not null) then
    return public.fn_inv_err('PRODUCT_NOT_AT_DESTINATION');
  end if;

  v_transfer_id := public.fn_inv_next_id('tbl_inv_branch_transfers');
  v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  for v_item in select * from jsonb_array_elements(v_resolved->'items') loop
    v_lines := v_lines || jsonb_build_array(public.fn_inv_line_spec(public.fn_inv_next_id('tbl_inv_txn_lines'),
                 (v_item->>'line_no')::int, v_from.id, v_from.kind, null, v_item, -1, 'OUT_WAC'));
  end loop;
  v_txns := jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_type', 'BRANCH_TRANSFER_OUT', 'branch_id', v_branch,
    'txn_date', v_date, 'performed_by_staff', v_staff, 'remarks', v_remarks,
    'sanity_confirmed', public.fn_inv_jbool(p_payload->'sanity_confirmed'),
    'source_doc_type', 'BRANCH_TRANSFER', 'source_doc_id', v_transfer_id, 'lines', v_lines));
  v_sanity := public.fn_inv_plan_qty_sanity(v_txns);
  if v_sanity is not null and not public.fn_inv_jbool(p_payload->'sanity_confirmed') then
    return public.fn_inv_err('SANITY_CONFIRM', 'Please re-check the flagged lines', v_sanity);
  end if;

  v_res_w := public.fn_inv_lock_and_write(v_txns, jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'doc_type', 'TRF')),
                                          public.fn_inv_jbool(p_payload->'allow_negative'), v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;
  v_transfer_no := public.fn_inv_next_no(v_branch, 'TRF');
  insert into public.tbl_inv_branch_transfers (id, transfer_no, from_branch_id, from_location_id, to_branch_id,
    to_location_id, status, dispatch_txn_id, dispatched_by_staff, remarks, created_by_account)
  values (v_transfer_id, v_transfer_no, v_branch, v_from.id, v_to_branch."BranchID", v_to_store, 'DISPATCHED',
    v_txn_id, v_staff, v_remarks, v_acc.account_id);
  insert into public.tbl_inv_branch_transfer_lines (transfer_id, branch_id, line_no, product_id, qty_base, unit_cost,
    value, out_line_id)
  select v_transfer_id, v_branch, l.line_no, l.product_id, -l.qty_base, l.unit_cost, -l.value, l.id
    from public.tbl_inv_txn_lines l where l.txn_id = v_txn_id order by l.line_no;

  v_result := public.fn_inv_ok(jsonb_build_object('transfer_id', v_transfer_id, 'transfer_no', v_transfer_no,
    'txn_id', v_txn_id, 'negative_stock', v_res_w->'negative'));
  perform public.fn_inv_audit('BRANCH_TRANSFER_DISPATCHED', 'branch_transfer', v_transfer_id::text, v_branch, v_staff,
    v_txn_id, p_key, null, jsonb_build_object('transfer_no', v_transfer_no, 'to_branch_id', v_to_branch."BranchID"));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- inv_receive_branch_transfer (tier STAFF at the destination; the full dispatched
-- qty at the dispatched cost, into the destination STORE; D-33, D-54)
-- payload: {transfer_id, txn_date, performed_by_staff, remarks?}
create or replace function public.inv_receive_branch_transfer(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_receive_branch_transfer';
  v_acc record;
  v_tr record;
  v_replay jsonb;
  v_code text;
  v_date date := public.fn_inv_jdate(p_payload->'txn_date');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_dispatch_date date;
  v_lines jsonb := '[]';
  v_txn_id bigint;
  v_txns jsonb;
  v_res_w jsonb;
  v_result jsonb;
  x record;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_tr from public.tbl_inv_branch_transfers t where t.id = public.fn_inv_jbigint(p_payload->'transfer_id');
  if not found then
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  if not public.fn_inv_can('BRANCH_RECEIVE', v_tr.to_branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_tr.to_branch_id, v_date),
                     public.fn_inv_check_staff(v_staff, v_tr.to_branch_id, public.fn_inv_needs_senior_staff('BRANCH_RECEIVE')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_remarks is not null and length(v_remarks) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'remarks'));
  end if;
  -- document lock first (D-111 step 1), then re-read the state
  select * into v_tr from public.tbl_inv_branch_transfers t where t.id = v_tr.id for update;
  if v_tr.status <> 'DISPATCHED' then
    return public.fn_inv_err('TRANSFER_NOT_DISPATCHED');
  end if;
  select t.txn_date into v_dispatch_date from public.tbl_inv_txns t where t.id = v_tr.dispatch_txn_id;
  if v_date < v_dispatch_date then
    return public.fn_inv_err('DATE_BEFORE_DISPATCH');
  end if;

  v_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  for x in
    select tl.line_no, tl.product_id, tl.qty_base, tl.value, tl.out_line_id, p.base_uom_id, u.code as base_uom_code
      from public.tbl_inv_branch_transfer_lines tl
      join public.tbl_inv_products p on p.id = tl.product_id
      join public.tbl_inv_uoms u on u.id = p.base_uom_id
     where tl.transfer_id = v_tr.id order by tl.line_no
  loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('id', public.fn_inv_next_id('tbl_inv_txn_lines'),
      'line_no', x.line_no, 'location_id', v_tr.to_location_id, 'location_kind', 'STORE', 'product_id', x.product_id,
      'qty_base', x.qty_base, 'uom_id', x.base_uom_id, 'uom_code', x.base_uom_code, 'qty_entered', x.qty_base,
      'factor', 1, 'mode', 'IN_SPEC', 'value', x.value, 'cost_source', 'TRANSFER', 'source_line_id', x.out_line_id));
  end loop;
  v_txns := jsonb_build_array(jsonb_build_object('id', v_txn_id, 'txn_type', 'BRANCH_TRANSFER_IN',
    'branch_id', v_tr.to_branch_id, 'txn_date', v_date, 'performed_by_staff', v_staff, 'remarks', v_remarks,
    'source_doc_type', 'BRANCH_TRANSFER', 'source_doc_id', v_tr.id, 'lines', v_lines));
  v_res_w := public.fn_inv_lock_and_write(v_txns, null, false, v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;
  insert into public.tbl_inv_branch_transfer_receipts (transfer_id, branch_id, receive_txn_id, received_by_staff)
  values (v_tr.id, v_tr.to_branch_id, v_txn_id, v_staff);
  update public.tbl_inv_branch_transfers t set status = 'RECEIVED', updated_at = now() where t.id = v_tr.id;

  v_result := public.fn_inv_ok(jsonb_build_object('transfer_id', v_tr.id, 'txn_id', v_txn_id,
    'txn_no', v_res_w->'written'->'txns'->0->>'txn_no'));
  perform public.fn_inv_audit('BRANCH_TRANSFER_RECEIVED', 'branch_transfer', v_tr.id::text, v_tr.to_branch_id, v_staff,
    v_txn_id, p_key, null, jsonb_build_object('transfer_no', v_tr.transfer_no));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- inv_cancel_branch_transfer (tier HEAD_NURSE at the source, D-32): reverses
-- the dispatch while it is still DISPATCHED.
-- payload: {transfer_id, txn_date?, performed_by_staff, reason_code, remarks?}
create or replace function public.inv_cancel_branch_transfer(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_cancel_branch_transfer';
  v_acc record;
  v_tr record;
  v_replay jsonb;
  v_code text;
  v_date date := coalesce(public.fn_inv_jdate(p_payload->'txn_date'), public.fn_inv_today());
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := coalesce(public.fn_inv_jtext(p_payload->'reason_code'), 'OTHER');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_rev jsonb;
  v_res_w jsonb;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_tr from public.tbl_inv_branch_transfers t where t.id = public.fn_inv_jbigint(p_payload->'transfer_id');
  if not found then
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  if not public.fn_inv_can('BRANCH_CANCEL', v_tr.from_branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_tr.from_branch_id, v_date),
                     public.fn_inv_check_staff(v_staff, v_tr.from_branch_id, public.fn_inv_needs_senior_staff('BRANCH_CANCEL')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_reason not in ('DATA_ENTRY','WRONG_PRODUCT','WRONG_QTY','OTHER')
     or (v_remarks is not null and length(v_remarks) > 500) then
    return public.fn_inv_err('INVALID_REASON');
  end if;
  select * into v_tr from public.tbl_inv_branch_transfers t where t.id = v_tr.id for update;
  perform 1 from public.tbl_inv_txns t where t.id = v_tr.dispatch_txn_id for update;
  if v_tr.status <> 'DISPATCHED' then
    return public.fn_inv_err('TRANSFER_NOT_CANCELLABLE');
  end if;
  if v_date < (select t.txn_date from public.tbl_inv_txns t where t.id = v_tr.dispatch_txn_id) then
    return public.fn_inv_err('DATE_BEFORE_ORIGINAL');
  end if;
  v_rev := public.fn_inv_build_reversal(v_tr.dispatch_txn_id, v_date, v_staff, v_reason, v_remarks, null);
  v_res_w := public.fn_inv_lock_and_write(jsonb_build_array(v_rev), null, true, v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;
  update public.tbl_inv_branch_transfers t
     set status = 'CANCELLED', cancel_txn_id = (v_rev->>'id')::bigint, updated_at = now()
   where t.id = v_tr.id;
  v_result := public.fn_inv_ok(jsonb_build_object('transfer_id', v_tr.id, 'cancel_txn_id', (v_rev->>'id')::bigint));
  perform public.fn_inv_audit('BRANCH_TRANSFER_CANCELLED', 'branch_transfer', v_tr.id::text, v_tr.from_branch_id, v_staff,
    (v_rev->>'id')::bigint, p_key, v_reason, jsonb_build_object('transfer_no', v_tr.transfer_no));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- Grants: schema/013_inventory_grants.sql (re-run after every inventory migration, audit P1-17).

-- Nothing this file created is reachable through the API until 013 (audit V-1).
select public.fn_inv_lockdown();

commit;
