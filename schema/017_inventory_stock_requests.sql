-- ============================================================================
-- 017 — General Inventory: Stock Request / Reorder workflow (Phase 4)
-- ============================================================================
-- Owner workflow (D-100, D-119, Q-18): the branch Head Nurse raises a request
-- (lines prefilled from the Suggested Order, editable) → HQ reviews it and
-- approves (per line, possibly less) or rejects → HQ orders externally (Bukku;
-- no integration, no PO system) and marks it ORDERED with a free-text
-- reference → delivery follow-up → the branch registers the receipt against
-- the request, which tracks delivered vs outstanding per line.
--
-- inv_create_stock_request   Head-Nurse tier, senior staff; DRAFT or SUBMITTED
-- inv_decide_stock_request   MOD/ADMIN, another login than the creator (D-82):
--                            APPROVE (per-line approved qty, 0 = line refused)
--                            / REJECT
-- inv_stock_request_action   SUBMIT | CANCEL | FOLLOW_UP | CLOSE | CLOSE_LINE
--                            (Head-Nurse tier, senior staff)
--                            MARK_ORDERED (MOD/ADMIN, another login than the
--                            creator; optional supplier, external ref, ETA)
-- inv_post_receipt           (replaced) optional stock_request_id: every
--                            receipt line whose product is on the request is
--                            linked to that request line (trigger), and the
--                            request moves to PARTIALLY_RECEIVED / RECEIVED
--
-- Delivered = Σ qty_base of non-voided receipt lines linked to the request
-- line (FOC included). Outstanding = approved − delivered (≥ 0) while the
-- request is APPROVED/ORDERED/PARTIALLY_RECEIVED and the line is not closed
-- short — exactly the open_req that v_inv_suggested_order subtracts (Q-18).
-- Receipt corrections (inv_correct_receipt) inherit the link automatically.
--
-- Same RPC contract as 010/015: {ok,data} | {ok:false,code,...}; capability
-- on the branch of the row acted on; idempotency; document lock first;
-- status transitions via fn_inv_guard_document; one audit event per action
-- plus the request's own append-only event log.
-- Apply after 015 (016 is not an inventory file), then RE-RUN
-- 013_inventory_grants.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Views
-- ----------------------------------------------------------------------------

-- v_inv_suggested_order (008) is used as is: it already subtracts the open
-- request quantity below (Q-18). Not redefined here so 008 stays re-runnable.

-- Delivered vs outstanding per request line (the design's v_inv_request_progress).
create or replace view public.v_inv_request_line_progress with (security_invoker = true) as
select rl.id as line_id, rl.request_id, rl.branch_id, rl.product_id, rq.status,
       rl.requested_qty, rl.approved_qty, rl.closed_short_at,
       coalesce(rc.received_qty, 0) as received_qty,
       case when rq.status in ('APPROVED','ORDERED','PARTIALLY_RECEIVED') and rl.closed_short_at is null
            then greatest(coalesce(rl.approved_qty, 0) - coalesce(rc.received_qty, 0), 0)
            else 0 end as outstanding_qty
from public.tbl_inv_stock_request_lines rl
join public.tbl_inv_stock_requests rq on rq.id = rl.request_id
left join lateral (
  select sum(rcl.qty_base) as received_qty
    from public.tbl_inv_receipt_lines rcl
    join public.tbl_inv_receipts r on r.id = rcl.receipt_id and not r.is_voided
   where rcl.request_line_id = rl.id
) rc on true;

-- ----------------------------------------------------------------------------
-- 2. Internal helpers (fn_inv_*: never granted to API roles)
-- ----------------------------------------------------------------------------

create or replace function public.fn_inv_request_received(p_line_id bigint)
returns numeric language sql stable set search_path = '' as $$
  select coalesce(sum(rcl.qty_base), 0)
    from public.tbl_inv_receipt_lines rcl
    join public.tbl_inv_receipts r on r.id = rcl.receipt_id and not r.is_voided
   where rcl.request_line_id = p_line_id
$$;

create or replace function public.fn_inv_request_event(p_request_id bigint, p_branch_id bigint, p_event text,
                                                       p_note text, p_account_id bigint, p_staff text)
returns void language sql volatile set search_path = '' as $$
  insert into public.tbl_inv_stock_request_events (request_id, branch_id, event, note, account_id, staff_id)
  values (p_request_id, p_branch_id, p_event, left(p_note, 500), p_account_id, p_staff)
$$;

-- Moves an APPROVED/ORDERED/PARTIALLY_RECEIVED request to the status its
-- lines imply. Nothing open left → RECEIVED (something arrived) or CLOSED
-- (every line closed short, nothing arrived). Some delivered, some open →
-- PARTIALLY_RECEIVED. APPROVED hops through ORDERED (the only transition the
-- guard allows): the order was evidently placed. Caller holds the row lock.
create or replace function public.fn_inv_request_refresh_status(p_request_id bigint)
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_status text;
  v_open boolean;
  v_any boolean;
  v_target text;
begin
  select rq.status into v_status from public.tbl_inv_stock_requests rq where rq.id = p_request_id;
  if v_status is null or v_status not in ('APPROVED','ORDERED','PARTIALLY_RECEIVED') then
    return v_status;
  end if;
  select coalesce(bool_or(rl.closed_short_at is null
                          and public.fn_inv_request_received(rl.id) < coalesce(rl.approved_qty, 0)), false),
         coalesce(bool_or(public.fn_inv_request_received(rl.id) > 0), false)
    into v_open, v_any
    from public.tbl_inv_stock_request_lines rl
   where rl.request_id = p_request_id;
  v_target := case when not v_open then case when v_any then 'RECEIVED' else 'CLOSED' end
                   when v_any then 'PARTIALLY_RECEIVED'
                   else v_status end;
  if v_target = v_status then
    return v_status;
  end if;
  perform set_config('inv.posting', 'on', true);
  if v_status = 'APPROVED' and v_target in ('PARTIALLY_RECEIVED','RECEIVED') then
    update public.tbl_inv_stock_requests rq set status = 'ORDERED', updated_at = now() where rq.id = p_request_id;
  end if;
  update public.tbl_inv_stock_requests rq set status = v_target, updated_at = now() where rq.id = p_request_id;
  return v_target;
end $$;

-- Receipt ↔ request links, set at INSERT (receipts and their lines are
-- append-only). A correction inherits its original's request; each line of a
-- receipt that names a request links to that request's line for the same
-- product (unique per request), so the RPCs never pass line ids around.
create or replace function public.fn_inv_receipt_request_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stock_request_id is null and new.corrects_receipt_id is not null then
    select r.stock_request_id into new.stock_request_id
      from public.tbl_inv_receipts r where r.id = new.corrects_receipt_id;
  end if;
  if new.stock_request_id is not null and not exists (
       select 1 from public.tbl_inv_stock_requests rq
        where rq.id = new.stock_request_id and rq.branch_id = new.branch_id) then
    raise exception 'INV_REQUEST_LINK: request % is not in branch %', new.stock_request_id, new.branch_id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.fn_inv_receipt_line_request_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.request_line_id is null then
    select rl.id into new.request_line_id
      from public.tbl_inv_receipts r
      join public.tbl_inv_stock_request_lines rl on rl.request_id = r.stock_request_id and rl.product_id = new.product_id
     where r.id = new.receipt_id;
  elsif not exists (select 1 from public.tbl_inv_receipts r
                      join public.tbl_inv_stock_request_lines rl on rl.request_id = r.stock_request_id
                     where r.id = new.receipt_id and rl.id = new.request_line_id and rl.product_id = new.product_id) then
    raise exception 'INV_REQUEST_LINK: request line % does not match receipt %', new.request_line_id, new.receipt_id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_inv_receipt_request_link on public.tbl_inv_receipts;
create trigger trg_inv_receipt_request_link before insert on public.tbl_inv_receipts
  for each row execute function public.fn_inv_receipt_request_link();
drop trigger if exists trg_inv_receipt_line_request_link on public.tbl_inv_receipt_lines;
create trigger trg_inv_receipt_line_request_link before insert on public.tbl_inv_receipt_lines
  for each row execute function public.fn_inv_receipt_line_request_link();

-- ----------------------------------------------------------------------------
-- 3. inv_create_stock_request (tier HEAD_NURSE, senior staff — D-134)
-- payload: {branch_id, requested_by_staff, submit? (default true), note?,
--   lines:[{product_id, uom_id, qty, remarks?}]}
-- qty is in the entered UOM (the UI defaults to the purchase UOM) and stored
-- in base. Each line snapshots on hand (Store + Floor), max and the
-- suggestion at the time of the request.
-- ----------------------------------------------------------------------------
create or replace function public.inv_create_stock_request(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_create_stock_request';
  v_acc record;
  v_branch bigint;
  v_replay jsonb;
  v_code text;
  v_staff text := public.fn_inv_jtext(p_payload->'requested_by_staff');
  v_note text := public.fn_inv_jtext(p_payload->'note');
  v_submit boolean := coalesce(case when jsonb_typeof(p_payload->'submit') = 'boolean'
                                    then (p_payload->>'submit')::boolean end, true);
  v_res jsonb;
  v_item jsonb;
  v_remarks text;
  v_req_id bigint;
  v_req_no text;
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
  v_branch := public.fn_inv_jbigint(p_payload->'branch_id');
  if not public.fn_inv_can('STOCK_REQUEST', v_branch) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := coalesce(public.fn_inv_check_branch_date(v_branch, public.fn_inv_today()),
                     public.fn_inv_check_staff(v_staff, v_branch, public.fn_inv_needs_senior_staff('STOCK_REQUEST')));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_note is not null and length(v_note) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'note'));
  end if;
  v_res := public.fn_inv_resolve_lines(v_branch, p_payload->'lines', true);
  if v_res ? 'error' then
    return public.fn_inv_err(v_res->>'error', null, v_res);
  end if;
  for v_item in select * from jsonb_array_elements(v_res->'items') loop
    v_remarks := public.fn_inv_jtext(v_item->'raw'->'remarks');
    if v_remarks is not null and length(v_remarks) > 500 then
      return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'remarks', 'line', v_item->'line_no'));
    end if;
  end loop;

  perform public.fn_inv_lock('[]'::jsonb, null, jsonb_build_array(jsonb_build_object('branch_id', v_branch, 'doc_type', 'REQ')));
  v_req_no := public.fn_inv_next_no(v_branch, 'REQ');
  v_status := case when v_submit then 'SUBMITTED' else 'DRAFT' end;
  insert into public.tbl_inv_stock_requests (request_no, branch_id, status, requested_by_staff, created_by_account, submitted_at)
  values (v_req_no, v_branch, v_status, v_staff, v_acc.account_id, case when v_submit then now() end)
  returning id into v_req_id;

  insert into public.tbl_inv_stock_request_lines (request_id, branch_id, product_id, supplier_id, current_qty_snapshot,
    max_qty_snapshot, suggested_qty, requested_qty, remarks)
  select v_req_id, v_branch, (x->>'product_id')::bigint, p.default_supplier_id,
         coalesce((select sum(b.qty) from public.tbl_inv_balances b
                     join public.tbl_inv_locations l on l.id = b.location_id and l.kind in ('STORE','FLOOR')
                    where b.branch_id = v_branch and b.product_id = p.id and b.resident_id is null), 0),
         so.max_total, coalesce(so.suggested_base, 0), (x->>'qty_base')::numeric,
         public.fn_inv_jtext(x->'raw'->'remarks')
    from jsonb_array_elements(v_res->'items') x
    join public.tbl_inv_products p on p.id = (x->>'product_id')::bigint
    left join public.v_inv_suggested_order so on so.branch_id = v_branch and so.product_id = p.id
   order by (x->>'line_no')::int;

  perform public.fn_inv_request_event(v_req_id, v_branch, 'CREATED', v_note, v_acc.account_id, v_staff);
  if v_submit then
    perform public.fn_inv_request_event(v_req_id, v_branch, 'SUBMITTED', null, v_acc.account_id, v_staff);
  end if;

  v_result := public.fn_inv_ok(jsonb_build_object('request_id', v_req_id, 'request_no', v_req_no, 'status', v_status));
  perform public.fn_inv_audit('STOCK_REQUEST_CREATED', 'stock_request', v_req_id::text, v_branch, v_staff, null, p_key,
    v_note, jsonb_build_object('request_no', v_req_no, 'status', v_status,
      'lines', (select jsonb_agg(jsonb_build_object('product_id', x->'product_id', 'qty_base', x->'qty_base'))
                  from jsonb_array_elements(v_res->'items') x)));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- 4. inv_decide_stock_request (tier MODERATOR: HQ review, D-82)
-- payload: {request_id, decision: APPROVE|REJECT, performed_by_staff, note?,
--   approvals?:[{line_id, approved_qty (base)}]}
-- APPROVE: lines not listed are approved in full; 0 refuses a line; at least
-- one line must be approved (else REJECT). Another login than the creator.
-- ----------------------------------------------------------------------------
create or replace function public.inv_decide_stock_request(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_decide_stock_request';
  v_acc record;
  v_req record;
  v_replay jsonb;
  v_code text;
  v_decision text := public.fn_inv_jtext(p_payload->'decision');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_note text := public.fn_inv_jtext(p_payload->'note');
  v_status text;
  a jsonb;
  v_line_id bigint;
  v_qty numeric;
  v_seen bigint[] := '{}';
  v_approved jsonb := '{}';
  v_total numeric;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or v_decision is null
     or v_decision not in ('APPROVE','REJECT') then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select rq.* into v_req from public.tbl_inv_stock_requests rq where rq.id = public.fn_inv_jbigint(p_payload->'request_id');
  if not found then
    return public.fn_inv_err('FORBIDDEN');                                  -- unknown = out of scope
  end if;
  if not public.fn_inv_can('REQUEST_APPROVE', v_req.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := public.fn_inv_check_staff(v_staff, v_req.branch_id, false);
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_note is not null and length(v_note) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'note'));
  end if;
  if v_req.created_by_account = v_acc.account_id then
    return public.fn_inv_err('SOD_SAME_ACCOUNT');                           -- D-82
  end if;
  if p_payload->'approvals' is not null and jsonb_typeof(p_payload->'approvals') <> 'null'
     and (jsonb_typeof(p_payload->'approvals') <> 'array' or jsonb_array_length(p_payload->'approvals') > 200) then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'approvals'));
  end if;

  -- document lock first (D-111 step 1)
  select rq.status into v_status from public.tbl_inv_stock_requests rq where rq.id = v_req.id for update;
  if v_status <> 'SUBMITTED' then
    return public.fn_inv_err('REQUEST_BAD_STATUS');
  end if;

  perform set_config('inv.posting', 'on', true);
  if v_decision = 'APPROVE' then
    for a in select * from jsonb_array_elements(coalesce(nullif(p_payload->'approvals', 'null'::jsonb), '[]'::jsonb)) loop
      v_line_id := public.fn_inv_jbigint(a->'line_id');
      v_qty := public.fn_inv_jnum(a->'approved_qty');
      if v_line_id is null or not exists (select 1 from public.tbl_inv_stock_request_lines rl
                                           where rl.id = v_line_id and rl.request_id = v_req.id) then
        return public.fn_inv_finish(public.fn_inv_err('REQUEST_LINE_NOT_FOUND'));
      end if;
      if v_line_id = any (v_seen) then
        return public.fn_inv_finish(public.fn_inv_err('DUPLICATE_LINE'));
      end if;
      if v_qty is null or v_qty < 0 or v_qty > 1000000 or v_qty <> round(v_qty, 4) then
        return public.fn_inv_finish(public.fn_inv_err('INVALID_QTY', null, jsonb_build_object('line_id', v_line_id)));
      end if;
      v_seen := v_seen || v_line_id;
      v_approved := v_approved || jsonb_build_object(v_line_id::text, v_qty);
    end loop;
    select coalesce(sum(coalesce((v_approved->>rl.id::text)::numeric, rl.requested_qty)), 0) into v_total
      from public.tbl_inv_stock_request_lines rl where rl.request_id = v_req.id;
    if v_total <= 0 then
      return public.fn_inv_finish(public.fn_inv_err('NOTHING_APPROVED'));
    end if;
    update public.tbl_inv_stock_request_lines rl
       set approved_qty = coalesce((v_approved->>rl.id::text)::numeric, rl.requested_qty)
     where rl.request_id = v_req.id;
  end if;
  update public.tbl_inv_stock_requests rq
     set status = case when v_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end,
         reviewed_by_account = v_acc.account_id, reviewed_by_staff = v_staff, reviewed_at = now(),
         review_note = v_note, updated_at = now()
   where rq.id = v_req.id;
  perform public.fn_inv_request_event(v_req.id, v_req.branch_id,
    case when v_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end, v_note, v_acc.account_id, v_staff);

  v_result := public.fn_inv_ok(jsonb_build_object('request_id', v_req.id, 'request_no', v_req.request_no,
    'decision', v_decision, 'status', case when v_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end));
  perform public.fn_inv_audit('STOCK_REQUEST_' || v_decision, 'stock_request', v_req.id::text, v_req.branch_id, v_staff,
    null, p_key, v_note, jsonb_build_object('request_no', v_req.request_no,
      'approved', (select jsonb_object_agg(rl.id::text, rl.approved_qty) from public.tbl_inv_stock_request_lines rl
                    where rl.request_id = v_req.id)));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- 5. inv_stock_request_action
-- payload: {request_id, action, performed_by_staff, note?, line_id? (CLOSE_LINE),
--   supplier_id?, external_ref?, expected_delivery_date? (MARK_ORDERED /
--   FOLLOW_UP)}
--   SUBMIT        DRAFT → SUBMITTED
--   CANCEL        DRAFT / SUBMITTED / APPROVED → CANCELLED (nothing received yet)
--   MARK_ORDERED  APPROVED → ORDERED (MOD/ADMIN, another login than the creator)
--   FOLLOW_UP     note (and new ETA) on APPROVED / ORDERED / PARTIALLY_RECEIVED
--   CLOSE_LINE    close one open line short (note), then status refresh
--   CLOSE         close every open line short (note) → CLOSED
-- ----------------------------------------------------------------------------
create or replace function public.inv_stock_request_action(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_stock_request_action';
  v_acc record;
  v_req record;
  v_replay jsonb;
  v_code text;
  v_action text := public.fn_inv_jtext(p_payload->'action');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_note text := public.fn_inv_jtext(p_payload->'note');
  v_ref text := public.fn_inv_jtext(p_payload->'external_ref');
  v_eta date;
  v_supplier bigint;
  v_line record;
  v_line_id bigint;
  v_cap text;
  v_status text;
  v_new text;
  v_event text;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' or v_action is null
     or v_action not in ('SUBMIT','CANCEL','MARK_ORDERED','FOLLOW_UP','CLOSE','CLOSE_LINE') then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select rq.* into v_req from public.tbl_inv_stock_requests rq where rq.id = public.fn_inv_jbigint(p_payload->'request_id');
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_cap := case when v_action = 'MARK_ORDERED' then 'REQUEST_APPROVE' else 'STOCK_REQUEST' end;
  if not public.fn_inv_can(v_cap, v_req.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  v_code := public.fn_inv_check_staff(v_staff, v_req.branch_id, public.fn_inv_needs_senior_staff(v_cap));
  if v_code is not null then
    return public.fn_inv_err(v_code);
  end if;
  if v_note is not null and length(v_note) > 500 then
    return public.fn_inv_err('INVALID_PAYLOAD', null, jsonb_build_object('field', 'note'));
  end if;
  if v_action in ('FOLLOW_UP','CLOSE','CLOSE_LINE') and (v_note is null or length(v_note) < 2) then
    return public.fn_inv_err('NOTE_REQUIRED');
  end if;
  if v_ref is not null and length(v_ref) > 60 then
    return public.fn_inv_err('INVALID_REF');
  end if;
  if p_payload->'expected_delivery_date' is not null and jsonb_typeof(p_payload->'expected_delivery_date') <> 'null' then
    v_eta := public.fn_inv_jdate(p_payload->'expected_delivery_date');
    if v_eta is null then
      return public.fn_inv_err('INVALID_DATE');
    end if;
  end if;
  if v_action = 'MARK_ORDERED' then
    if v_req.created_by_account = v_acc.account_id then
      return public.fn_inv_err('SOD_SAME_ACCOUNT');                         -- D-82 (matrix: ≠ creating account)
    end if;
    if p_payload->'supplier_id' is not null and jsonb_typeof(p_payload->'supplier_id') <> 'null' then
      select s.id into v_supplier from public.tbl_inv_suppliers s
       where s.id = public.fn_inv_jbigint(p_payload->'supplier_id') and s.is_active
         and (s.owner_branch_id is null or s.owner_branch_id = v_req.branch_id);
      if v_supplier is null then
        return public.fn_inv_err('SUPPLIER_NOT_FOUND');
      end if;
    end if;
  end if;

  -- document lock first (D-111 step 1)
  select rq.status into v_status from public.tbl_inv_stock_requests rq where rq.id = v_req.id for update;
  if not (case v_action
           when 'SUBMIT' then v_status = 'DRAFT'
           when 'CANCEL' then v_status in ('DRAFT','SUBMITTED','APPROVED')
           when 'MARK_ORDERED' then v_status = 'APPROVED'
           else v_status in ('APPROVED','ORDERED','PARTIALLY_RECEIVED')
         end) then
    return public.fn_inv_err('REQUEST_BAD_STATUS');
  end if;
  if v_action = 'CLOSE_LINE' then
    select rl.* into v_line from public.tbl_inv_stock_request_lines rl
     where rl.id = public.fn_inv_jbigint(p_payload->'line_id') and rl.request_id = v_req.id;
    if not found then
      return public.fn_inv_err('REQUEST_LINE_NOT_FOUND');
    end if;
    if v_line.closed_short_at is not null then
      return public.fn_inv_err('LINE_ALREADY_CLOSED');
    end if;
  end if;

  perform set_config('inv.posting', 'on', true);
  v_new := v_status;
  case v_action
    when 'SUBMIT' then
      update public.tbl_inv_stock_requests rq set status = 'SUBMITTED', submitted_at = now(), updated_at = now()
       where rq.id = v_req.id;
      v_new := 'SUBMITTED';
      v_event := 'SUBMITTED';
    when 'CANCEL' then
      update public.tbl_inv_stock_requests rq set status = 'CANCELLED', updated_at = now() where rq.id = v_req.id;
      v_new := 'CANCELLED';
      v_event := 'CANCELLED';
    when 'MARK_ORDERED' then
      update public.tbl_inv_stock_requests rq
         set status = 'ORDERED', ordered_at = now(), ordered_by_account = v_acc.account_id,
             external_ref = coalesce(v_ref, rq.external_ref),
             expected_delivery_date = coalesce(v_eta, rq.expected_delivery_date), updated_at = now()
       where rq.id = v_req.id;
      if v_supplier is not null then
        update public.tbl_inv_stock_request_lines rl set supplier_id = v_supplier
         where rl.request_id = v_req.id and rl.supplier_id is distinct from v_supplier;
      end if;
      v_new := 'ORDERED';
      v_event := 'ORDERED';
      v_note := concat_ws(' · ', v_note, case when v_ref is not null then 'Ref: ' || v_ref end);
    when 'FOLLOW_UP' then
      if v_eta is not null then
        update public.tbl_inv_stock_requests rq set expected_delivery_date = v_eta, updated_at = now()
         where rq.id = v_req.id;
      end if;
      v_event := 'FOLLOW_UP';
    when 'CLOSE_LINE' then
      update public.tbl_inv_stock_request_lines rl
         set closed_short_at = now(), closed_short_by_account = v_acc.account_id, closed_short_reason = left(v_note, 200)
       where rl.id = v_line.id;
      v_new := public.fn_inv_request_refresh_status(v_req.id);
      v_event := 'LINE_CLOSED_SHORT';
      v_line_id := v_line.id;
      v_note := left(v_line.id::text || ': ' || v_note, 500);
    when 'CLOSE' then
      update public.tbl_inv_stock_request_lines rl
         set closed_short_at = now(), closed_short_by_account = v_acc.account_id, closed_short_reason = left(v_note, 200)
       where rl.request_id = v_req.id and rl.closed_short_at is null
         and public.fn_inv_request_received(rl.id) < coalesce(rl.approved_qty, 0);
      update public.tbl_inv_stock_requests rq set status = 'CLOSED', updated_at = now() where rq.id = v_req.id;
      v_new := 'CLOSED';
      v_event := 'CLOSED';
  end case;
  perform public.fn_inv_request_event(v_req.id, v_req.branch_id, v_event, v_note, v_acc.account_id, v_staff);

  v_result := public.fn_inv_ok(jsonb_build_object('request_id', v_req.id, 'request_no', v_req.request_no,
    'action', v_action, 'status', v_new));
  perform public.fn_inv_audit('STOCK_REQUEST_' || v_action, 'stock_request', v_req.id::text, v_req.branch_id, v_staff,
    null, p_key, v_note, jsonb_build_object('request_no', v_req.request_no, 'status', v_new,
      'external_ref', v_ref, 'expected_delivery_date', v_eta, 'supplier_id', v_supplier,
      'line_id', v_line_id),
    jsonb_build_object('status', v_status));
  return public.fn_inv_finish(public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result));
end $$;

-- ----------------------------------------------------------------------------
-- 6. inv_post_receipt, replaced (was 010): + optional stock_request_id. Every
--    other line is identical to 010.
-- inv_post_receipt (tier HEAD_NURSE, senior staff attributed — D-134)
-- payload: {location_id (STORE), supplier_id, doc_type, invoice_no, invoice_date,
--   received_date, received_by_staff, discount_total, tax_total, other_charges_total,
--   rounding_adj, remarks, lines:[{product_id, uom_id, qty, foc_qty, unit_cost,
--   allocate_resident_id?}], stock_request_id?, allow_negative?, sanity_confirmed?}
-- 017: stock_request_id (optional) links the receipt to an APPROVED / ORDERED /
-- PARTIALLY_RECEIVED request of the same branch; lines whose product is on the
-- request are linked to its lines (trigger) and the request status follows.
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
  insert into public.tbl_inv_receipts (id, receipt_no, branch_id, location_id, supplier_id, supplier_name, doc_type,
    invoice_no, invoice_date, received_date, received_by_staff, item_count, lines_total, discount_total, tax_total,
    other_charges_total, rounding_adj, landed_total, invoice_total_paper, txn_id, remarks, created_by_account,
    stock_request_id)
  values (v_receipt_id, v_receipt_no, v_branch, v_loc.id, (v_body->>'supplier_id')::bigint, v_body->>'supplier_name',
    v_body->>'doc_type', v_body->>'invoice_no', (v_body->>'invoice_date')::date, v_date, v_staff,
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


-- Grants: RE-RUN schema/013_inventory_grants.sql after this file (catalog-driven).

-- Nothing this file created is reachable through the API until 013 (audit V-1).
select public.fn_inv_lockdown();

commit;
