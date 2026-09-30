-- ============================================================================
-- 020 — Receipts: drop doc_type (INVOICE / CASH_BILL)
-- ============================================================================
-- The receipt header no longer distinguishes an invoice from a cash bill. D-138
-- already narrowed the vocabulary to those two and made the invoice number +
-- date mandatory, so the remaining distinction carried no information the rest
-- of the record did not. Removing it, not just hiding the picker: the column,
-- the validation and the report column all go.
--
-- Nothing that uses the OTHER doc_type is touched: tbl_inv_counters.doc_type
-- ('RCV','TRF','REQ','CNT','ADJ','EXP','TXN') is the document-numbering series,
-- and tbl_inv_txns.source_doc_type ('RECEIPT','BRANCH_TRANSFER','ADJUSTMENT')
-- is the movement provenance. Both are unrelated and stay as they are.
--
-- Data: no migration needed -- every existing receipt simply loses a column.
-- Apply after 019, then RE-RUN 013_inventory_grants.sql (D-155).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. The column
-- ----------------------------------------------------------------------------
alter table public.tbl_inv_receipts drop column if exists doc_type;

-- ----------------------------------------------------------------------------
-- 2. fn_inv_build_receipt_body -- stop validating and returning doc_type
--    (was 010:188; body copied verbatim from the live definition)
-- ----------------------------------------------------------------------------
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
  v_invoice_no text := public.fn_inv_jtext(p_body->'invoice_no');
  v_invoice_date date := public.fn_inv_jdate(p_body->'invoice_date');
  v_remarks text := public.fn_inv_jtext(p_body->'remarks');
  v_paper numeric := public.fn_inv_jnum_default(p_body->'invoice_total_paper', -1);
begin
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
    'supplier_id', v_supplier.id, 'supplier_name', v_supplier.name,
    'invoice_no', v_invoice_no, 'invoice_date', v_invoice_date, 'remarks', v_remarks,
    'discount_total', v_disc, 'tax_total', v_tax, 'other_charges_total', v_other, 'rounding_adj', v_round,
    'lines_total', v_lines_total, 'landed_total', v_lines_total + v_extra,
    'invoice_total_paper', case when v_paper <> -1 then v_paper end, 'lines', v_lines);
end $$;

-- ----------------------------------------------------------------------------
-- 3. inv_post_receipt -- the receipt insert loses the doc_type column
--    (was 017:550; body otherwise copied verbatim from the live definition)
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
  v_req_id bigint;
  v_req_status text;
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

  -- 017: receipt against a stock request (status re-checked under the row lock below)
  if p_payload->'stock_request_id' is not null and jsonb_typeof(p_payload->'stock_request_id') <> 'null' then
    select rq.id into v_req_id from public.tbl_inv_stock_requests rq
     where rq.id = public.fn_inv_jbigint(p_payload->'stock_request_id') and rq.branch_id = v_branch;
    if v_req_id is null then
      return public.fn_inv_err('REQUEST_NOT_FOUND');
    end if;
    if not exists (select 1 from jsonb_array_elements(v_body->'lines') x
                     join public.tbl_inv_stock_request_lines rl
                       on rl.request_id = v_req_id and rl.product_id = (x->>'product_id')::bigint) then
      return public.fn_inv_err('REQUEST_NO_MATCHING_LINE');
    end if;
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
  if v_req_id is not null then
    -- document lock first (D-111 step 1)
    select rq.status into v_req_status from public.tbl_inv_stock_requests rq where rq.id = v_req_id for update;
    if v_req_status not in ('APPROVED','ORDERED','PARTIALLY_RECEIVED') then
      return public.fn_inv_finish(public.fn_inv_err('REQUEST_NOT_RECEIVABLE'));
    end if;
  end if;
  v_res_w := public.fn_inv_lock_and_write(v_txns, jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'doc_type', 'RCV')),
                                          public.fn_inv_jbool(p_payload->'allow_negative'), v_acc.account_id, p_key);
  if not (v_res_w->>'ok')::boolean then
    return public.fn_inv_finish(v_res_w);
  end if;

  v_receipt_no := public.fn_inv_next_no(v_branch, 'RCV');
  insert into public.tbl_inv_receipts (id, receipt_no, branch_id, location_id, supplier_id, supplier_name,
    invoice_no, invoice_date, received_date, received_by_staff, item_count, lines_total, discount_total, tax_total,
    other_charges_total, rounding_adj, landed_total, invoice_total_paper, txn_id, remarks, created_by_account,
    stock_request_id)
  values (v_receipt_id, v_receipt_no, v_branch, v_loc.id, (v_body->>'supplier_id')::bigint, v_body->>'supplier_name',
    v_body->>'invoice_no', (v_body->>'invoice_date')::date, v_date, v_staff,
    jsonb_array_length(v_body->'lines'), (v_body->>'lines_total')::numeric, (v_body->>'discount_total')::numeric,
    (v_body->>'tax_total')::numeric, (v_body->>'other_charges_total')::numeric, (v_body->>'rounding_adj')::numeric,
    (v_body->>'landed_total')::numeric, (v_body->>'invoice_total_paper')::numeric, v_txn_id, v_body->>'remarks',
    v_acc.account_id, v_req_id);
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

  if v_req_id is not null then
    v_req_status := public.fn_inv_request_refresh_status(v_req_id);
    perform public.fn_inv_request_event(v_req_id, v_branch, 'RECEIPT_LINKED', v_receipt_no, v_acc.account_id, v_staff);
  end if;

  v_result := public.fn_inv_ok(jsonb_build_object('receipt_id', v_receipt_id, 'receipt_no', v_receipt_no,
    'txn_id', v_txn_id, 'allocation_txn_id', v_alloc_txn_id, 'txns', v_res_w->'written'->'txns',
    'negative_stock', v_res_w->'negative', 'landed_total', (v_body->>'landed_total')::numeric,
    'invoice_total_paper', v_body->'invoice_total_paper',
    'paper_difference', (v_body->>'invoice_total_paper')::numeric - (v_body->>'landed_total')::numeric,
    'stock_request_id', v_req_id, 'request_status', case when v_req_id is not null then v_req_status end));
  perform public.fn_inv_audit('RECEIPT_POSTED', 'receipt', v_receipt_id::text, v_branch, v_staff, v_txn_id, p_key, null,
    jsonb_build_object('receipt_no', v_receipt_no, 'invoice_no', v_body->>'invoice_no', 'landed_total', v_body->'landed_total',
      'stock_request_id', v_req_id));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- 4. inv_correct_receipt -- same, for the correction path (was 011:234)
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
  insert into public.tbl_inv_receipts (id, receipt_no, branch_id, location_id, supplier_id, supplier_name,
    invoice_no, invoice_date, received_date, received_by_staff, item_count, lines_total, discount_total, tax_total,
    other_charges_total, rounding_adj, landed_total, invoice_total_paper, txn_id, corrects_receipt_id, remarks,
    created_by_account)
  values (v_new_receipt_id, v_receipt_no, v_old.branch_id, v_old.location_id, (v_body->>'supplier_id')::bigint,
    v_body->>'supplier_name', v_body->>'invoice_no', (v_body->>'invoice_date')::date, v_new_date,
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

select public.fn_inv_lockdown();

commit;