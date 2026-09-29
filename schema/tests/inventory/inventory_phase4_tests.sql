-- ============================================================================
-- General Inventory — Phase 4 SQL tests (schema/017 stock requests / reorder)
-- ============================================================================
-- Same harness and rules as inventory_v1_tests.sql: every "-- @test" block
-- runs in its own fresh session inside BEGIN … ROLLBACK on top of the fixture.
-- Fixture facts used: GLOVES max 500 Store + 100 Floor, BOX = 100 EA;
-- GAUZE max 200 + 50, PACK = 10 EA; amn = ALMA shared login (Head-Nurse tier),
-- hqmod/hqmod2/hqadmin = HQ; AMN-HN senior, AMN-1 junior; HQ-ND senior HQ.
-- ============================================================================

-- @test P4 request: full lifecycle — create (purchase UOM → base, snapshots), replay, approve partially, order, two partial deliveries
do $$
declare
  k uuid := gen_random_uuid();
  pay jsonb;
  d jsonb;
  r jsonb;
  req bigint;
  l_gloves bigint;
  l_gauze bigint;
  so record;
begin
  pay := jsonb_build_object('branch_id', 1, 'requested_by_staff', 'AMN-HN', 'note', 'monthly top-up',
    'lines', '[{"sku":"GLOVES","uom":"BOX","qty":3},{"sku":"GAUZE","uom":"PACK","qty":5,"remarks":"urgent"}]'::jsonb);
  d := tests.ok(tests.call('amn', 'inv_create_stock_request', pay, k), 'create');
  req := (d->>'request_id')::bigint;
  perform tests.eq(d->>'status', 'SUBMITTED', 'submitted by default');
  perform tests.eq(d->>'request_no' like 'AMN-REQ-%', true, 'numbered');
  r := tests.call('amn', 'inv_create_stock_request', pay, k);
  perform tests.eq((r->>'replayed')::boolean, true, 'same key replays');
  perform tests.eq((select count(*) from public.tbl_inv_stock_requests)::int, 1, 'one request only');

  select id into l_gloves from public.tbl_inv_stock_request_lines where request_id = req and product_id = tests.prod('GLOVES');
  select id into l_gauze from public.tbl_inv_stock_request_lines where request_id = req and product_id = tests.prod('GAUZE');
  perform tests.eq((select requested_qty from public.tbl_inv_stock_request_lines where id = l_gloves), 300::numeric, '3 BOX = 300 EA');
  perform tests.eq((select requested_qty from public.tbl_inv_stock_request_lines where id = l_gauze), 50::numeric, '5 PACK = 50 EA');
  perform tests.eq((select max_qty_snapshot from public.tbl_inv_stock_request_lines where id = l_gloves), 600::numeric, 'max snapshot');
  perform tests.eq((select suggested_qty from public.tbl_inv_stock_request_lines where id = l_gloves), 600::numeric, 'suggestion snapshot');
  perform tests.eq((select current_qty_snapshot from public.tbl_inv_stock_request_lines where id = l_gloves), 0::numeric, 'on hand snapshot');
  perform tests.eq((select remarks from public.tbl_inv_stock_request_lines where id = l_gauze), 'urgent', 'line remark');
  perform tests.eq((select count(*) from public.tbl_inv_stock_request_events where request_id = req)::int, 2, 'CREATED + SUBMITTED');
  -- nothing approved yet: a SUBMITTED request is not outstanding
  perform tests.eq((select open_request_qty from public.v_inv_suggested_order where branch_id = 1 and product_id = tests.prod('GLOVES')),
    0::numeric, 'submitted is not outstanding');

  -- HQ approves GLOVES partially (200), GAUZE in full (not listed)
  d := tests.ok(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req, 'decision', 'APPROVE',
    'performed_by_staff', 'HQ-ND', 'note', 'budget', 'approvals', jsonb_build_array(
      jsonb_build_object('line_id', l_gloves, 'approved_qty', 200)))), 'approve');
  perform tests.eq((select approved_qty from public.tbl_inv_stock_request_lines where id = l_gloves), 200::numeric, 'partial approval');
  perform tests.eq((select approved_qty from public.tbl_inv_stock_request_lines where id = l_gauze), 50::numeric, 'full approval');
  perform tests.eq((select reviewed_by_staff from public.tbl_inv_stock_requests where id = req), 'HQ-ND', 'reviewer staff');

  -- Q-18: Suggested Order subtracts approved-but-undelivered
  select * into so from public.v_inv_suggested_order where branch_id = 1 and product_id = tests.prod('GLOVES');
  perform tests.eq(so.open_request_qty, 200::numeric, 'gloves outstanding');
  perform tests.eq(so.suggested_base, 400::numeric, '600 − 0 − 200');
  perform tests.eq(so.suggested_purchase_qty, 4::numeric, '400 EA = 4 BOX');
  select * into so from public.v_inv_suggested_order where branch_id = 1 and product_id = tests.prod('GAUZE');
  perform tests.eq(so.suggested_base, 200::numeric, '250 − 0 − 50');

  -- HQ marks it ordered (Bukku ref, free text)
  perform tests.ok(tests.call('hqadmin', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'MARK_ORDERED', 'performed_by_staff', 'HQ-1', 'external_ref', 'BUKKU PO-0042',
    'supplier_id', (select id from public.tbl_inv_suppliers where owner_branch_id is null),
    'expected_delivery_date', (tests.today() + 3)::text)), 'ordered');
  perform tests.eq((select status || '|' || external_ref from public.tbl_inv_stock_requests where id = req), 'ORDERED|BUKKU PO-0042', 'ref kept');
  perform tests.eq((select count(*) from public.tbl_inv_stock_request_lines where request_id = req and supplier_id is not null)::int, 2, 'supplier set');
  perform tests.ok(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'FOLLOW_UP', 'performed_by_staff', 'AMN-HN', 'note', 'called supplier, next week')), 'follow-up');

  -- first delivery: 1 BOX gloves → PARTIALLY_RECEIVED
  d := tests.ok(tests.receipt('amn', 'AMN', 'R4-1', '[{"sku":"GLOVES","uom":"BOX","qty":1,"unit_cost":20}]',
    jsonb_build_object('stock_request_id', req)), 'first delivery');
  perform tests.eq(d->>'request_status', 'PARTIALLY_RECEIVED', 'partially received');
  perform tests.eq((select request_line_id from public.tbl_inv_receipt_lines where receipt_id = (d->>'receipt_id')::bigint), l_gloves, 'line linked');
  perform tests.eq((select stock_request_id from public.tbl_inv_receipts where id = (d->>'receipt_id')::bigint), req, 'header linked');
  perform tests.eq((select received_qty || '/' || outstanding_qty from public.v_inv_request_line_progress where line_id = l_gloves), '100.0000/100.0000', 'progress');
  select * into so from public.v_inv_suggested_order where branch_id = 1 and product_id = tests.prod('GLOVES');
  perform tests.eq(so.suggested_base, 400::numeric, '600 − 100 on hand − 100 outstanding');
  perform tests.eq(so.on_hand, 100::numeric, 'on hand (Store + Floor)');

  -- second delivery: rest of gloves + gauze (+ an unrelated product, not linked) → RECEIVED
  d := tests.ok(tests.receipt('amn', 'AMN', 'R4-2', '[{"sku":"GLOVES","uom":"BOX","qty":1,"unit_cost":20},{"sku":"GAUZE","uom":"PACK","qty":5,"unit_cost":3},{"sku":"MILK","qty":2,"unit_cost":25}]',
    jsonb_build_object('stock_request_id', req)), 'second delivery');
  perform tests.eq(d->>'request_status', 'RECEIVED', 'fully received');
  perform tests.eq((select count(*) from public.tbl_inv_receipt_lines where receipt_id = (d->>'receipt_id')::bigint and request_line_id is null)::int,
    1, 'extra product stays unlinked');
  perform tests.eq((select sum(outstanding_qty) from public.v_inv_request_line_progress where request_id = req), 0::numeric, 'nothing outstanding');
  perform tests.eq((select count(*) from public.tbl_inv_stock_request_events where request_id = req and event = 'RECEIPT_LINKED')::int, 2, 'events');
  perform tests.eq((select count(*) from public.tbl_inv_audit_log where entity = 'stock_request' and entity_id = req::text)::int,
    4, 'create, approve, ordered, follow-up audited');
  perform tests.code(tests.receipt('amn', 'AMN', 'R4-3', '[{"sku":"GLOVES","uom":"BOX","qty":1,"unit_cost":20}]',
    jsonb_build_object('stock_request_id', req)), 'REQUEST_NOT_RECEIVABLE', 'received request takes no more receipts');
end $$;

-- @test P4 request: permissions — tier, senior staff, branch scope, DEMO isolation, separation of duties, cross-branch receipt
do $$
declare
  d jsonb;
  req bigint;
  demo_req bigint;
  n int;
begin
  perform tests.code(tests.call('amn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":10}]'::jsonb)), 'STAFF_NOT_SENIOR', 'junior staff');
  perform tests.code(tests.call('bmn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'BMN-HN', 'lines', '[{"sku":"GLOVES","qty":10}]'::jsonb)), 'FORBIDDEN', 'another branch');
  perform tests.code(tests.call('amp', 'inv_create_stock_request', jsonb_build_object('branch_id', 2,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"GLOVES","qty":10}]'::jsonb)), 'FORBIDDEN', 'physio login');
  perform tests.code(tests.call('demo', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"GLOVES","qty":10}]'::jsonb)), 'FORBIDDEN', 'demo into a real branch');
  perform tests.code(tests.call('hqstaff', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'HQ-ND', 'lines', '[{"sku":"GLOVES","qty":10}]'::jsonb)), 'FORBIDDEN', 'HQ staff login performs nothing');
  perform tests.code(tests.call('amn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"SVC","uom":"JOB","qty":1}]'::jsonb)), 'NOT_STOCK_ITEM', 'no service items');
  perform tests.code(tests.call('amn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"GLOVES","qty":1},{"sku":"GLOVES","uom":"BOX","qty":1}]'::jsonb)),
    'DUPLICATE_LINE', 'one line per product');

  req := (tests.ok(tests.call('amn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"GLOVES","qty":50}]'::jsonb)), 'create')->>'request_id')::bigint;
  perform tests.code(tests.call('amn', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'AMN-HN')), 'FORBIDDEN', 'branch login cannot approve');
  perform tests.code(tests.call('bmn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'CANCEL', 'performed_by_staff', 'BMN-HN')), 'FORBIDDEN', 'another branch cannot cancel');
  perform tests.code(tests.call('demo', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'DEMO-HN')), 'FORBIDDEN', 'demo admin cannot see a real branch');
  perform tests.code(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'MARK_ORDERED', 'performed_by_staff', 'AMN-HN')), 'FORBIDDEN', 'branch cannot mark ordered');

  -- an HQ login that raised the request cannot also approve or order it (D-82)
  -- approve / mark ordered are ADMIN-only (owner 2026-09-29)
  d := tests.ok(tests.call('hqmod', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'HQ-ND', 'lines', '[{"sku":"GAUZE","qty":20}]'::jsonb)), 'HQ moderator creates for ALMA');
  perform tests.code(tests.call('hqmod', 'inv_decide_stock_request', jsonb_build_object('request_id', d->'request_id',
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND')), 'FORBIDDEN', 'moderator cannot approve');
  perform tests.ok(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', d->'request_id',
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND')), 'ADMIN approves');
  perform tests.code(tests.call('hqmod', 'inv_stock_request_action', jsonb_build_object('request_id', d->'request_id',
    'action', 'MARK_ORDERED', 'performed_by_staff', 'HQ-ND')), 'FORBIDDEN', 'moderator cannot mark ordered');
  d := tests.ok(tests.call('hqadmin', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'HQ-ND', 'lines', '[{"sku":"GAUZE","qty":5}]'::jsonb)), 'HQ admin creates for ALMA');
  perform tests.code(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', d->'request_id',
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND')), 'SOD_SAME_ACCOUNT', 'creator cannot approve');

  -- DEMO: own request, invisible to real logins and to HQ; a real branch cannot receive against it
  demo_req := (tests.ok(tests.call('demo', 'inv_create_stock_request', jsonb_build_object('branch_id', 6,
    'requested_by_staff', 'DEMO-HN', 'lines', '[{"sku":"DEMOPROD","qty":5}]'::jsonb)), 'demo request')->>'request_id')::bigint;
  perform tests.code(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', demo_req,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND')), 'FORBIDDEN', 'HQ cannot touch demo');
  perform tests.login('hqadmin');
  select count(*) into n from public.tbl_inv_stock_requests where id = demo_req;
  perform tests.logout();
  perform tests.eq(n, 0, 'demo request invisible to HQ');
  perform tests.login('amn');
  select count(*) into n from public.tbl_inv_stock_requests;
  perform tests.logout();
  perform tests.eq(n, 3, 'amn sees only ALMA requests');
  perform tests.login('bmn');
  select count(*) into n from public.tbl_inv_stock_request_lines;
  perform tests.logout();
  perform tests.eq(n, 0, 'bmn sees no ALMA lines');

  -- cross-branch receipt against an ALMA request
  perform tests.code(tests.receipt('bmn', 'BMN', 'X4-1', '[{"sku":"GAUZE","qty":20,"unit_cost":1}]',
    jsonb_build_object('stock_request_id', d->'request_id')), 'REQUEST_NOT_FOUND', 'other branch cannot link');
  perform tests.code(tests.receipt('amn', 'AMN', 'X4-2', '[{"sku":"MILK","qty":1,"unit_cost":1}]',
    jsonb_build_object('stock_request_id', d->'request_id')), 'REQUEST_NO_MATCHING_LINE', 'no product in common');
  -- clients cannot write the tables at all
  perform tests.login('amn');
  perform tests.raises(format('update public.tbl_inv_stock_requests set status = %L where id = %s', 'APPROVED', req),
    'permission denied%', 'no client UPDATE');
  perform tests.logout();
end $$;

-- @test P4 request: status transitions, drafts, reject, nothing-approved, notes, engine-only updates
do $$
declare
  req bigint;
  line bigint;
begin
  req := (tests.ok(tests.call('amn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1, 'submit', false,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"GLOVES","qty":50}]'::jsonb)), 'draft')->>'request_id')::bigint;
  line := (select id from public.tbl_inv_stock_request_lines where request_id = req);
  perform tests.eq((select status from public.tbl_inv_stock_requests where id = req), 'DRAFT', 'draft');
  perform tests.code(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND')), 'REQUEST_BAD_STATUS', 'draft cannot be approved');
  perform tests.ok(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'SUBMIT', 'performed_by_staff', 'AMN-HN')), 'submit');
  perform tests.code(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'SUBMIT', 'performed_by_staff', 'AMN-HN')), 'REQUEST_BAD_STATUS', 'submit twice');
  perform tests.code(tests.call('hqadmin', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'MARK_ORDERED', 'performed_by_staff', 'HQ-ND')), 'REQUEST_BAD_STATUS', 'not approved yet');
  perform tests.code(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND', 'approvals',
    jsonb_build_array(jsonb_build_object('line_id', line, 'approved_qty', 0)))), 'NOTHING_APPROVED', 'all zero');
  perform tests.code(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND', 'approvals',
    jsonb_build_array(jsonb_build_object('line_id', line + 999, 'approved_qty', 1)))), 'REQUEST_LINE_NOT_FOUND', 'foreign line');
  perform tests.code(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND', 'approvals',
    jsonb_build_array(jsonb_build_object('line_id', line, 'approved_qty', -1)))), 'INVALID_QTY', 'negative');
  perform tests.ok(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'REJECT', 'performed_by_staff', 'HQ-ND', 'note', 'stock enough')), 'reject');
  perform tests.eq((select status from public.tbl_inv_stock_requests where id = req), 'REJECTED', 'rejected');
  perform tests.code(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'CANCEL', 'performed_by_staff', 'AMN-HN')), 'REQUEST_BAD_STATUS', 'rejected is final');
  perform tests.code(tests.receipt('amn', 'AMN', 'T4-1', '[{"sku":"GLOVES","qty":50,"unit_cost":1}]',
    jsonb_build_object('stock_request_id', req)), 'REQUEST_NOT_RECEIVABLE', 'no receipt on a rejected request');

  -- cancel an approved request (nothing received)
  req := (tests.ok(tests.call('amn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"GAUZE","qty":10}]'::jsonb)), 'second')->>'request_id')::bigint;
  perform tests.ok(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND')), 'approve');
  perform tests.code(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'FOLLOW_UP', 'performed_by_staff', 'AMN-HN')), 'NOTE_REQUIRED', 'follow-up needs a note');
  perform tests.code(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'FOLLOW_UP', 'performed_by_staff', 'AMN-HN', 'note', 'ok', 'expected_delivery_date', '2026-02-30')),
    'INVALID_DATE', 'bad ETA');
  perform tests.ok(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'CANCEL', 'performed_by_staff', 'AMN-HN')), 'cancel approved');
  perform tests.eq((select open_request_qty from public.v_inv_suggested_order where branch_id = 1 and product_id = tests.prod('GAUZE')),
    0::numeric, 'cancelled is not outstanding');

  -- the table guard: no update outside the engine, even for the owner
  perform tests.raises(format('update public.tbl_inv_stock_requests set status = %L where id = %s', 'SUBMITTED', req),
    'INV_ENGINE_ONLY%', 'owner update blocked');
  perform set_config('inv.posting', 'on', true);
  perform tests.raises(format('update public.tbl_inv_stock_requests set status = %L where id = %s', 'SUBMITTED', req),
    'INV_TRANSITION%', 'CANCELLED → SUBMITTED is not a transition');
  perform set_config('inv.posting', 'off', true);
end $$;

-- @test P4 request: receiving an APPROVED (not yet ordered) request, close a line short, close the request
do $$
declare
  req bigint;
  l_gloves bigint;
  l_gauze bigint;
  d jsonb;
begin
  req := (tests.ok(tests.call('amn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"GLOVES","uom":"BOX","qty":2},{"sku":"GAUZE","uom":"PACK","qty":4}]'::jsonb)),
    'create')->>'request_id')::bigint;
  select id into l_gloves from public.tbl_inv_stock_request_lines where request_id = req and product_id = tests.prod('GLOVES');
  select id into l_gauze from public.tbl_inv_stock_request_lines where request_id = req and product_id = tests.prod('GAUZE');
  perform tests.ok(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND')), 'approve');
  -- delivered before anyone marked it ordered: APPROVED → (ORDERED) → PARTIALLY_RECEIVED; FOC counts as delivered
  d := tests.ok(tests.receipt('amn', 'AMN', 'C4-1', '[{"sku":"GLOVES","uom":"BOX","qty":1,"foc_qty":1,"unit_cost":20}]',
    jsonb_build_object('stock_request_id', req)), 'receipt');
  -- gauze is still open, so the status must be PARTIALLY_RECEIVED
  perform tests.eq(d->>'request_status', 'PARTIALLY_RECEIVED', 'partial (result)');
  perform tests.eq((select status from public.tbl_inv_stock_requests where id = req), 'PARTIALLY_RECEIVED', 'partial');
  perform tests.eq((select outstanding_qty from public.v_inv_request_line_progress where line_id = l_gloves), 0::numeric, 'gloves done (FOC counted)');
  perform tests.code(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'CLOSE_LINE', 'line_id', l_gauze, 'performed_by_staff', 'AMN-HN')), 'NOTE_REQUIRED', 'reason needed');
  d := tests.ok(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'CLOSE_LINE', 'line_id', l_gauze, 'performed_by_staff', 'AMN-HN', 'note', 'supplier out of stock')), 'close gauze short');
  perform tests.eq(d->>'status', 'RECEIVED', 'nothing open left');
  perform tests.eq((select closed_short_reason from public.tbl_inv_stock_request_lines where id = l_gauze), 'supplier out of stock', 'reason');
  perform tests.code(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'CLOSE_LINE', 'line_id', l_gauze, 'performed_by_staff', 'AMN-HN', 'note', 'again')), 'REQUEST_BAD_STATUS', 'request finished');

  -- CLOSE: every open line closed short at once
  req := (tests.ok(tests.call('amn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"GAUZE","qty":30}]'::jsonb)), 'create 2')->>'request_id')::bigint;
  perform tests.ok(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND')), 'approve 2');
  perform tests.ok(tests.call('hqadmin', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'MARK_ORDERED', 'performed_by_staff', 'HQ-ND')), 'ordered 2');
  perform tests.ok(tests.receipt('amn', 'AMN', 'C4-2', '[{"sku":"GAUZE","qty":10,"unit_cost":1}]',
    jsonb_build_object('stock_request_id', req)), 'part');
  perform tests.eq((select open_request_qty from public.v_inv_suggested_order where branch_id = 1 and product_id = tests.prod('GAUZE')),
    20::numeric, '30 approved − 10 received');
  perform tests.ok(tests.call('amn', 'inv_stock_request_action', jsonb_build_object('request_id', req,
    'action', 'CLOSE', 'performed_by_staff', 'AMN-HN', 'note', 'rest not needed')), 'close');
  perform tests.eq((select status from public.tbl_inv_stock_requests where id = req), 'CLOSED', 'closed');
  perform tests.eq((select open_request_qty from public.v_inv_suggested_order where branch_id = 1 and product_id = tests.prod('GAUZE')),
    0::numeric, 'closed is not outstanding');
  perform tests.eq((select received_qty from public.v_inv_request_line_progress where request_id = req), 10::numeric, 'delivered kept');
end $$;

-- @test P4 request: a reversed receipt stops counting as delivered; a corrected receipt keeps its request link
do $$
declare
  req bigint;
  line bigint;
  r1 jsonb;
  r2 jsonb;
  c jsonb;
begin
  req := (tests.ok(tests.call('amn', 'inv_create_stock_request', jsonb_build_object('branch_id', 1,
    'requested_by_staff', 'AMN-HN', 'lines', '[{"sku":"GLOVES","qty":300}]'::jsonb)), 'create')->>'request_id')::bigint;
  line := (select id from public.tbl_inv_stock_request_lines where request_id = req);
  perform tests.ok(tests.call('hqadmin', 'inv_decide_stock_request', jsonb_build_object('request_id', req,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-ND')), 'approve');
  r1 := tests.ok(tests.receipt('amn', 'AMN', 'V4-1', '[{"sku":"GLOVES","qty":100,"unit_cost":1}]',
    jsonb_build_object('stock_request_id', req)), 'r1');
  r2 := tests.ok(tests.receipt('amn', 'AMN', 'V4-2', '[{"sku":"GLOVES","qty":100,"unit_cost":1}]',
    jsonb_build_object('stock_request_id', req)), 'r2');
  perform tests.eq((select outstanding_qty from public.v_inv_request_line_progress where line_id = line), 100::numeric, 'after two');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', r1->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse r1');
  perform tests.eq((select outstanding_qty from public.v_inv_request_line_progress where line_id = line), 200::numeric, 'voided receipt no longer delivered');
  c := tests.ok(tests.call('hqmod', 'inv_correct_receipt', jsonb_build_object('receipt_id', r2->'receipt_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_QTY', 'receipt', jsonb_build_object(
      'supplier_id', (select id from public.tbl_inv_suppliers where owner_branch_id is null), 'doc_type', 'INVOICE',
      'invoice_no', 'V4-2', 'invoice_date', tests.today(),
      'lines', tests.lines('[{"sku":"GLOVES","qty":150,"unit_cost":1}]')))), 'correct r2');
  perform tests.eq((select stock_request_id from public.tbl_inv_receipts where id = (c->>'receipt_id')::bigint), req, 'correction inherits the request');
  perform tests.eq((select outstanding_qty from public.v_inv_request_line_progress where line_id = line), 150::numeric, '300 − 150 corrected');
end $$;
