-- ============================================================================
-- General Inventory — Phase 5 SQL tests (schema/018 stock counts)
-- ============================================================================
-- Same harness and rules as inventory_v1_tests.sql: every "-- @test" block
-- runs in its own fresh session inside BEGIN … ROLLBACK on top of the fixture.
-- Fixture facts used: GLOVES max 500 Store + 100 Floor, GAUZE max 200 + 50 (so
-- both are on every STORE/FLOOR sheet), MILK/STDCOST have no max (sheet only
-- when stocked); amn = ALMA shared login (Head-Nurse tier), bmn = other branch,
-- amp = physio, hqstaff = HQ staff login (rank 0), demo = DEMO branch admin;
-- AMN-HN senior, AMN-1 junior, HQ-ND senior HQ.
-- ============================================================================

-- @test P5 count: start builds the D-123 sheet (non-zero bucket or max > 0), freeze defaults per type, one IN_PROGRESS per location
do $$
declare
  k uuid := gen_random_uuid();
  pay jsonb;
  d jsonb;
  r jsonb;
  cnt bigint;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'C1', '[{"sku":"GLOVES","qty":50,"unit_cost":1},{"sku":"MILK","qty":3,"unit_cost":25}]'), 'stock');
  pay := jsonb_build_object('location_id', tests.loc('AMN','STORE'), 'count_type', 'MONTHLY_STORE', 'counted_by_staff', 'AMN-1');
  d := tests.ok(tests.call('amn', 'inv_start_count', pay, k), 'start');
  cnt := (d->>'count_id')::bigint;
  perform tests.eq(d->>'count_no' like 'AMN-CNT-%', true, 'numbered');
  perform tests.eq((d->>'freeze_location')::boolean, true, 'monthly store freezes by default');
  perform tests.eq((d->>'line_count')::int, 3, 'GLOVES + GAUZE (max) + MILK (stocked)');
  perform tests.eq((select count(*) from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('MILK'))::int, 1, 'stocked without max');
  perform tests.eq((select count(*) from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('GAUZE'))::int, 1, 'max without stock');
  perform tests.eq((select count(*) from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('NEWPROD'))::int, 0, 'no max, no stock: not listed');
  perform tests.eq((select count(*) from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('DEMOPROD'))::int, 0, 'demo product not visible');
  perform tests.eq((select snapshot_line_id from public.tbl_inv_counts where id = cnt),
    (select max(id) from public.tbl_inv_txn_lines), 'snapshot = max posting line id');
  perform tests.eq((select count(*) from public.tbl_inv_count_lines where count_id = cnt and expected_qty is not null)::int, 0, 'blind: expected empty');
  r := tests.call('amn', 'inv_start_count', pay, k);
  perform tests.eq((r->>'replayed')::boolean, true, 'same key replays');
  perform tests.code(tests.call('amn', 'inv_start_count', pay), 'COUNT_IN_PROGRESS', 'second count on the same location');
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'WEEKLY_FLOOR', 'counted_by_staff', 'AMN-1')), 'floor start');
  perform tests.eq((d->>'freeze_location')::boolean, false, 'floor does not freeze by default');
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','TRANSIT'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1', 'freeze_location', true)), 'transit start, explicit freeze');
  perform tests.eq((d->>'line_count')::int, 0, 'empty transit sheet');
  perform tests.code(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'BOGUS', 'counted_by_staff', 'AMN-1')), 'INVALID_COUNT_TYPE', 'type');
  perform tests.code(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'BMN-1')), 'STAFF_WRONG_BRANCH', 'staff of another branch');
  perform tests.eq((select count(*) from public.tbl_inv_audit_log where entity = 'count' and action = 'COUNT_STARTED')::int, 3, 'audited');
end $$;

-- @test P5 count: freeze blocks postings to the counted location, a non-frozen count allows them, submit releases the freeze
do $$
declare
  d jsonb;
  cnt bigint;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'C2', '[{"sku":"GLOVES","qty":100,"unit_cost":1}]'), 'stock');
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'count_type', 'MONTHLY_STORE', 'counted_by_staff', 'AMN-1')), 'frozen start');
  cnt := (d->>'count_id')::bigint;
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'lines', '[{"sku":"GLOVES","qty":5,"loc":"AMN/STORE"}]'::jsonb)),
    'LOCATION_COUNT_IN_PROGRESS', 'issue from the frozen store');
  -- submit releases it
  perform tests.ok(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt, 'lines',
    (select jsonb_agg(jsonb_build_object('count_line_id', id, 'physical_qty', 0)) from public.tbl_inv_count_lines where count_id = cnt))), 'save');
  perform tests.ok(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt)), 'submit');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'lines', '[{"sku":"GLOVES","qty":5,"loc":"AMN/STORE"}]'::jsonb)), 'issue after submit');

  -- the submitted count blocks a new one until it is reviewed or cancelled
  perform tests.ok(tests.call('amn', 'inv_cancel_count', jsonb_build_object('count_id', cnt,
    'performed_by_staff', 'AMN-HN', 'reason', 'Superseded by an ad hoc recount')), 'cancel submitted');
  -- non-frozen count: postings continue
  perform tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1')), 'unfrozen start');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'lines', '[{"sku":"GLOVES","qty":5,"loc":"AMN/STORE"}]'::jsonb)), 'issue during unfrozen count');
end $$;

-- @test P5 count: blind save (expected never filled), found items, validation, replay
do $$
declare
  d jsonb;
  cnt bigint;
  l_gloves bigint;
  l_gauze bigint;
  k uuid := gen_random_uuid();
  pay jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'C3', '[{"sku":"GLOVES","qty":40,"unit_cost":1}]'), 'stock');
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'WEEKLY_FLOOR', 'counted_by_staff', 'AMN-1')), 'start');
  cnt := (d->>'count_id')::bigint;
  select id into l_gloves from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('GLOVES');
  select id into l_gauze from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('GAUZE');

  pay := jsonb_build_object('count_id', cnt, 'performed_by_staff', 'AMN-1',
    'lines', jsonb_build_array(jsonb_build_object('count_line_id', l_gloves, 'physical_qty', 7)),
    'found', jsonb_build_array(jsonb_build_object('product_id', tests.prod('MILK'), 'physical_qty', 2)));
  d := tests.ok(tests.call('amn', 'inv_save_count_lines', pay, k), 'save');
  perform tests.eq((d->>'counted')::int, 2, 'two counted');
  perform tests.eq((d->>'total')::int, 3, 'three lines');
  perform tests.eq((select count(*) from public.tbl_inv_count_lines where count_id = cnt and expected_qty is not null)::int, 0, 'still blind');
  perform tests.eq(d::text like '%expected%', false, 'response carries no expected qty');
  perform tests.eq((select is_found_item from public.tbl_inv_count_lines where id = (d->'found_line_ids'->>0)::bigint), true, 'found flag');
  perform tests.eq((tests.call('amn', 'inv_save_count_lines', pay, k)->>'replayed')::boolean, true, 'replay does not duplicate');
  perform tests.eq((select count(*) from public.tbl_inv_count_lines where count_id = cnt)::int, 3, 'no duplicate found line');

  -- clear a value
  perform tests.ok(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'lines', jsonb_build_array(jsonb_build_object('count_line_id', l_gloves, 'physical_qty', null)))), 'clear');
  perform tests.eq((select physical_qty from public.tbl_inv_count_lines where id = l_gloves), null::numeric, 'cleared');

  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'lines', jsonb_build_array(jsonb_build_object('count_line_id', l_gloves, 'physical_qty', -1)))), 'INVALID_QTY', 'negative');
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'lines', jsonb_build_array(jsonb_build_object('count_line_id', l_gloves, 'physical_qty', 1.5)))), 'QTY_NOT_INTEGRAL', 'EA is integral');
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'lines', jsonb_build_array(jsonb_build_object('count_line_id', l_gloves, 'physical_qty', 1),
                               jsonb_build_object('count_line_id', l_gloves, 'physical_qty', 2)))), 'DUPLICATE_LINE', 'same line twice');
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'lines', jsonb_build_array(jsonb_build_object('count_line_id', 999999, 'physical_qty', 1)))), 'COUNT_LINE_NOT_FOUND', 'foreign line');
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'found', jsonb_build_array(jsonb_build_object('product_id', tests.prod('MILK'), 'physical_qty', 1)))), 'DUPLICATE_LINE', 'found twice');
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'found', jsonb_build_array(jsonb_build_object('product_id', tests.prod('GLOVES'), 'physical_qty', 1)))), 'DUPLICATE_LINE', 'already on the sheet');
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'found', jsonb_build_array(jsonb_build_object('product_id', tests.prod('SVC'), 'physical_qty', 1)))), 'NOT_STOCK_ITEM', 'no services');
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'found', jsonb_build_array(jsonb_build_object('product_id', tests.prod('DEMOPROD'), 'physical_qty', 1)))), 'PRODUCT_NOT_FOUND', 'demo product in a real branch');
  -- a rejected batch leaves nothing behind (first line valid, second invalid)
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'lines', jsonb_build_array(jsonb_build_object('count_line_id', l_gauze, 'physical_qty', 9),
                               jsonb_build_object('count_line_id', l_gloves, 'physical_qty', -3)))), 'INVALID_QTY', 'atomic');
  perform tests.eq((select physical_qty from public.tbl_inv_count_lines where id = l_gauze), null::numeric, 'rejected batch wrote nothing');
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt, 'performed_by_staff', 'BMN-1')),
    'STAFF_WRONG_BRANCH', 'staff scope');
end $$;

-- @test P5 count: submit — incomplete rejected, expected and posted_since_start split at the snapshot on an unfrozen location
do $$
declare
  d jsonb;
  cnt bigint;
  l_gloves bigint;
  l_gauze bigint;
  l_milk bigint;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'C4', '[{"sku":"GLOVES","qty":100,"unit_cost":1},{"sku":"MILK","qty":4,"unit_cost":25}]'), 'stock');
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1', 'freeze_location', false)), 'start');
  cnt := (d->>'count_id')::bigint;
  select id into l_gloves from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('GLOVES');
  select id into l_gauze from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('GAUZE');
  select id into l_milk from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('MILK');

  perform tests.code(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt)), 'COUNT_INCOMPLETE', 'nothing counted');
  -- postings after the start (unfrozen): +30 gloves, −1 milk
  perform tests.ok(tests.receipt('amn', 'AMN', 'C4B', '[{"sku":"GLOVES","qty":30,"unit_cost":1}]'), 'post-start receipt');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'lines', '[{"sku":"MILK","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'post-start issue');

  d := tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt, 'lines', jsonb_build_array(
    jsonb_build_object('count_line_id', l_gloves, 'physical_qty', 95), jsonb_build_object('count_line_id', l_gauze, 'physical_qty', 0))));
  perform tests.ok(d, 'partial save');
  d := tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt));
  perform tests.code(d, 'COUNT_INCOMPLETE', 'milk missing');
  perform tests.eq(d->'data'->'missing', jsonb_build_array(l_milk), 'names the missing line');
  perform tests.ok(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt, 'lines', jsonb_build_array(
    jsonb_build_object('count_line_id', l_milk, 'physical_qty', 4)))), 'save milk');

  d := tests.ok(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt)), 'submit');
  perform tests.eq(d->>'status', 'SUBMITTED', 'submitted');
  perform tests.eq((d->>'variance_lines')::int, 1, 'only gloves (−5); gauze and milk are 0');
  perform tests.eq((select expected_qty from public.tbl_inv_count_lines where id = l_gloves), 100::numeric, 'gloves expected at snapshot');
  perform tests.eq((select posted_since_start from public.tbl_inv_count_lines where id = l_gloves), 30::numeric, 'gloves posted since start');
  perform tests.eq((select variance_qty from public.tbl_inv_count_lines where id = l_gloves), -5::numeric, 'variance = physical − expected');
  perform tests.eq((select expected_qty || '/' || posted_since_start || '/' || variance_qty from public.tbl_inv_count_lines where id = l_milk),
    '4.0000/-1.0000/0.0000', 'milk: expected 4, −1 posted since, physical 4');
  perform tests.eq((select expected_qty from public.tbl_inv_count_lines where id = l_gauze), 0::numeric, 'no stock, expected 0');
  perform tests.eq((select status from public.tbl_inv_counts where id = cnt), 'SUBMITTED', 'status');
  perform tests.eq(tests.bucket('AMN','STORE','GLOVES'), 130::numeric, 'a count never posts stock');
  perform tests.code(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt)), 'COUNT_BAD_STATUS', 'only once');
  perform tests.code(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt)), 'COUNT_BAD_STATUS', 'no edits after submit');
end $$;

-- @test P5 review: variance becomes ONE PENDING adjustment with delta = variance, linked to the count; SoD warning; approval posts the delta
do $$
declare
  d jsonb;
  a jsonb;
  cnt bigint;
  adj bigint;
  l_gloves bigint;
  l_gauze bigint;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'C5', '[{"sku":"GLOVES","qty":100,"unit_cost":1},{"sku":"GAUZE","qty":20,"unit_cost":2}]'), 'stock');
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'count_type', 'MONTHLY_STORE', 'counted_by_staff', 'AMN-HN')), 'start');
  cnt := (d->>'count_id')::bigint;
  select id into l_gloves from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('GLOVES');
  select id into l_gauze from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('GAUZE');
  perform tests.ok(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt, 'lines', jsonb_build_array(
    jsonb_build_object('count_line_id', l_gloves, 'physical_qty', 92), jsonb_build_object('count_line_id', l_gauze, 'physical_qty', 20)),
    'found', jsonb_build_array(jsonb_build_object('product_id', tests.prod('MILK'), 'physical_qty', 3)))), 'save');
  perform tests.ok(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt)), 'submit');
  perform tests.code(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'), 'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1')),
    'COUNT_IN_PROGRESS', 'no new count while one awaits review');

  perform tests.code(tests.call('amn', 'inv_review_count', jsonb_build_object('count_id', cnt, 'performed_by_staff', 'AMN-1')),
    'STAFF_NOT_SENIOR', 'junior performer');
  perform tests.code(tests.call('amn', 'inv_review_count', jsonb_build_object('count_id', cnt, 'performed_by_staff', 'AMN-HN')),
    'JUSTIFICATION_REQUIRED', 'summary needed with variances');
  perform tests.eq((select status from public.tbl_inv_counts where id = cnt), 'SUBMITTED', 'still submitted');

  a := tests.ok(tests.call('amn', 'inv_review_count', jsonb_build_object('count_id', cnt, 'performed_by_staff', 'AMN-HN',
    'summary', 'Recounted twice, 8 gloves short and 3 milk tins found on the shelf',
    'notes', jsonb_build_array(jsonb_build_object('count_line_id', l_gloves, 'note', 'recounted'))
    )), 'review');
  adj := (a->>'adjustment_id')::bigint;
  perform tests.eq(a->>'status', 'CLOSED', 'closed');
  perform tests.eq(a->>'warning', 'SOD_SAME_STAFF', 'counter = reviewer warns');
  perform tests.eq(a->>'adjustment_no' like 'AMN-ADJ-%', true, 'adjustment numbered');
  perform tests.eq((select status || '|' || reason_code || '|' || count_id || '|' || requested_by_staff
                      from public.tbl_inv_adjustments where id = adj), 'PENDING|COUNT_VARIANCE|' || cnt || '|AMN-HN', 'pending, linked');
  perform tests.eq((select count(*) from public.tbl_inv_adjustment_lines where adjustment_id = adj)::int, 2, 'one line per variance (gauze is 0)');
  perform tests.eq((select qty_delta_base from public.tbl_inv_adjustment_lines where adjustment_id = adj and product_id = tests.prod('GLOVES')),
    -8::numeric, 'delta = physical − expected');
  perform tests.eq((select qty_delta_base from public.tbl_inv_adjustment_lines where adjustment_id = adj and product_id = tests.prod('MILK')),
    3::numeric, 'found item delta');
  perform tests.eq((select count_line_id from public.tbl_inv_adjustment_lines where adjustment_id = adj and product_id = tests.prod('GLOVES')),
    l_gloves, 'line linked');
  perform tests.eq((select investigation_note from public.tbl_inv_count_lines where id = l_gloves), 'recounted', 'note saved');
  perform tests.eq((select investigated_by_staff || '|' || status from public.tbl_inv_counts where id = cnt), 'AMN-HN|CLOSED', 'count closed by reviewer');
  perform tests.eq(tests.bucket('AMN','STORE','GLOVES'), 100::numeric, 'nothing posted before approval');
  perform tests.code(tests.call('amn', 'inv_review_count', jsonb_build_object('count_id', cnt, 'performed_by_staff', 'AMN-HN')),
    'COUNT_BAD_STATUS', 'reviewed once');
  perform tests.code(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'), 'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1')),
    'COUNT_ADJUSTMENT_PENDING', 'no new count while its adjustment is pending');

  -- approval reuses the Phase 3 RPC
  perform tests.ok(tests.call('hqmod', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', adj,
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-1')), 'approve');
  perform tests.eq(tests.bucket('AMN','STORE','GLOVES'), 92::numeric, 'approved delta posted');
  perform tests.eq(tests.bucket('AMN','STORE','MILK'), 3::numeric, 'found item posted');
  perform tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'), 'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1')), 'next count allowed after approval');
end $$;

-- @test P5 review: zero variance creates no adjustment; request_adjustment=false creates none; different staff = no warning
do $$
declare
  d jsonb;
  cnt bigint;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'C6', '[{"sku":"GLOVES","qty":10,"unit_cost":1}]'), 'stock');
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'WEEKLY_FLOOR', 'counted_by_staff', 'AMN-1')), 'start');
  cnt := (d->>'count_id')::bigint;
  perform tests.ok(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'lines', (select jsonb_agg(jsonb_build_object('count_line_id', id, 'physical_qty', 0)) from public.tbl_inv_count_lines where count_id = cnt))), 'save');
  perform tests.ok(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt)), 'submit');
  d := tests.ok(tests.call('amn', 'inv_review_count', jsonb_build_object('count_id', cnt, 'performed_by_staff', 'AMN-HN')), 'review, no summary needed');
  perform tests.eq(d->>'adjustment_id', null, 'no adjustment');
  perform tests.eq(d->>'warning', null, 'no warning: different staff');
  perform tests.eq((select count(*) from public.tbl_inv_adjustments)::int, 0, 'none created');

  -- with variance but adjustment declined
  perform tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1')), 'second start');
  cnt := (select id from public.tbl_inv_counts where status = 'IN_PROGRESS');
  perform tests.ok(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'lines', (select jsonb_agg(jsonb_build_object('count_line_id', id, 'physical_qty', 3)) from public.tbl_inv_count_lines where count_id = cnt))), 'save');
  perform tests.ok(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt)), 'submit');
  d := tests.ok(tests.call('amn', 'inv_review_count', jsonb_build_object('count_id', cnt, 'performed_by_staff', 'AMN-HN',
    'summary', 'Shelf was reorganised, will recount', 'request_adjustment', false)), 'review without adjustment');
  perform tests.eq(d->>'adjustment_id', null, 'declined');
  perform tests.eq((select count(*) from public.tbl_inv_adjustments)::int, 0, 'still none');
end $$;

-- @test P5 count: cancel rules and the tier / scope checks
do $$
declare
  d jsonb;
  cnt bigint;
  cnt2 bigint;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'C7', '[{"sku":"GLOVES","qty":10,"unit_cost":1}]'), 'stock');
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'count_type', 'MONTHLY_STORE', 'counted_by_staff', 'AMN-1')), 'start');
  cnt := (d->>'count_id')::bigint;

  -- scope / tier
  perform tests.code(tests.call('bmn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt)), 'FORBIDDEN', 'other branch');
  perform tests.code(tests.call('bmn', 'inv_submit_count', jsonb_build_object('count_id', cnt)), 'FORBIDDEN', 'other branch submit');
  perform tests.code(tests.call('bmn', 'inv_cancel_count', jsonb_build_object('count_id', cnt, 'reason', 'not mine at all')), 'FORBIDDEN', 'other branch cancel');
  perform tests.code(tests.call('bmn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'BMN-1')), 'FORBIDDEN', 'other branch start');
  perform tests.code(tests.call('amp', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1')), 'FORBIDDEN', 'physio login');
  perform tests.code(tests.call('hqstaff', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1')), 'FORBIDDEN', 'HQ staff login performs nothing');
  perform tests.code(tests.call('demo', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'DEMO-1')), 'FORBIDDEN', 'demo into a real branch');
  perform tests.code(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', 999999,
    'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1')), 'FORBIDDEN', 'unknown location');
  perform tests.code(tests.call('amn', 'inv_review_count', jsonb_build_object('count_id', cnt, 'performed_by_staff', 'AMN-HN')),
    'COUNT_BAD_STATUS', 'cannot review an IN_PROGRESS count');

  -- cancel IN_PROGRESS by the counting login, reason required
  perform tests.code(tests.call('amn', 'inv_cancel_count', jsonb_build_object('count_id', cnt)), 'JUSTIFICATION_REQUIRED', 'reason');
  perform tests.ok(tests.call('amn', 'inv_cancel_count', jsonb_build_object('count_id', cnt, 'reason', 'Started on the wrong day')), 'cancel');
  perform tests.eq((select status || '|' || investigation_summary from public.tbl_inv_counts where id = cnt), 'CANCELLED|Started on the wrong day', 'cancelled');
  perform tests.code(tests.call('amn', 'inv_cancel_count', jsonb_build_object('count_id', cnt, 'reason', 'twice is one too many')), 'COUNT_BAD_STATUS', 'terminal');
  -- freeze is gone, a new count may start
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'AMN-1')), 'restart');
  cnt2 := (d->>'count_id')::bigint;
  perform tests.ok(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt2,
    'lines', (select jsonb_agg(jsonb_build_object('count_line_id', id, 'physical_qty', 1)) from public.tbl_inv_count_lines where count_id = cnt2))), 'save');
  perform tests.ok(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt2)), 'submit');
  -- SUBMITTED needs a senior performer
  perform tests.code(tests.call('amn', 'inv_cancel_count', jsonb_build_object('count_id', cnt2, 'reason', 'wrong sheet used')),
    'STAFF_REQUIRED', 'staff required for a submitted count');
  perform tests.code(tests.call('amn', 'inv_cancel_count', jsonb_build_object('count_id', cnt2, 'reason', 'wrong sheet used',
    'performed_by_staff', 'AMN-1')), 'STAFF_NOT_SENIOR', 'junior cannot cancel a submitted count');
  perform tests.ok(tests.call('amn', 'inv_cancel_count', jsonb_build_object('count_id', cnt2, 'reason', 'wrong sheet used',
    'performed_by_staff', 'AMN-HN')), 'senior cancels submitted');
  perform tests.eq((select status from public.tbl_inv_counts where id = cnt2), 'CANCELLED', 'cancelled after submit');
  perform tests.eq((select count(*) from public.tbl_inv_audit_log where entity = 'count' and action = 'COUNT_CANCELLED')::int, 2, 'audited');
end $$;

-- @test P5 count: replay of review/cancel/submit is idempotent; DEMO branch counts in isolation
do $$
declare
  d jsonb;
  cnt bigint;
  k uuid := gen_random_uuid();
  pay jsonb;
  dcnt bigint;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'C8', '[{"sku":"GLOVES","qty":10,"unit_cost":1}]'), 'stock');
  d := tests.ok(tests.call('amn', 'inv_start_count', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'count_type', 'WEEKLY_FLOOR', 'counted_by_staff', 'AMN-1')), 'start');
  cnt := (d->>'count_id')::bigint;
  perform tests.ok(tests.call('amn', 'inv_save_count_lines', jsonb_build_object('count_id', cnt,
    'lines', (select jsonb_agg(jsonb_build_object('count_line_id', id, 'physical_qty', 1)) from public.tbl_inv_count_lines where count_id = cnt))), 'save');
  perform tests.ok(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt), k), 'submit');
  perform tests.eq((tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', cnt), k)->>'replayed')::boolean, true, 'submit replays');
  pay := jsonb_build_object('count_id', cnt, 'performed_by_staff', 'AMN-HN', 'summary', 'Everything was on the wrong shelf');
  k := gen_random_uuid();
  d := tests.ok(tests.call('amn', 'inv_review_count', pay, k), 'review');
  perform tests.eq((tests.call('amn', 'inv_review_count', pay, k)->>'replayed')::boolean, true, 'review replays');
  perform tests.eq((select count(*) from public.tbl_inv_adjustments where count_id = cnt)::int, 1, 'exactly one adjustment');

  -- DEMO: own locations, own products; AMN cannot touch the demo count and vice versa
  d := tests.ok(tests.call('demo', 'inv_start_count', jsonb_build_object('location_id', tests.loc('DEMO','STORE'),
    'count_type', 'AD_HOC', 'counted_by_staff', 'DEMO-1')), 'demo start');
  dcnt := (d->>'count_id')::bigint;
  perform tests.ok(tests.call('demo', 'inv_save_count_lines', jsonb_build_object('count_id', dcnt,
    'found', jsonb_build_array(jsonb_build_object('product_id', tests.prod('DEMOPROD'), 'physical_qty', 2)))), 'demo product found');
  perform tests.code(tests.call('amn', 'inv_submit_count', jsonb_build_object('count_id', dcnt)), 'FORBIDDEN', 'real login cannot see a demo count');
  perform tests.code(tests.call('demo', 'inv_submit_count', jsonb_build_object('count_id', cnt)), 'FORBIDDEN', 'demo login cannot see a real count');
  perform tests.eq((select count(*) from public.tbl_inv_count_lines where count_id = cnt and product_id = tests.prod('DEMOPROD'))::int, 0, 'real sheet has no demo product');
end $$;
