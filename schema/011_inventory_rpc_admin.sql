-- ============================================================================
-- 011 — General Inventory: reversal / correction, service charges, periods
-- ============================================================================
-- inv_reverse_txn          REVERSAL of any posted txn (MOD/ADMIN; D-56, D-124, D-130)
-- inv_correct_receipt      netted receipt correction (MOD/ADMIN; D-103, audit F2)
-- inv_charge_service       non-stock Service charge (D-137)
-- inv_reverse_charge       reversal of a Service charge (MOD/ADMIN)
-- inv_mark_exceptions_reviewed / inv_lock_period / inv_reopen_period (D-74, D-116, D-145)
-- inv_verify_balances      cache drift report (ADMIN)
-- Same RPC contract as 010.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Reversal building blocks
-- ----------------------------------------------------------------------------

-- A REVERSAL txn spec mirroring every line of p_orig_txn_id (value −orig,
-- cost source ORIGINAL; internal legs stay pool-neutral; pairs re-paired).
create or replace function public.fn_inv_build_reversal(p_orig_txn_id bigint, p_date date, p_staff text,
  p_reason text, p_remarks text, p_cascade_of bigint)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  t record;
  l record;
  v_map jsonb := '{}';
  v_lines jsonb := '[]';
  v_internal boolean;
begin
  select * into t from public.tbl_inv_txns x where x.id = p_orig_txn_id;
  v_internal := t.txn_type in ('INTERNAL_TRANSFER','TRANSIT_ALLOCATE','TRANSIT_RELEASE');
  for l in select * from public.tbl_inv_txn_lines x where x.txn_id = p_orig_txn_id order by x.line_no loop
    v_map := v_map || jsonb_build_object(l.id::text, public.fn_inv_next_id('tbl_inv_txn_lines'));
  end loop;
  for l in select * from public.tbl_inv_txn_lines x where x.txn_id = p_orig_txn_id order by x.line_no loop
    v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', (v_map->>(l.id::text))::bigint, 'line_no', l.line_no, 'location_id', l.location_id,
      'location_kind', l.location_kind, 'resident_id', l.resident_id, 'product_id', l.product_id,
      'qty_base', -l.qty_base, 'uom_id', l.uom_id, 'uom_code', l.uom_code, 'qty_entered', l.qty_entered,
      'factor', l.factor_to_base,
      'mode', case when v_internal then 'INT_FIXED' when l.qty_base > 0 then 'OUT_SPEC' else 'IN_SPEC' end,
      'value', -l.value, 'cost_source', 'ORIGINAL',
      'pair_line_id', (v_map->>(l.pair_line_id::text))::bigint, 'source_line_id', l.id)));
  end loop;
  return jsonb_strip_nulls(jsonb_build_object('id', public.fn_inv_next_id('tbl_inv_txns'), 'txn_type', 'REVERSAL',
    'branch_id', t.branch_id, 'txn_date', p_date, 'performed_by_staff', p_staff, 'reason_code', p_reason,
    'remarks', p_remarks, 'reverses_txn_id', t.id, 'cascade_of_txn_id', p_cascade_of,
    'source_doc_type', t.source_doc_type, 'source_doc_id', t.source_doc_id, 'lines', v_lines));
end $$;

-- REVERSAL charges for every charge of a reversed txn, plus any PRICING child
-- at the same amount (§4.4). Credits land in the reversal's (open) period (D-73).
create or replace function public.fn_inv_reverse_txn_charges(p_orig_txn_id bigint, p_rev_txn_id bigint, p_staff text,
  p_account_id bigint, p_key uuid, p_reason text)
returns int language plpgsql volatile set search_path = '' as $$
declare
  v_n int;
  v_m int;
begin
  insert into public.tbl_inv_charges (branch_id, billing_period_id, charge_date, charge_kind, target, resident_id,
    expense_note, txn_id, txn_line_id, related_charge_id, product_id, product_name, sku, uom_code, qty_base,
    unit_charge_price, charge_amount, cost_amount, reason, request_key, created_by_account, created_by_staff)
  select rt.branch_id, rt.billing_period_id, rt.txn_date, 'REVERSAL', c.target, c.resident_id, c.expense_note,
         rt.id, rl.id, c.id, c.product_id, c.product_name, c.sku, c.uom_code, -c.qty_base, c.unit_charge_price,
         -c.charge_amount, -c.cost_amount, p_reason, p_key, p_account_id, p_staff
    from public.tbl_inv_charges c
    join public.tbl_inv_txns rt on rt.id = p_rev_txn_id
    join public.tbl_inv_txn_lines rl on rl.txn_id = rt.id and rl.source_line_id = c.txn_line_id
   where c.txn_id = p_orig_txn_id and c.charge_kind in ('ISSUE','RETURN_CREDIT')
     and not exists (select 1 from public.tbl_inv_charges r where r.related_charge_id = c.id and r.charge_kind = 'REVERSAL');
  get diagnostics v_n = row_count;

  insert into public.tbl_inv_charges (branch_id, billing_period_id, charge_date, charge_kind, target, resident_id,
    expense_note, related_charge_id, product_id, product_name, sku, uom_code, qty_base, unit_charge_price,
    charge_amount, cost_amount, reason, request_key, created_by_account, created_by_staff)
  select rt.branch_id, rt.billing_period_id, rt.txn_date, 'REVERSAL', pc.target, pc.resident_id, pc.expense_note,
         pc.id, pc.product_id, pc.product_name, pc.sku, pc.uom_code, 0, pc.unit_charge_price,
         -pc.charge_amount, 0, p_reason, p_key, p_account_id, p_staff
    from public.tbl_inv_charges pc
    join public.tbl_inv_charges c on c.id = pc.related_charge_id and c.txn_id = p_orig_txn_id
    join public.tbl_inv_txns rt on rt.id = p_rev_txn_id
   where pc.charge_kind = 'PRICING'
     and not exists (select 1 from public.tbl_inv_charges r where r.related_charge_id = pc.id and r.charge_kind = 'REVERSAL');
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;

-- ----------------------------------------------------------------------------
-- inv_reverse_txn (tier MODERATOR; OPENING_BALANCE needs ADMIN)
-- payload: {txn_id, txn_date? (default today; must be an open period),
--   performed_by_staff, reason_code, remarks?, allow_negative?}
-- RECEIPT reversal voids the receipt and first reverses its receive-&-allocate
-- txns (cascade, D-124): if that stock was already issued, released or written off
-- → TRANSIT_STOCK_USED.
-- BRANCH_TRANSFER_OUT: use inv_cancel_branch_transfer. BRANCH_TRANSFER_IN:
-- the transfer goes back to DISPATCHED.
-- ----------------------------------------------------------------------------
create or replace function public.inv_reverse_txn(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_reverse_txn';
  v_acc record;
  v_orig record;
  v_replay jsonb;
  v_code text;
  v_date date := coalesce(public.fn_inv_jdate(p_payload->'txn_date'), public.fn_inv_today());
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := public.fn_inv_jtext(p_payload->'reason_code');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_transfer_id bigint;          -- scalars, not records: a record read before it is
  v_transfer_status text;        -- assigned fails on a fresh connection (audit P1-1)
  v_cascade record;
  v_txns jsonb := '[]';
  v_rev jsonb;
  v_res_w jsonb;
  v_charges int;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_orig from public.tbl_inv_txns t where t.id = public.fn_inv_jbigint(p_payload->'txn_id');
  if not found then
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  if not public.fn_inv_can(case when v_orig.txn_type = 'OPENING_BALANCE' then 'REVERSE_OPENING' else 'REVERSE' end,
                           v_orig.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_orig.branch_id, v_date),
                     public.fn_inv_check_staff(v_staff, v_orig.branch_id, public.fn_inv_needs_senior_staff('REVERSE')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_reason is null or v_reason not in ('DATA_ENTRY','WRONG_RESIDENT','WRONG_PRODUCT','WRONG_QTY','WRONG_COST','OTHER')
     or (v_remarks is not null and length(v_remarks) > 500) then
    return public.fn_inv_err('INVALID_REASON');
  end if;
  if v_orig.txn_type = 'REVERSAL' then
    return public.fn_inv_err('CANNOT_REVERSE_REVERSAL');
  end if;
  if v_date < v_orig.txn_date then
    return public.fn_inv_err('DATE_BEFORE_ORIGINAL');
  end if;
  if v_orig.txn_type = 'BRANCH_TRANSFER_OUT' then
    return public.fn_inv_err('USE_CANCEL_TRANSFER');
  end if;

  -- document locks, sorted by (table, id) (D-111 step 1)
  if v_orig.txn_type = 'BRANCH_TRANSFER_IN' then
    select t.id, t.status into v_transfer_id, v_transfer_status
      from public.tbl_inv_branch_transfers t where t.id = v_orig.source_doc_id for update;
  end if;
  if v_orig.txn_type = 'RECEIPT' then
    perform 1 from public.tbl_inv_receipts r where r.id = v_orig.source_doc_id for update;
  end if;
  perform 1 from public.tbl_inv_txns t
   where t.id = v_orig.id
      or (v_orig.txn_type = 'RECEIPT' and t.source_doc_type = 'RECEIPT' and t.source_doc_id = v_orig.source_doc_id
          and t.txn_type = 'TRANSIT_ALLOCATE')
   order by t.id for update;
  if exists (select 1 from public.tbl_inv_txns r where r.reverses_txn_id = v_orig.id) then
    return public.fn_inv_err('ALREADY_REVERSED');
  end if;
  if v_orig.txn_type = 'BRANCH_TRANSFER_IN' then
    if v_transfer_status is distinct from 'RECEIVED' or not exists (
         select 1 from public.tbl_inv_branch_transfer_receipts x where x.transfer_id = v_transfer_id
            and x.receive_txn_id = v_orig.id) then
      return public.fn_inv_err('TRANSFER_STATE_MISMATCH');
    end if;
  end if;

  -- cascade: receive-&-allocate txns of this receipt that are still standing
  if v_orig.txn_type = 'RECEIPT' then
    for v_cascade in
      select t.id from public.tbl_inv_txns t
       where t.source_doc_type = 'RECEIPT' and t.source_doc_id = v_orig.source_doc_id and t.txn_type = 'TRANSIT_ALLOCATE'
         and not exists (select 1 from public.tbl_inv_txns r where r.reverses_txn_id = t.id)
       order by t.id
    loop
      v_txns := v_txns || jsonb_build_array(
        public.fn_inv_build_reversal(v_cascade.id, v_date, v_staff, v_reason, v_remarks, v_orig.id));
    end loop;
  end if;
  v_rev := public.fn_inv_build_reversal(v_orig.id, v_date, v_staff, v_reason, v_remarks, null);
  v_txns := v_txns || jsonb_build_array(v_rev);

  v_res_w := public.fn_inv_lock_and_write(v_txns, null, public.fn_inv_jbool(p_payload->'allow_negative'),
               v_acc.account_id, p_key,
               case when v_orig.txn_type = 'RECEIPT' then 'TRANSIT_STOCK_USED' else 'TRANSIT_NEGATIVE' end);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;

  if v_orig.txn_type = 'RECEIPT' then
    update public.tbl_inv_receipts r set is_voided = true, voided_by_txn_id = (v_rev->>'id')::bigint
     where r.id = v_orig.source_doc_id;
  elsif v_orig.txn_type = 'BRANCH_TRANSFER_IN' then
    update public.tbl_inv_branch_transfers t set status = 'DISPATCHED', updated_at = now() where t.id = v_transfer_id;
  end if;
  v_charges := public.fn_inv_reverse_txn_charges(v_orig.id, (v_rev->>'id')::bigint, v_staff, v_acc.account_id, p_key,
                                                 coalesce(v_reason || ': ' || v_remarks, v_reason));

  v_result := public.fn_inv_ok(jsonb_build_object('reversal_txn_id', (v_rev->>'id')::bigint,
    'txns', v_res_w->'written'->'txns', 'reversed_charges', v_charges, 'negative_stock', v_res_w->'negative'));
  perform public.fn_inv_audit('TXN_REVERSED', 'txn', v_orig.id::text, v_orig.branch_id, v_staff,
    (v_rev->>'id')::bigint, p_key, v_reason, jsonb_build_object('txn_no', v_orig.txn_no, 'remarks', v_remarks));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_correct_receipt (tier MODERATOR) — D-103 netted correction.
-- Writes the REVERSAL of the original receipt txn and a new RECEIPT txn (with
-- correction_of_txn_id), but applies ONE net change per cost pool:
--   quantity part  dq = q1 − q0 at c1 (dq > 0) or c0 (dq < 0)
--   cost part      Δ = min(q0,q1)·(c1 − c0); share = min(1, Q_now / pool_qty_after_of_original_line)
--                  share·Δ goes into stock value, the rest is consumed-cost variance (revaluation)
-- The negative-stock check runs on the net bucket change.
-- payload: {receipt_id, txn_date? (reversal date, default today), performed_by_staff,
--   reason_code, remarks?, receipt:{supplier_id, doc_type, invoice_no, invoice_date,
--   discount_total, tax_total, other_charges_total, rounding_adj, remarks,
--   lines:[{product_id, uom_id, qty, foc_qty, unit_cost}]}, allow_negative?, sanity_confirmed?}
-- A receipt with receive-&-allocate lines cannot be corrected: reverse it and re-enter (D-142).
-- ----------------------------------------------------------------------------
create or replace function public.inv_correct_receipt(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_correct_receipt';
  v_acc record;
  v_old record;
  v_orig_txn record;
  v_replay jsonb;
  v_code text;
  v_rev_date date := coalesce(public.fn_inv_jdate(p_payload->'txn_date'), public.fn_inv_today());
  v_new_date date;
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := public.fn_inv_jtext(p_payload->'reason_code');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_body jsonb;
  v_new_receipt_id bigint;
  v_rev_txn_id bigint;
  v_new_txn_id bigint;
  v_line_ids jsonb := '{}';
  v_rev_lines jsonb := '[]';
  v_new_lines jsonb := '[]';
  v_txns jsonb;
  v_lock jsonb;
  v_check jsonb;
  v_sanity jsonb;
  v_written jsonb;
  v_receipt_no text;
  v_result jsonb;
  pr record;
  o record;
  n jsonb;
  v_q numeric; v_v numeric; v_w numeric;
  v_share numeric; v_delta numeric; v_in_stock numeric;
  v_va numeric; v_wa numeric;
  v_dq numeric; v_pv numeric;
  v_step record;
  v_target_v numeric; v_target_w numeric;
  v_reval numeric;
  v_id bigint;
  v_rev_id bigint;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'receipt') <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_old from public.tbl_inv_receipts r where r.id = public.fn_inv_jbigint(p_payload->'receipt_id');
  if not found then
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  if not public.fn_inv_can('CORRECT', v_old.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_old.branch_id, v_rev_date),
                     public.fn_inv_check_staff(v_staff, v_old.branch_id, public.fn_inv_needs_senior_staff('CORRECT')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_reason is null or v_reason not in ('DATA_ENTRY','WRONG_PRODUCT','WRONG_QTY','WRONG_COST','OTHER')
     or (v_remarks is not null and length(v_remarks) > 500) then
    return public.fn_inv_err('INVALID_REASON');
  end if;

  -- document locks (receipts < txns)
  select * into v_old from public.tbl_inv_receipts r where r.id = v_old.id for update;
  select * into v_orig_txn from public.tbl_inv_txns t where t.id = v_old.txn_id for update;
  if v_old.is_voided or exists (select 1 from public.tbl_inv_txns x where x.reverses_txn_id = v_orig_txn.id) then
    return public.fn_inv_err('RECEIPT_VOIDED');
  end if;
  if v_rev_date < v_old.received_date then
    return public.fn_inv_err('DATE_BEFORE_ORIGINAL');
  end if;
  if exists (select 1 from public.tbl_inv_receipt_lines rl where rl.receipt_id = v_old.id and rl.allocate_resident_id is not null) then
    return public.fn_inv_err('RECEIPT_HAS_ALLOCATION', 'Reverse the receipt and enter it again');
  end if;
  if exists (select 1 from jsonb_array_elements(p_payload->'receipt'->'lines') x
              where x ? 'allocate_resident_id' and jsonb_typeof(x->'allocate_resident_id') <> 'null') then
    return public.fn_inv_err('INVALID_PAYLOAD', 'A correction cannot allocate to Transit');
  end if;
  v_body := public.fn_inv_build_receipt_body(v_old.branch_id, p_payload->'receipt');
  if v_body ? 'error' then
    return public.fn_inv_err(v_body->>'error', null, v_body);
  end if;
  if exists (select 1 from public.tbl_inv_receipts r
              where r.supplier_id = (v_body->>'supplier_id')::bigint and not r.is_voided and r.id <> v_old.id
                and r.invoice_key = upper(regexp_replace(v_body->>'invoice_no', '[^A-Za-z0-9]', '', 'g'))) then
    return public.fn_inv_err('DUPLICATE_INVOICE');
  end if;
  -- D-130: the corrected receipt keeps its original date while that month is open
  v_new_date := case when exists (select 1 from public.tbl_inv_billing_periods p
                                   where p.branch_id = v_old.branch_id and p.status = 'LOCKED'
                                     and p.period_month = date_trunc('month', v_old.received_date)::date)
                     then v_rev_date else v_old.received_date end;

  -- plan (quantities only; values are set after the pools are locked)
  v_new_receipt_id := public.fn_inv_next_id('tbl_inv_receipts');
  v_rev_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  v_new_txn_id := public.fn_inv_next_id('tbl_inv_txns');
  for o in select * from public.tbl_inv_txn_lines l where l.txn_id = v_orig_txn.id order by l.line_no loop
    v_rev_lines := v_rev_lines || jsonb_build_array(jsonb_build_object('id', public.fn_inv_next_id('tbl_inv_txn_lines'),
      'line_no', o.line_no, 'location_id', o.location_id, 'location_kind', o.location_kind, 'product_id', o.product_id,
      'qty_base', -o.qty_base, 'uom_id', o.uom_id, 'uom_code', o.uom_code, 'qty_entered', o.qty_entered,
      'factor', o.factor_to_base, 'mode', 'FIXED', 'value', -o.value, 'reval', 0, 'cost_source', 'ORIGINAL',
      'source_line_id', o.id, 'orig_pool_qty_after', o.pool_qty_after));
  end loop;
  for n in select * from jsonb_array_elements(v_body->'lines') loop
    v_id := public.fn_inv_next_id('tbl_inv_txn_lines');
    v_line_ids := v_line_ids || jsonb_build_object(n->>'line_no', v_id);
    v_new_lines := v_new_lines || jsonb_build_array(public.fn_inv_line_spec(v_id, (n->>'line_no')::int,
      v_old.location_id, 'STORE', null, n, 1, 'FIXED', (n->>'landed_value')::numeric, 'LANDED'));
  end loop;
  v_txns := jsonb_build_array(
    jsonb_build_object('id', v_rev_txn_id, 'txn_type', 'REVERSAL', 'branch_id', v_old.branch_id, 'txn_date', v_rev_date,
      'performed_by_staff', v_staff, 'reason_code', v_reason, 'remarks', v_remarks, 'reverses_txn_id', v_orig_txn.id,
      'source_doc_type', 'RECEIPT', 'source_doc_id', v_old.id, 'lines', v_rev_lines),
    jsonb_build_object('id', v_new_txn_id, 'txn_type', 'RECEIPT', 'branch_id', v_old.branch_id, 'txn_date', v_new_date,
      'performed_by_staff', v_staff, 'reason_code', v_reason, 'remarks', v_body->>'remarks',
      'correction_of_txn_id', v_orig_txn.id, 'sanity_confirmed', public.fn_inv_jbool(p_payload->'sanity_confirmed'),
      'source_doc_type', 'RECEIPT', 'source_doc_id', v_new_receipt_id, 'lines', v_new_lines));

  -- read-only pre-checks: a rejected call inserts nothing (audit P1-13)
  if public.fn_inv_state_problem(v_txns) is not null then
    return public.fn_inv_state_problem(v_txns);
  end if;
  v_sanity := public.fn_inv_receipt_sanity(v_old.branch_id, v_old.location_id, v_body->'lines');
  if v_sanity is not null and not public.fn_inv_jbool(p_payload->'sanity_confirmed') then
    return public.fn_inv_err('SANITY_CONFIRM', 'Please re-check the flagged lines', v_sanity);
  end if;
  v_check := public.fn_inv_check_buckets(v_txns, public.fn_inv_jbool(p_payload->'allow_negative'));
  if v_check->>'code' is not null then
    return public.fn_inv_err(v_check->>'code', 'Stock would go below zero; confirm to continue', v_check->'buckets');
  end if;
  v_lock := public.fn_inv_lock(v_txns, null,
              jsonb_build_array(jsonb_build_object('branch_id', v_old.branch_id, 'doc_type', 'RCV')));
  if public.fn_inv_lock_problem(v_lock) is not null then
    return public.fn_inv_finish(public.fn_inv_lock_problem(v_lock));
  end if;
  v_check := public.fn_inv_check_buckets(v_txns, public.fn_inv_jbool(p_payload->'allow_negative'));
  if v_check->>'code' is not null then
    return public.fn_inv_finish(public.fn_inv_err(v_check->>'code', 'Stock would go below zero; confirm to continue',
                                                  v_check->'buckets'));
  end if;

  -- D-103: one net pool change per product, split into lines' value + revaluation
  for pr in
    select p.product_id,
           coalesce((select sum(-(x->>'qty_base')::numeric) from jsonb_array_elements(v_rev_lines) x
                      where (x->>'product_id')::bigint = p.product_id), 0) as q0,
           coalesce((select sum(-(x->>'value')::numeric) from jsonb_array_elements(v_rev_lines) x
                      where (x->>'product_id')::bigint = p.product_id), 0) as v0,
           (select max((x->>'orig_pool_qty_after')::numeric) from jsonb_array_elements(v_rev_lines) x
             where (x->>'product_id')::bigint = p.product_id) as pqa0,
           coalesce((select sum((x->>'qty_base')::numeric) from jsonb_array_elements(v_new_lines) x
                      where (x->>'product_id')::bigint = p.product_id), 0) as q1,
           coalesce((select sum((x->>'value')::numeric) from jsonb_array_elements(v_new_lines) x
                      where (x->>'product_id')::bigint = p.product_id), 0) as v1
      from (select distinct (x->>'product_id')::bigint as product_id
              from jsonb_array_elements(v_rev_lines || v_new_lines) x) p
     order by p.product_id
  loop
    select cp.qty, cp.value, cp.wac into v_q, v_v, v_w from public.tbl_inv_cost_pools cp
     where cp.branch_id = v_old.branch_id and cp.product_id = pr.product_id;
    -- cost part
    v_va := v_v;
    v_wa := v_w;
    if pr.q0 > 0 and pr.q1 > 0 then
      v_delta := round(least(pr.q0, pr.q1) * (pr.v1 / pr.q1 - pr.v0 / pr.q0), 4);
      v_share := case when coalesce(pr.pqa0, 0) > 0 then least(1, greatest(0, v_q / pr.pqa0)) else 0 end;
      v_in_stock := round(v_share * v_delta, 4);
      v_va := v_v + v_in_stock;
      v_wa := case when v_q > 0 then round(v_va / v_q, 6) else v_w end;
    end if;
    -- quantity part
    v_dq := pr.q1 - pr.q0;
    if v_dq > 0 then
      v_pv := case when pr.q0 = 0 then pr.v1 else round(v_dq * pr.v1 / pr.q1, 4) end;
      select * into v_step from public.fn_inv_pool_in(v_q, v_va, v_wa, v_dq, v_pv);
      v_target_v := v_step.v; v_target_w := v_step.w;
    elsif v_dq < 0 then
      v_pv := case when pr.q1 = 0 then -pr.v0 else -round(-v_dq * pr.v0 / pr.q0, 4) end;
      select * into v_step from public.fn_inv_pool_out_spec(v_q, v_va, v_wa, v_dq, v_pv);
      v_target_v := v_step.v; v_target_w := v_step.w;
    else
      v_target_v := v_va; v_target_w := v_wa;
    end if;
    v_reval := (v_target_v - v_v) - (pr.v1 - pr.v0);

    -- the pool's last line in this call carries the revaluation and the final WAC
    if pr.q1 > 0 then
      select jsonb_agg(case when (x->>'product_id')::bigint = pr.product_id
                            then x || jsonb_build_object('reval', v_reval, 'w_after', v_target_w) else x end
                       order by (x->>'line_no')::int)
        into v_new_lines from jsonb_array_elements(v_new_lines) x;
    else
      select jsonb_agg(case when (x->>'product_id')::bigint = pr.product_id
                            then x || jsonb_build_object('reval', v_reval, 'w_after', v_target_w) else x end
                       order by (x->>'line_no')::int)
        into v_rev_lines from jsonb_array_elements(v_rev_lines) x;
    end if;
  end loop;
  v_txns := jsonb_set(jsonb_set(v_txns, '{0,lines}', v_rev_lines), '{1,lines}', v_new_lines);
  if (v_check->>'negative')::boolean then
    select jsonb_agg(t || jsonb_build_object('negative_stock_confirmed', true)) into v_txns
      from jsonb_array_elements(v_txns) t;
  end if;
  v_written := public.fn_inv_write_txns(v_txns, v_acc.account_id, p_key);

  update public.tbl_inv_receipts r
     set is_voided = true, voided_by_txn_id = v_rev_txn_id, superseded_by_receipt_id = v_new_receipt_id
   where r.id = v_old.id;
  v_receipt_no := public.fn_inv_next_no(v_old.branch_id, 'RCV');
  insert into public.tbl_inv_receipts (id, receipt_no, branch_id, location_id, supplier_id, supplier_name, doc_type,
    invoice_no, invoice_date, received_date, received_by_staff, item_count, lines_total, discount_total, tax_total,
    other_charges_total, rounding_adj, landed_total, invoice_total_paper, txn_id, corrects_receipt_id, remarks,
    created_by_account)
  values (v_new_receipt_id, v_receipt_no, v_old.branch_id, v_old.location_id, (v_body->>'supplier_id')::bigint,
    v_body->>'supplier_name', v_body->>'doc_type', v_body->>'invoice_no', (v_body->>'invoice_date')::date, v_new_date,
    v_old.received_by_staff, jsonb_array_length(v_body->'lines'), (v_body->>'lines_total')::numeric,
    (v_body->>'discount_total')::numeric, (v_body->>'tax_total')::numeric, (v_body->>'other_charges_total')::numeric,
    (v_body->>'rounding_adj')::numeric, (v_body->>'landed_total')::numeric, (v_body->>'invoice_total_paper')::numeric,
    v_new_txn_id, v_old.id, v_body->>'remarks',
    v_acc.account_id);
  insert into public.tbl_inv_receipt_lines (receipt_id, branch_id, line_no, product_id, product_name, uom_id,
    factor_to_base, qty_entered, foc_qty, qty_base, unit_cost_entered, line_total, landed_value, txn_line_id)
  select v_new_receipt_id, v_old.branch_id, (x->>'line_no')::smallint, (x->>'product_id')::bigint, x->>'product_name',
         (x->>'uom_id')::bigint, (x->>'factor')::numeric, (x->>'qty_paid')::numeric, (x->>'foc_qty')::numeric,
         (x->>'qty_base')::numeric, (x->>'unit_cost_entered')::numeric, (x->>'line_total')::numeric,
         (x->>'landed_value')::numeric, (v_line_ids->>(x->>'line_no'))::bigint
    from jsonb_array_elements(v_body->'lines') x;

  v_result := public.fn_inv_ok(jsonb_build_object('receipt_id', v_new_receipt_id, 'receipt_no', v_receipt_no,
    'reversal_txn_id', v_rev_txn_id, 'txn_id', v_new_txn_id, 'txns', v_written->'txns',
    'negative_stock', v_check->'negative'));
  perform public.fn_inv_audit('RECEIPT_CORRECTED', 'receipt', v_old.id::text, v_old.branch_id, v_staff, v_new_txn_id, p_key,
    v_reason, jsonb_build_object('new_receipt_id', v_new_receipt_id, 'receipt_no', v_receipt_no, 'remarks', v_remarks),
    jsonb_build_object('receipt_no', v_old.receipt_no, 'landed_total', v_old.landed_total));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_charge_service (tier STAFF) — D-137: a Service product is charged with
-- no ledger movement, no balance and no WAC. Price frozen at posting (Q-31);
-- no price → PRICE_PENDING (D-121). OSEM-expense target: amount 0, cost at
-- standard_unit_cost if set.
-- payload: {target: RESIDENT|OSEM_EXPENSE, resident_id? | branch_id? (OSEM only),
--   charge_date, performed_by_staff, expense_note?, remarks?,
--   lines:[{product_id, uom_id, qty}], inactive_resident_confirmed?}
-- ----------------------------------------------------------------------------
create or replace function public.inv_charge_service(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_charge_service';
  v_acc record;
  v_target text := public.fn_inv_jtext(p_payload->'target');
  v_branch bigint;
  v_res_id bigint;
  v_res_status text;
  v_replay jsonb;
  v_code text;
  v_date date := public.fn_inv_jdate(p_payload->'charge_date');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_note text := public.fn_inv_jtext(p_payload->'expense_note');
  v_remarks text := public.fn_inv_jtext(p_payload->'remarks');
  v_resolved jsonb;
  v_lock jsonb;
  v_period bigint;
  v_ids jsonb;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or v_target is null
     or v_target not in ('RESIDENT','OSEM_EXPENSE') then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  if v_target = 'RESIDENT' then
    select r.id, r.branch_id, r.status into v_res_id, v_branch, v_res_status
      from public.tbl_residents r where r.id = public.fn_inv_jbigint(p_payload->'resident_id');
    if v_res_id is null then
      return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
    end if;
  else
    v_branch := public.fn_inv_jbigint(p_payload->'branch_id');
  end if;
  if not public.fn_inv_can('SERVICE_CHARGE', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, v_date),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('SERVICE_CHARGE')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if (v_note is not null and length(v_note) > 200) or (v_remarks is not null and length(v_remarks) > 500) then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'expense_note/remarks'));
  end if;
  if v_target = 'RESIDENT' and v_res_status <> 'ACTIVE'
     and not public.fn_inv_jbool(p_payload->'inactive_resident_confirmed') then
    return public.fn_inv_err('INACTIVE_RESIDENT_CONFIRM', 'The resident is not active; confirm to continue');
  end if;
  v_resolved := public.fn_inv_resolve_lines(v_branch, p_payload->'lines', false);
  if v_resolved ? 'error' then
    return public.fn_inv_err(v_resolved->>'error', null, v_resolved);
  end if;
  if v_target = 'RESIDENT' and exists (select 1 from jsonb_array_elements(v_resolved->'items') x
                                        where not (x->>'is_chargeable')::boolean) then
    return public.fn_inv_err('NOT_CHARGEABLE');
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

  with ins as (
    insert into public.tbl_inv_charges (branch_id, billing_period_id, charge_date, charge_kind, target, resident_id,
      expense_note, product_id, product_name, sku, uom_code, qty_base, unit_charge_price, charge_amount, cost_amount,
      reason, request_key, created_by_account, created_by_staff)
    select v_branch, v_period, v_date, 'SERVICE', v_target, v_res_id,
           case when v_target = 'OSEM_EXPENSE' then v_note end,
           (x->>'product_id')::bigint, x->>'product_name', x->>'sku', x->>'base_uom_code', (x->>'qty_base')::numeric,
           case when v_target = 'RESIDENT' then (x->>'charge_price')::numeric end,
           case when v_target = 'RESIDENT'
                then coalesce(round((x->>'qty_base')::numeric * (x->>'charge_price')::numeric, 2), 0) else 0 end,
           round((x->>'qty_base')::numeric * coalesce((x->>'standard_unit_cost')::numeric, 0), 4),
           v_remarks, p_key, v_acc.account_id, v_staff
      from jsonb_array_elements(v_resolved->'items') x
     order by (x->>'line_no')::int
    returning id, unit_charge_price
  )
  select jsonb_build_object('charge_ids', jsonb_agg(id order by id),
                            'price_pending', coalesce(bool_or(v_target = 'RESIDENT' and unit_charge_price is null), false))
    into v_ids from ins;

  v_result := public.fn_inv_ok(v_ids);
  perform public.fn_inv_audit('SERVICE_CHARGED', 'charge', v_ids->'charge_ids'->>0, v_branch, v_staff, null, p_key, null,
    jsonb_build_object('target', v_target, 'resident_id', v_res_id, 'charge_ids', v_ids->'charge_ids'));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- inv_reverse_charge (tier MODERATOR) — Service charges only; stock charges are
-- reversed with their txn (inv_reverse_txn).
-- payload: {charge_id, charge_date? (default today), performed_by_staff, reason}
-- ----------------------------------------------------------------------------
create or replace function public.inv_reverse_charge(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_reverse_charge';
  v_acc record;
  v_c record;
  v_replay jsonb;
  v_code text;
  v_date date := coalesce(public.fn_inv_jdate(p_payload->'charge_date'), public.fn_inv_today());
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := public.fn_inv_jtext(p_payload->'reason');
  v_lock jsonb;
  v_period bigint;
  v_ids jsonb;
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
  if not found then
    return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
  end if;
  if not public.fn_inv_can('REVERSE', v_c.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_c.branch_id, v_date),
                     public.fn_inv_check_staff(v_staff, v_c.branch_id, public.fn_inv_needs_senior_staff('REVERSE')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_reason is null or length(v_reason) not between 5 and 500 then
    return public.fn_inv_err('INVALID_REASON');
  end if;
  if v_c.charge_kind <> 'SERVICE' then
    return public.fn_inv_err('USE_TXN_REVERSAL');
  end if;
  if v_date < v_c.charge_date then
    return public.fn_inv_err('DATE_BEFORE_ORIGINAL');      -- D-145, audit P1-7
  end if;
  perform 1 from public.tbl_inv_charges c where c.id = v_c.id for update;
  if exists (select 1 from public.tbl_inv_charges r where r.related_charge_id = v_c.id and r.charge_kind = 'REVERSAL') then
    return public.fn_inv_err('ALREADY_REVERSED');
  end if;
  if public.fn_inv_state_problem(null, jsonb_build_array(jsonb_build_object('branch_id', v_c.branch_id, 'date', v_date))) is not null then
    return public.fn_inv_err('PERIOD_LOCKED');
  end if;
  v_lock := public.fn_inv_lock(null, jsonb_build_array(jsonb_build_object('branch_id', v_c.branch_id, 'date', v_date)), null);
  if public.fn_inv_lock_problem(v_lock) is not null then
    return public.fn_inv_finish(public.fn_inv_lock_problem(v_lock));
  end if;
  select p.id into v_period from public.tbl_inv_billing_periods p
   where p.branch_id = v_c.branch_id and p.period_month = date_trunc('month', v_date)::date;

  with ins as (
    insert into public.tbl_inv_charges (branch_id, billing_period_id, charge_date, charge_kind, target, resident_id,
      expense_note, related_charge_id, product_id, product_name, sku, uom_code, qty_base, unit_charge_price,
      charge_amount, cost_amount, reason, request_key, created_by_account, created_by_staff)
    select c.branch_id, v_period, v_date, 'REVERSAL', c.target, c.resident_id, c.expense_note, c.id, c.product_id,
           c.product_name, c.sku, c.uom_code, -c.qty_base, c.unit_charge_price, -c.charge_amount, -c.cost_amount,
           v_reason, p_key, v_acc.account_id, v_staff
      from public.tbl_inv_charges c
     where (c.id = v_c.id or (c.related_charge_id = v_c.id and c.charge_kind = 'PRICING'))
       and not exists (select 1 from public.tbl_inv_charges r where r.related_charge_id = c.id and r.charge_kind = 'REVERSAL')
    returning id
  )
  select jsonb_agg(id order by id) into v_ids from ins;

  v_result := public.fn_inv_ok(jsonb_build_object('reversal_charge_ids', v_ids));
  perform public.fn_inv_audit('CHARGE_REVERSED', 'charge', v_c.id::text, v_c.branch_id, v_staff, null, p_key, v_reason,
    jsonb_build_object('reversal_charge_ids', v_ids));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- Billing periods (D-74, D-116, D-145)
-- ----------------------------------------------------------------------------

-- Shared payload parsing for the period RPCs: {branch_id, period_month}.
create or replace function public.fn_inv_period_args(p_payload jsonb)
returns table (branch_id bigint, period_month date)
language sql immutable set search_path = '' as $$
  select public.fn_inv_jbigint(p_payload->'branch_id'),
         case when public.fn_inv_jdate(p_payload->'period_month') = date_trunc('month', public.fn_inv_jdate(p_payload->'period_month'))::date
              then public.fn_inv_jdate(p_payload->'period_month') end
$$;

-- inv_mark_exceptions_reviewed (tier MODERATOR)
-- payload: {branch_id, period_month (YYYY-MM-01), performed_by_staff}
create or replace function public.inv_mark_exceptions_reviewed(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_mark_exceptions_reviewed';
  v_acc record;
  v_args record;
  v_replay jsonb;
  v_code text;
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_settings record;
  v_period record;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  select * into v_args from public.fn_inv_period_args(p_payload);
  if p_key is null or v_args.branch_id is null or v_args.period_month is null then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  if not public.fn_inv_can('EXCEPTIONS_REVIEW', v_args.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  select * into v_settings from public.tbl_inv_branch_settings s where s.branch_id = v_args.branch_id;
  if not found or not v_settings.is_enabled or v_settings.go_live_date is null then
    return public.fn_inv_err('INVENTORY_NOT_ENABLED');
  end if;
  if v_args.period_month < date_trunc('month', v_settings.go_live_date)::date then
    return public.fn_inv_err('INVALID_PERIOD');
  end if;
  -- a month is reviewed only once it has ended (audit P1-2, D-151)
  if (v_args.period_month + interval '1 month' - interval '1 day')::date >= public.fn_inv_today() then
    return public.fn_inv_err('MONTH_NOT_ENDED');
  end if;
  v_code := public.fn_inv_check_staff(v_staff, v_args.branch_id, public.fn_inv_needs_senior_staff('EXCEPTIONS_REVIEW'));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  perform public.fn_inv_lock(null, jsonb_build_array(jsonb_build_object('branch_id', v_args.branch_id,
            'date', v_args.period_month)), null, 'UPDATE');
  select * into v_period from public.tbl_inv_billing_periods p
   where p.branch_id = v_args.branch_id and p.period_month = v_args.period_month;
  if v_period.status <> 'OPEN' then
    return public.fn_inv_finish(public.fn_inv_err('PERIOD_LOCKED'));
  end if;
  update public.tbl_inv_billing_periods p
     -- clock_timestamp() taken while holding the period FOR UPDATE: anything dated
     -- in this month and posted later has a later posted_at / created_at (D-151)
     set exceptions_reviewed_at = clock_timestamp(), exceptions_reviewed_by_account = v_acc.account_id,
         exceptions_reviewed_by_staff = v_staff
   where p.id = v_period.id;
  v_result := public.fn_inv_ok(jsonb_build_object('billing_period_id', v_period.id));
  perform public.fn_inv_audit('EXCEPTIONS_REVIEWED', 'billing_period', v_period.id::text, v_args.branch_id, v_staff,
    null, p_key, null, jsonb_build_object('period_month', v_args.period_month));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- inv_lock_period (tier MODERATOR) — D-116 as narrowed by D-138 (no receipt
-- reconciliation step) and D-145 (only a month that has ended).
-- payload: {branch_id, period_month, performed_by_staff}
create or replace function public.inv_lock_period(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_lock_period';
  v_acc record;
  v_args record;
  v_replay jsonb;
  v_code text;
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_settings record;
  v_period record;
  v_month_end date;
  v_drift jsonb;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  select * into v_args from public.fn_inv_period_args(p_payload);
  if p_key is null or v_args.branch_id is null or v_args.period_month is null then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  if not public.fn_inv_can('PERIOD_LOCK', v_args.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := public.fn_inv_check_staff(v_staff, v_args.branch_id, public.fn_inv_needs_senior_staff('PERIOD_LOCK'));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  select * into v_settings from public.tbl_inv_branch_settings s where s.branch_id = v_args.branch_id;
  if not found or v_settings.go_live_date is null then
    return public.fn_inv_err('INVENTORY_NOT_ENABLED');
  end if;
  v_month_end := (v_args.period_month + interval '1 month' - interval '1 day')::date;
  if v_month_end >= public.fn_inv_today() then
    return public.fn_inv_err('MONTH_NOT_ENDED');
  end if;
  if v_args.period_month < date_trunc('month', v_settings.go_live_date)::date then
    return public.fn_inv_err('DATE_BEFORE_GO_LIVE');
  end if;

  perform public.fn_inv_lock(null, jsonb_build_array(jsonb_build_object('branch_id', v_args.branch_id,
            'date', v_args.period_month)), null, 'UPDATE');
  select * into v_period from public.tbl_inv_billing_periods p
   where p.branch_id = v_args.branch_id and p.period_month = v_args.period_month;
  if v_period.status = 'LOCKED' then
    return public.fn_inv_finish(public.fn_inv_err('ALREADY_LOCKED'));
  end if;
  -- 1. previous month locked first (unless this is the go-live month)
  if v_args.period_month > date_trunc('month', v_settings.go_live_date)::date and not exists (
       select 1 from public.tbl_inv_billing_periods p where p.branch_id = v_args.branch_id
          and p.period_month = (v_args.period_month - interval '1 month')::date and p.status = 'LOCKED') then
    return public.fn_inv_finish(public.fn_inv_err('PREVIOUS_PERIOD_OPEN'));
  end if;
  -- 2. exceptions reviewed
  if v_period.exceptions_reviewed_at is null then
    return public.fn_inv_finish(public.fn_inv_err('EXCEPTIONS_NOT_REVIEWED'));
  end if;
  -- ... and nothing dated in the month was posted after that review (audit P1-2)
  if exists (select 1 from public.tbl_inv_txns t
              where t.billing_period_id = v_period.id and t.posted_at > v_period.exceptions_reviewed_at)
     or exists (select 1 from public.tbl_inv_charges c
              where c.billing_period_id = v_period.id and c.created_at > v_period.exceptions_reviewed_at) then
    return public.fn_inv_finish(public.fn_inv_err('EXCEPTIONS_STALE',
      'Postings were made in this month after the exception review; review again'));
  end if;
  -- 3. no PRICE_PENDING resident charges (unpriced and not reversed), no pending adjustments
  if exists (select 1 from public.tbl_inv_charges c
              where c.billing_period_id = v_period.id and c.charge_kind in ('ISSUE','SERVICE')
                and c.target = 'RESIDENT' and c.unit_charge_price is null
                and not exists (select 1 from public.tbl_inv_charges x where x.related_charge_id = c.id
                                  and x.charge_kind in ('PRICING','REVERSAL'))) then
    return public.fn_inv_finish(public.fn_inv_err('PRICE_PENDING_EXISTS'));
  end if;
  if exists (select 1 from public.tbl_inv_adjustments a where a.branch_id = v_args.branch_id and a.status = 'PENDING'
               and (a.created_at at time zone 'Asia/Kuala_Lumpur')::date <= v_month_end) then
    return public.fn_inv_finish(public.fn_inv_err('PENDING_ADJUSTMENTS'));
  end if;
  -- 4. caches must agree with the ledger
  v_drift := public.fn_inv_verify_balances(v_args.branch_id);
  if jsonb_array_length(v_drift) > 0 then
    return public.fn_inv_finish(public.fn_inv_err('BALANCE_DRIFT', null, v_drift));
  end if;
  -- 5. closing snapshot as of month end (buckets, then pool totals)
  insert into public.tbl_inv_period_closing (billing_period_id, branch_id, lock_seq, product_id, location_id,
                                             resident_id, qty, value)
  select v_period.id, v_args.branch_id, v_period.reopen_count, l.product_id, l.location_id, l.resident_id,
         sum(l.qty_base), null::numeric
    from public.tbl_inv_txn_lines l
   where l.branch_id = v_args.branch_id and l.txn_date <= v_month_end
   group by l.product_id, l.location_id, l.resident_id
  having sum(l.qty_base) <> 0;
  insert into public.tbl_inv_period_closing (billing_period_id, branch_id, lock_seq, product_id, location_id,
                                             resident_id, qty, value)
  select v_period.id, v_args.branch_id, v_period.reopen_count, l.product_id, null, null,
         sum(l.qty_base), sum(l.value + l.revaluation_value)
    from public.tbl_inv_txn_lines l
   where l.branch_id = v_args.branch_id and l.txn_date <= v_month_end
   group by l.product_id
  having sum(l.qty_base) <> 0 or sum(l.value + l.revaluation_value) <> 0;
  -- 5b. goods in transit between branches at month end (audit P1-6, D-153): a
  --     transfer dispatched by this branch on/before month end, not cancelled
  --     and not (net) received by month end, is closed at its dispatched value
  --     on the dispatching branch (in_transit_transfer_id set, location NULL).
  insert into public.tbl_inv_period_closing (billing_period_id, branch_id, lock_seq, product_id, location_id,
                                             resident_id, qty, value, in_transit_transfer_id)
  select v_period.id, v_args.branch_id, v_period.reopen_count, tl.product_id, null, null,
         sum(tl.qty_base), sum(tl.value), bt.id
    from public.tbl_inv_branch_transfers bt
    join public.tbl_inv_txns d on d.id = bt.dispatch_txn_id
    join public.tbl_inv_branch_transfer_lines tl on tl.transfer_id = bt.id
   where bt.from_branch_id = v_args.branch_id
     and d.txn_date <= v_month_end
     and not exists (select 1 from public.tbl_inv_txns c
                      where c.reverses_txn_id = bt.dispatch_txn_id and c.txn_date <= v_month_end)
     and (select count(*) from public.tbl_inv_branch_transfer_receipts x
            join public.tbl_inv_txns rt on rt.id = x.receive_txn_id
           where x.transfer_id = bt.id and rt.txn_date <= v_month_end)
       = (select count(*) from public.tbl_inv_branch_transfer_receipts x
            join public.tbl_inv_txns rv on rv.reverses_txn_id = x.receive_txn_id
           where x.transfer_id = bt.id and rv.txn_date <= v_month_end)
   group by bt.id, tl.product_id;
  -- 6. lock
  update public.tbl_inv_billing_periods p
     set status = 'LOCKED', locked_at = now(), locked_by_account = v_acc.account_id, locked_by_staff = v_staff
   where p.id = v_period.id;

  v_result := public.fn_inv_ok(jsonb_build_object('billing_period_id', v_period.id, 'lock_seq', v_period.reopen_count));
  perform public.fn_inv_audit('PERIOD_LOCKED', 'billing_period', v_period.id::text, v_args.branch_id, v_staff, null,
    p_key, null, jsonb_build_object('period_month', v_args.period_month));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- inv_reopen_period (tier ADMIN) — only the latest locked month (D-145).
-- payload: {branch_id, period_month, performed_by_staff, reason}
create or replace function public.inv_reopen_period(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_reopen_period';
  v_acc record;
  v_args record;
  v_replay jsonb;
  v_code text;
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_reason text := public.fn_inv_jtext(p_payload->'reason');
  v_period record;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  select * into v_args from public.fn_inv_period_args(p_payload);
  if p_key is null or v_args.branch_id is null or v_args.period_month is null then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  if not public.fn_inv_can('PERIOD_REOPEN', v_args.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := public.fn_inv_check_staff(v_staff, v_args.branch_id, public.fn_inv_needs_senior_staff('PERIOD_REOPEN'));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_reason is null or length(v_reason) not between 5 and 500 then
    return public.fn_inv_err('INVALID_REASON');
  end if;
  perform public.fn_inv_lock(null, jsonb_build_array(jsonb_build_object('branch_id', v_args.branch_id,
            'date', v_args.period_month)), null, 'UPDATE');
  select * into v_period from public.tbl_inv_billing_periods p
   where p.branch_id = v_args.branch_id and p.period_month = v_args.period_month;
  if v_period.status <> 'LOCKED' then
    return public.fn_inv_finish(public.fn_inv_err('PERIOD_NOT_LOCKED'));
  end if;
  if exists (select 1 from public.tbl_inv_billing_periods p where p.branch_id = v_args.branch_id
               and p.period_month > v_args.period_month and p.status = 'LOCKED') then
    return public.fn_inv_finish(public.fn_inv_err('LATER_PERIOD_LOCKED'));
  end if;
  update public.tbl_inv_billing_periods p
     set status = 'OPEN', locked_at = null, locked_by_account = null, locked_by_staff = null,
         exceptions_reviewed_at = null, exceptions_reviewed_by_account = null, exceptions_reviewed_by_staff = null,
         reopen_count = p.reopen_count + 1
   where p.id = v_period.id;
  v_result := public.fn_inv_ok(jsonb_build_object('billing_period_id', v_period.id, 'reopen_count', v_period.reopen_count + 1));
  perform public.fn_inv_audit('PERIOD_REOPENED', 'billing_period', v_period.id::text, v_args.branch_id, v_staff, null,
    p_key, v_reason, jsonb_build_object('period_month', v_args.period_month));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- inv_verify_balances (tier ADMIN, read-only): drift between caches and ledger.
create or replace function public.inv_verify_balances(p_branch_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_drift jsonb;
begin
  if not public.fn_inv_can('VERIFY_BALANCES', p_branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_drift := public.fn_inv_verify_balances(p_branch_id);
  return public.fn_inv_ok(jsonb_build_object('clean', jsonb_array_length(v_drift) = 0, 'drift', v_drift));
end $$;

-- Grants: schema/013_inventory_grants.sql (re-run after every inventory migration, audit P1-17).

-- Nothing this file created is reachable through the API until 013 (audit V-1).
select public.fn_inv_lockdown();

commit;
