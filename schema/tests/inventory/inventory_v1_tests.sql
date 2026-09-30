-- ============================================================================
-- General Inventory — Phase 1 SQL test suite
-- ============================================================================
-- Each "-- @test <name>" block runs in its own BEGIN … ROLLBACK on top of
-- 00_supabase_stub.sql + schema/007…012 + 01_fixture.sql
-- (runner: webapp/scripts/test-inventory.mjs, `npm run test:inventory`).
-- The blocks are plain SQL, so they also run with psql on a local Supabase
-- stack (wrap each in BEGIN … ROLLBACK). Never run them against production.
-- ============================================================================

-- @test seed: 5 categories, S/F/T only for AMN/BMN/BGN/DEMO, none for HQ or physio
do $$
begin
  perform tests.eq((select count(*) from public.tbl_inv_categories)::int, 5, 'category count');
  perform tests.eq((select count(*) from public.tbl_inv_categories where is_service)::int, 1, 'one service category');
  perform tests.eq((select string_agg(code, ',' order by sort_order) from public.tbl_inv_categories),
                   'CONSUMABLES,DRESSING,MEDICINE,SERVICE,OTHERS', 'category codes');
  perform tests.eq((select count(*) from public.tbl_inv_locations)::int, 12, 'location count');
  perform tests.eq((select count(*) from public.tbl_inv_locations where branch_id in (2, 5))::int, 0, 'no HQ/AMP locations');
  perform tests.raises($q$insert into public.tbl_inv_locations (branch_id, kind, name) values (2, 'STORE', 'x')$q$,
                       '%only for NUR branches%', 'PHY branch cannot get a location');
  perform tests.raises($q$insert into public.tbl_inv_branch_settings (branch_id) values (5)$q$,
                       '%only for NUR branches%', 'HQ cannot get settings');
end $$;

-- @test WAC maths (§5.4): rounding residue, negative true-up, PENDING_COST true-up
do $$
declare
  r record;
  v numeric := 10; q numeric := 3;
begin
  -- 3 units worth 10.00: -3.3333, -3.3333, then the last unit clears -3.3334
  select * into r from public.fn_inv_pool_out_wac(q, v, 3.333333, -1); perform tests.eq(r.value, -3.3333, 'issue 1'); q := r.q; v := r.v;
  select * into r from public.fn_inv_pool_out_wac(q, v, 3.333333, -1); perform tests.eq(r.value, -3.3333, 'issue 2'); q := r.q; v := r.v;
  select * into r from public.fn_inv_pool_out_wac(q, v, 3.333333, -1); perform tests.eq(r.value, -3.3334, 'issue 3 takes residue');
  perform tests.eq(r.v, 0::numeric, 'V ends at exactly 0');
  -- Q 5 V 5.50: issue 8 → Q -3 V -3.30; receipt 10 @ 1.30 → W 1.30 V 9.10 reval -0.60
  select * into r from public.fn_inv_pool_out_wac(5, 5.50, 1.10, -8);
  perform tests.eq(r.v, -3.30::numeric, 'negative V = Q x W (I2)');
  select * into r from public.fn_inv_pool_in(-3, -3.30, 1.10, 10, 13.00);
  perform tests.eq(r.w, 1.30::numeric, 'W reset to incoming cost');
  perform tests.eq(r.v, 9.10::numeric, 'V after true-up');
  perform tests.eq(r.reval, -0.60::numeric, 'revaluation');
  -- PENDING_COST: issue 3 at 0 → Q -3 V 0; receipt 10 @ 2.00 → V 14, reval -6
  select * into r from public.fn_inv_pool_in(-3, 0, null, 10, 20.00);
  perform tests.eq(r.v, 14::numeric, 'pending true-up V');
  perform tests.eq(r.reval, -6::numeric, 'pending true-up reval = consumed cost');
end $$;

-- @test WAC: receipts 100 @ 1.00 + 100 @ 1.20 = 1.10
do $$
declare
  p public.tbl_inv_cost_pools;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'INV-1', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]'), 'R1');
  perform tests.ok(tests.receipt('amn', 'AMN', 'INV-2', '[{"sku":"GLOVES","qty":100,"unit_cost":1.20}]'), 'R2');
  p := tests.pool('AMN', 'GLOVES');
  perform tests.eq(p.qty, 200::numeric, 'Q');
  perform tests.eq(p.value, 220::numeric, 'V');
  perform tests.eq(p.wac, 1.10::numeric, 'W = 1.10');
  perform tests.eq(tests.bucket('AMN', 'STORE', 'GLOVES'), 200::numeric, 'store bucket');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'caches agree with ledger');
end $$;

-- @test WAC: purchase UOM conversion (2 BOX of 100 @ 110.00/box = 200 EA @ 1.10)
do $$
declare
  d jsonb;
begin
  d := tests.ok(tests.receipt('amn', 'AMN', 'INV-BOX', '[{"sku":"GLOVES","uom":"BOX","qty":2,"unit_cost":110.00}]'), 'box receipt');
  perform tests.eq(tests.bucket('AMN', 'STORE', 'GLOVES'), 200::numeric, 'base qty');
  perform tests.eq((tests.pool('AMN', 'GLOVES')).wac, 1.10::numeric, 'W per base');
  perform tests.eq((select unit_cost from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint), 1.10::numeric, 'line unit cost per base');
end $$;

-- @test landed cost: tax + delivery - discount spread pro-rata; FOC dilutes WAC
do $$
declare
  d jsonb;
begin
  d := tests.ok(tests.receipt('amn', 'AMN', 'INV-LC',
         '[{"sku":"GLOVES","qty":100,"unit_cost":1.00},{"sku":"GAUZE","qty":50,"unit_cost":1.00}]',
         '{"tax_total":9.00,"other_charges_total":6.00,"discount_total":3.00}'), 'landed receipt');
  perform tests.eq((select landed_value from public.tbl_inv_receipt_lines where receipt_id = (d->>'receipt_id')::bigint and line_no = 1), 108::numeric, 'line A landed');
  perform tests.eq((select landed_value from public.tbl_inv_receipt_lines where receipt_id = (d->>'receipt_id')::bigint and line_no = 2), 54::numeric, 'line B landed');
  perform tests.eq((select landed_total from public.tbl_inv_receipts where id = (d->>'receipt_id')::bigint), 162::numeric, 'landed total');
  -- FOC: 10 paid @ 1.20 + 1 free → qty 11, value 12.00, unit 1.090909
  d := tests.ok(tests.receipt('amn', 'AMN', 'INV-FOC', '[{"sku":"MILK","qty":10,"foc_qty":1,"unit_cost":1.20}]'), 'FOC receipt');
  perform tests.eq((tests.pool('AMN', 'MILK')).qty, 11::numeric, 'FOC qty');
  perform tests.eq((tests.pool('AMN', 'MILK')).value, 12::numeric, 'FOC value');
  perform tests.eq((tests.pool('AMN', 'MILK')).wac, 1.090909::numeric, 'FOC-diluted WAC');
end $$;

-- @test §5.4 sequence: internal S→F, issue, branch transfer out/in at source WAC
do $$
declare
  d jsonb;
  v_out jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'A1', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]'), 'R1');
  perform tests.ok(tests.receipt('amn', 'AMN', 'A2', '[{"sku":"GLOVES","qty":100,"unit_cost":1.20}]'), 'R2');
  perform tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'INTERNAL',
    'from_location_id', tests.loc('AMN','STORE'), 'to_location_id', tests.loc('AMN','FLOOR'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":50}]'::jsonb)), 'S→F 50');
  perform tests.eq((tests.pool('AMN','GLOVES')).value, 220::numeric, 'internal move keeps pool value');
  perform tests.eq(tests.bucket('AMN','FLOOR','GLOVES'), 50::numeric, 'floor bucket');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"GLOVES","qty":30,"loc":"AMN/FLOOR"}]'::jsonb)), 'issue 30');
  perform tests.eq((select value from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint), -33::numeric, 'issue value at WAC');
  perform tests.eq((select cost_source from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint), 'WAC', 'cost source');
  -- BGN has its own pool: 40 @ 1.30
  perform tests.ok(tests.receipt('bgn', 'BGN', 'B1', '[{"sku":"GLOVES","qty":40,"unit_cost":1.30}]'), 'BGN receipt');
  v_out := tests.ok(tests.call('amn', 'inv_dispatch_branch_transfer', jsonb_build_object(
    'from_location_id', tests.loc('AMN','STORE'), 'to_branch_id', tests.branch('BGN'), 'txn_date', tests.today(),
    'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":20}]'::jsonb)), 'dispatch 20');
  perform tests.eq((tests.pool('AMN','GLOVES')).qty, 150::numeric, 'AMN Q after dispatch');
  perform tests.eq((tests.pool('AMN','GLOVES')).value, 165::numeric, 'AMN V after dispatch');
  perform tests.ok(tests.call('bgn', 'inv_receive_branch_transfer', jsonb_build_object(
    'transfer_id', v_out->'transfer_id', 'txn_date', tests.today(), 'performed_by_staff', 'BGN-HN')), 'receive');
  perform tests.eq((tests.pool('BGN','GLOVES')).qty, 60::numeric, 'BGN Q');
  perform tests.eq((tests.pool('BGN','GLOVES')).value, 74::numeric, 'BGN V');
  perform tests.eq((tests.pool('BGN','GLOVES')).wac, 1.233333::numeric, 'BGN W');
  perform tests.eq((select status from public.tbl_inv_branch_transfers where id = (v_out->>'transfer_id')::bigint), 'RECEIVED', 'status');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)) + jsonb_array_length(public.fn_inv_verify_balances(4)), 0, 'caches clean');
end $$;

-- @test branch transfer: receive once, reverse the receive, re-receive; cancel only while dispatched
do $$
declare
  t1 jsonb;
  t2 jsonb;
  rcv jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'A1', '[{"sku":"GAUZE","qty":100,"unit_cost":2.00}]'), 'stock');
  t1 := tests.ok(tests.call('amn', 'inv_dispatch_branch_transfer', jsonb_build_object(
    'from_location_id', tests.loc('AMN','STORE'), 'to_branch_id', tests.branch('BMN'), 'txn_date', tests.today(),
    'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GAUZE","qty":10}]'::jsonb)), 'dispatch');
  -- the source branch cannot receive at the destination
  perform tests.code(tests.call('amn', 'inv_receive_branch_transfer', jsonb_build_object(
    'transfer_id', t1->'transfer_id', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1')), 'FORBIDDEN', 'amn cannot receive for BMN');
  rcv := tests.ok(tests.call('bmn', 'inv_receive_branch_transfer', jsonb_build_object(
    'transfer_id', t1->'transfer_id', 'txn_date', tests.today(), 'performed_by_staff', 'BMN-1')), 'receive');
  perform tests.code(tests.call('bmn', 'inv_receive_branch_transfer', jsonb_build_object(
    'transfer_id', t1->'transfer_id', 'txn_date', tests.today(), 'performed_by_staff', 'BMN-1')), 'TRANSFER_NOT_DISPATCHED', 'no double receive');
  perform tests.code(tests.call('amn', 'inv_cancel_branch_transfer', jsonb_build_object(
    'transfer_id', t1->'transfer_id', 'performed_by_staff', 'AMN-HN', 'reason_code', 'OTHER')), 'TRANSFER_NOT_CANCELLABLE', 'no cancel after receipt');
  -- MOD reverses the receive → DISPATCHED again → re-receive is a new receipt row
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', rcv->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_QTY')), 'reverse receive');
  perform tests.eq((select status from public.tbl_inv_branch_transfers where id = (t1->>'transfer_id')::bigint), 'DISPATCHED', 'back to dispatched');
  perform tests.eq(tests.bucket('BMN','STORE','GAUZE'), 0::numeric, 'BMN stock gone again');
  perform tests.ok(tests.call('bmn', 'inv_receive_branch_transfer', jsonb_build_object(
    'transfer_id', t1->'transfer_id', 'txn_date', tests.today(), 'performed_by_staff', 'BMN-1')), 're-receive');
  perform tests.eq((select count(*) from public.tbl_inv_branch_transfer_receipts where transfer_id = (t1->>'transfer_id')::bigint)::int, 2, 'append-only receive rows');
  perform tests.eq(tests.bucket('BMN','STORE','GAUZE'), 10::numeric, 'BMN stock');
  -- cancel path: source Head Nurse, restores stock and value
  t2 := tests.ok(tests.call('amn', 'inv_dispatch_branch_transfer', jsonb_build_object(
    'from_location_id', tests.loc('AMN','STORE'), 'to_branch_id', tests.branch('BMN'), 'txn_date', tests.today(),
    'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GAUZE","qty":5}]'::jsonb)), 'dispatch 2');
  perform tests.code(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', t2->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'OTHER')), 'USE_CANCEL_TRANSFER', 'OUT is cancelled, not reversed');
  perform tests.code(tests.call('amn', 'inv_cancel_branch_transfer', jsonb_build_object(
    'transfer_id', t2->'transfer_id', 'performed_by_staff', 'AMN-1', 'reason_code', 'OTHER')), 'STAFF_NOT_SENIOR', 'cancel needs a senior staff member');
  perform tests.ok(tests.call('amn', 'inv_cancel_branch_transfer', jsonb_build_object(
    'transfer_id', t2->'transfer_id', 'performed_by_staff', 'AMN-HN', 'reason_code', 'WRONG_QTY')), 'cancel');
  perform tests.eq((select status from public.tbl_inv_branch_transfers where id = (t2->>'transfer_id')::bigint), 'CANCELLED', 'cancelled');
  perform tests.eq(tests.bucket('AMN','STORE','GAUZE'), 90::numeric, 'AMN stock restored');
  perform tests.eq((tests.pool('AMN','GAUZE')).value, 180::numeric, 'AMN value restored');
  -- destination rules
  perform tests.code(tests.call('amn', 'inv_dispatch_branch_transfer', jsonb_build_object(
    'from_location_id', tests.loc('AMN','STORE'), 'to_branch_id', tests.branch('DEMO'), 'txn_date', tests.today(),
    'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GAUZE","qty":1}]'::jsonb)), 'INVALID_DESTINATION', 'real → demo refused');
  perform tests.code(tests.call('amn', 'inv_dispatch_branch_transfer', jsonb_build_object(
    'from_location_id', tests.loc('AMN','STORE'), 'to_branch_id', tests.branch('AMP'), 'txn_date', tests.today(),
    'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GAUZE","qty":1}]'::jsonb)), 'INVALID_DESTINATION', 'physio refused');
end $$;

-- @test negative stock: confirm round-trip, nothing written until confirmed, true-up on receipt
do $$
declare
  k uuid := gen_random_uuid();
  n_before int;
  d jsonb;
  p public.tbl_inv_cost_pools;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'N1', '[{"sku":"GAUZE","qty":5,"unit_cost":1.10}]'), 'stock 5 @ 1.10');
  n_before := (select count(*) from public.tbl_inv_txns);
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'expense_note', 'ward', 'lines', '[{"sku":"GAUZE","qty":8,"loc":"AMN/STORE"}]'::jsonb), k), 'NEGATIVE_STOCK_CONFIRM', 'warns');
  perform tests.eq((select count(*) from public.tbl_inv_txns)::int, n_before, 'nothing posted on the warning');
  -- same key, now confirmed (flags are outside the request hash)
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'expense_note', 'ward', 'allow_negative', true, 'lines', '[{"sku":"GAUZE","qty":8,"loc":"AMN/STORE"}]'::jsonb), k), 'confirmed');
  perform tests.eq((select negative_stock_confirmed from public.tbl_inv_txns where id = (d->>'txn_id')::bigint), true, 'flag recorded');
  p := tests.pool('AMN', 'GAUZE');
  perform tests.eq(p.qty, -3::numeric, 'Q -3');
  perform tests.eq(p.value, -3.30::numeric, 'V = Q x W');
  perform tests.ok(tests.receipt('amn', 'AMN', 'N2', '[{"sku":"GAUZE","qty":10,"unit_cost":1.30}]'), 'receipt 10 @ 1.30');
  p := tests.pool('AMN', 'GAUZE');
  perform tests.eq(p.wac, 1.30::numeric, 'W reset');
  perform tests.eq(p.value, 9.10::numeric, 'V');
  perform tests.eq((select revaluation_value from public.tbl_inv_txn_lines where id = p.last_line_id), -0.60::numeric, 'true-up reval on the receipt line');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'I1 holds');
end $$;

-- @test PENDING_COST and MASTER_FALLBACK outflows
do $$
declare
  d jsonb;
begin
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'allow_negative', true, 'lines', '[{"sku":"NEWPROD","qty":3,"loc":"AMN/FLOOR"}]'::jsonb)), 'pending');
  perform tests.eq((select cost_source from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint), 'PENDING_COST', 'pending cost');
  perform tests.eq((select value from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint), 0::numeric, 'value 0');
  perform tests.eq((tests.pool('AMN','NEWPROD')).wac, null::numeric, 'W stays unknown');
  perform tests.ok(tests.receipt('amn', 'AMN', 'P1', '[{"sku":"NEWPROD","qty":10,"unit_cost":2.00}]'), 'first receipt');
  perform tests.eq((tests.pool('AMN','NEWPROD')).value, 14::numeric, 'V after true-up');
  perform tests.eq((select sum(revaluation_value) from public.tbl_inv_txn_lines where product_id = tests.prod('NEWPROD')), -6::numeric, 'consumed cost as variance');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'allow_negative', true, 'lines', '[{"sku":"STDCOST","qty":2,"loc":"AMN/STORE"}]'::jsonb)), 'fallback');
  perform tests.eq((select cost_source || ':' || unit_cost::numeric(10,2) from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint),
                   'MASTER_FALLBACK:2.00', 'standard cost fallback');
end $$;

-- @test Transit: allocate, issue only to the same resident, release (senior, fixed reasons), never negative
do $$
declare
  d jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'T1', '[{"sku":"MILK","qty":10,"unit_cost":20.00}]'), 'stock');
  perform tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'ALLOCATE',
    'from_location_id', tests.loc('AMN','STORE'), 'to_location_id', tests.loc('AMN','TRANSIT'), 'resident_id', tests.res('R1'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":5}]'::jsonb)), 'allocate 5 to R1');
  perform tests.eq(tests.bucket('AMN','TRANSIT','MILK','R1'), 5::numeric, 'T[R1]');
  perform tests.eq((tests.pool('AMN','MILK')).value, 200::numeric, 'allocation keeps pool value');
  -- another resident / OSEM expense cannot draw on T[R1]
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R2'), 'allow_negative', true, 'lines', '[{"sku":"MILK","qty":1,"loc":"AMN/TRANSIT"}]'::jsonb)),
    'TRANSIT_NEGATIVE', 'R2 has no Transit stock (hard block even with allow_negative)');
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'lines', '[{"sku":"MILK","qty":1,"loc":"AMN/TRANSIT"}]'::jsonb)), 'TRANSIT_ISSUE_RESIDENT_ONLY', 'no OSEM expense from Transit');
  perform tests.code(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'INTERNAL',
    'from_location_id', tests.loc('AMN','TRANSIT'), 'to_location_id', tests.loc('AMN','FLOOR'), 'resident_id', tests.res('R1'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":1}]'::jsonb)), 'INVALID_LOCATIONS', 'no generic move out of Transit');
  perform tests.code(tests.call('amn', 'inv_dispatch_branch_transfer', jsonb_build_object(
    'from_location_id', tests.loc('AMN','TRANSIT'), 'to_branch_id', tests.branch('BMN'), 'txn_date', tests.today(),
    'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":1}]'::jsonb)), 'INVALID_LOCATIONS', 'no branch transfer out of Transit');
  -- R1 consumes 3 from T[R1]; charged at the catalogue price (Q-28)
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'lines', '[{"sku":"MILK","qty":3,"loc":"AMN/TRANSIT"}]'::jsonb)), 'issue from T[R1]');
  perform tests.eq((select charge_amount from public.tbl_inv_charges where txn_id = (d->>'txn_id')::bigint), 90.00::numeric, 'charged 3 x 30.00');
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'allow_negative', true, 'lines', '[{"sku":"MILK","qty":3,"loc":"AMN/TRANSIT"}]'::jsonb)),
    'TRANSIT_NEGATIVE', 'Transit never negative');
  -- release: Head-Nurse tier, fixed reasons, senior staff member
  perform tests.code(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'RELEASE',
    'from_location_id', tests.loc('AMN','TRANSIT'), 'to_location_id', tests.loc('AMN','STORE'), 'resident_id', tests.res('R1'),
    'reason_code', 'DISCHARGED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":1}]'::jsonb)),
    'STAFF_NOT_SENIOR', 'release attributed to a staff nurse is refused');
  perform tests.code(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'RELEASE',
    'from_location_id', tests.loc('AMN','TRANSIT'), 'to_location_id', tests.loc('AMN','STORE'), 'resident_id', tests.res('R1'),
    'reason_code', 'LOST', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-HN', 'lines', '[{"sku":"MILK","qty":1}]'::jsonb)),
    'INVALID_REASON', 'only the fixed release reasons');
  perform tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'RELEASE',
    'from_location_id', tests.loc('AMN','TRANSIT'), 'to_location_id', tests.loc('AMN','STORE'), 'resident_id', tests.res('R1'),
    'reason_code', 'NO_LONGER_REQUIRED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-HN', 'lines', '[{"sku":"MILK","qty":1}]'::jsonb)), 'release 1');
  -- write-off from T[R1] is allowed (D-22)
  perform tests.ok(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','TRANSIT'),
    'resident_id', tests.res('R1'), 'reason_code', 'EXPIRED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
    'lines', '[{"sku":"MILK","qty":1}]'::jsonb)), 'write-off from Transit');
  perform tests.eq(tests.bucket('AMN','TRANSIT','MILK','R1'), 0::numeric, 'T[R1] empty');
  -- allocation needs an active resident of this branch
  perform tests.code(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'ALLOCATE',
    'from_location_id', tests.loc('AMN','STORE'), 'to_location_id', tests.loc('AMN','TRANSIT'), 'resident_id', tests.res('R3'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":1}]'::jsonb)), 'RESIDENT_NOT_ACTIVE', 'discharged resident');
  perform tests.code(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'ALLOCATE',
    'from_location_id', tests.loc('AMN','STORE'), 'to_location_id', tests.loc('AMN','TRANSIT'), 'resident_id', tests.res('R4'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":1}]'::jsonb)), 'RESIDENT_WRONG_BRANCH', 'other branch resident');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'caches clean');
end $$;

-- @test Transit: a resident moved to another branch keeps using the old bucket (D-107)
do $$
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'T2', '[{"sku":"MILK","qty":4,"unit_cost":20.00}]'), 'stock');
  perform tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'ALLOCATE',
    'from_location_id', tests.loc('AMN','STORE'), 'to_location_id', tests.loc('AMN','TRANSIT'), 'resident_id', tests.res('R2'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":4}]'::jsonb)), 'allocate');
  update public.tbl_residents set branch_id = 3 where id = tests.res('R2');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R2'), 'lines', '[{"sku":"MILK","qty":1,"loc":"AMN/TRANSIT"}]'::jsonb)), 'bucket is authoritative');
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R2'), 'lines', '[{"sku":"MILK","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'RESIDENT_WRONG_BRANCH', 'but not from Store');
  perform tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'RELEASE',
    'from_location_id', tests.loc('AMN','TRANSIT'), 'to_location_id', tests.loc('AMN','STORE'), 'resident_id', tests.res('R2'),
    'reason_code', 'WRONG_ALLOCATION', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-HN', 'lines', '[{"sku":"MILK","qty":3}]'::jsonb)), 'release still works');
end $$;

-- @test receive & allocate, and the receipt reversal cascade (D-40, D-124)
do $$
declare
  r1 jsonb;
  r2 jsonb;
begin
  r1 := tests.ok(tests.receipt('amn', 'AMN', 'RA1', '[{"sku":"MILK","qty":6,"unit_cost":20.00,"res":"R1"}]'), 'receive & allocate');
  perform tests.eq(tests.bucket('AMN','STORE','MILK'), 0::numeric, 'store net 0');
  perform tests.eq(tests.bucket('AMN','TRANSIT','MILK','R1'), 6::numeric, 'T[R1] 6');
  perform tests.eq((select txn_type from public.tbl_inv_txns where id = (r1->>'allocation_txn_id')::bigint), 'TRANSIT_ALLOCATE', 'allocation txn');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', r1->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse receipt');
  perform tests.eq(tests.bucket('AMN','TRANSIT','MILK','R1'), 0::numeric, 'allocation reversed first');
  perform tests.eq(tests.bucket('AMN','STORE','MILK'), 0::numeric, 'store back to 0');
  perform tests.eq((select is_voided from public.tbl_inv_receipts where id = (r1->>'receipt_id')::bigint), true, 'receipt voided');
  perform tests.eq((select count(*) from public.tbl_inv_txns where cascade_of_txn_id = (r1->>'txn_id')::bigint)::int, 1, 'cascade link');
  -- once allocated stock is used, the receipt can no longer be reversed
  r2 := tests.ok(tests.receipt('amn', 'AMN', 'RA2', '[{"sku":"MILK","qty":6,"unit_cost":20.00,"res":"R1"}]'), 'receive & allocate 2');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'lines', '[{"sku":"MILK","qty":2,"loc":"AMN/TRANSIT"}]'::jsonb)), 'use 2');
  perform tests.code(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', r2->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY', 'allow_negative', true)), 'TRANSIT_STOCK_USED', 'blocked');
  perform tests.code(tests.call('hqmod', 'inv_correct_receipt', jsonb_build_object('receipt_id', r2->'receipt_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_COST', 'receipt', jsonb_build_object('supplier_id',
    (select id from public.tbl_inv_suppliers where owner_branch_id is null), 'invoice_no', 'RA2',
    'invoice_date', tests.today(), 'lines', tests.lines('[{"sku":"MILK","qty":6,"unit_cost":21.00}]')))),
    'RECEIPT_HAS_ALLOCATION', 'allocated receipts are reversed, not corrected');
end $$;

-- @test reversal: issue reversal restores stock and credits the charge; guards
do $$
declare
  d jsonb;
  rv jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'RV1', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]'), 'stock');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'lines', '[{"sku":"GLOVES","qty":10,"loc":"AMN/STORE"}]'::jsonb)), 'issue');
  perform tests.code(tests.call('amn', 'inv_reverse_txn', jsonb_build_object('txn_id', d->'txn_id',
    'performed_by_staff', 'AMN-HN', 'reason_code', 'WRONG_QTY')), 'FORBIDDEN', 'branch login cannot reverse');
  rv := tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', d->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_RESIDENT', 'remarks', 'wrong bed')), 'reverse');
  perform tests.eq(tests.bucket('AMN','STORE','GLOVES'), 100::numeric, 'stock back');
  perform tests.eq((tests.pool('AMN','GLOVES')).value, 100::numeric, 'value back');
  perform tests.eq((select sum(charge_amount) from public.tbl_inv_charges where resident_id = tests.res('R1')), 0::numeric, 'charge credited');
  perform tests.eq((select count(*) from public.tbl_inv_charges where charge_kind = 'REVERSAL')::int, 1, 'one reversal charge');
  perform tests.code(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', d->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'OTHER')), 'ALREADY_REVERSED', 'no double reversal');
  perform tests.code(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', rv->'reversal_txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'OTHER')), 'CANNOT_REVERSE_REVERSAL', 'reversal of a reversal');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'caches clean');
end $$;

-- @test correction (audit F2): partially consumed receipt, cost-only fix, no false negative prompt
do $$
declare
  r2 jsonb;
  c jsonb;
  p public.tbl_inv_cost_pools;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'F2-1', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]'), 'R1');
  r2 := tests.ok(tests.receipt('amn', 'AMN', 'F2-2', '[{"sku":"GLOVES","qty":100,"unit_cost":1.20}]'), 'R2');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'lines', '[{"sku":"GLOVES","qty":150,"loc":"AMN/STORE"}]'::jsonb)), 'issue 150');
  p := tests.pool('AMN','GLOVES');
  perform tests.eq(p.value, 55::numeric, 'V 55 before');
  -- R2 really cost 1.25; no allow_negative: the net bucket change is 0
  c := tests.ok(tests.call('hqmod', 'inv_correct_receipt', jsonb_build_object('receipt_id', r2->'receipt_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_COST', 'receipt', jsonb_build_object(
      'supplier_id', (select id from public.tbl_inv_suppliers where owner_branch_id is null),
      'invoice_no', 'F2-2', 'invoice_date', tests.today(),
      'lines', tests.lines('[{"sku":"GLOVES","qty":100,"unit_cost":1.25}]')))), 'correct');
  p := tests.pool('AMN','GLOVES');
  perform tests.eq(p.qty, 50::numeric, 'Q unchanged');
  perform tests.eq(p.value, 56.25::numeric, 'V = 56.25 (the correct history)');
  perform tests.eq(p.wac, 1.125::numeric, 'W = 1.125');
  perform tests.eq((select revaluation_value from public.tbl_inv_txn_lines where txn_id = (c->>'txn_id')::bigint), -3.75::numeric,
                   'consumed-cost variance -3.75');
  perform tests.eq((select negative_stock_confirmed from public.tbl_inv_txns where id = (c->>'reversal_txn_id')::bigint), false, 'no negative confirmation');
  perform tests.eq((select is_voided and superseded_by_receipt_id = (c->>'receipt_id')::bigint from public.tbl_inv_receipts
                     where id = (r2->>'receipt_id')::bigint), true, 'old receipt voided + superseded');
  perform tests.eq((select corrects_receipt_id from public.tbl_inv_receipts where id = (c->>'receipt_id')::bigint),
                   (r2->>'receipt_id')::bigint, 'new receipt links back');
  perform tests.eq((select correction_of_txn_id from public.tbl_inv_txns where id = (c->>'txn_id')::bigint),
                   (r2->>'txn_id')::bigint, 'correction_of_txn_id');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'I1 holds after netting');
  perform tests.code(tests.call('hqmod', 'inv_correct_receipt', jsonb_build_object('receipt_id', r2->'receipt_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_COST', 'receipt', jsonb_build_object(
      'supplier_id', (select id from public.tbl_inv_suppliers where owner_branch_id is null),
      'invoice_no', 'F2-2', 'invoice_date', tests.today(),
      'lines', tests.lines('[{"sku":"GLOVES","qty":100,"unit_cost":1.30}]')))), 'RECEIPT_VOIDED', 'a superseded receipt cannot be corrected again');
end $$;

-- @test correction: quantity fix (R2 → 90 @ 1.20) and a net-negative fix needs confirmation
do $$
declare
  r2 jsonb;
  r3 jsonb;
  p public.tbl_inv_cost_pools;
  v_supplier bigint := (select id from public.tbl_inv_suppliers where owner_branch_id is null);
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'Q-1', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]'), 'R1');
  r2 := tests.ok(tests.receipt('amn', 'AMN', 'Q-2', '[{"sku":"GLOVES","qty":100,"unit_cost":1.20}]'), 'R2');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'lines', '[{"sku":"GLOVES","qty":150,"loc":"AMN/STORE"}]'::jsonb)), 'issue 150');
  perform tests.ok(tests.call('hqmod', 'inv_correct_receipt', jsonb_build_object('receipt_id', r2->'receipt_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_QTY', 'receipt', jsonb_build_object('supplier_id', v_supplier,
    'invoice_no', 'Q-2', 'invoice_date', tests.today(),
    'lines', tests.lines('[{"sku":"GLOVES","qty":90,"unit_cost":1.20}]')))), 'qty correction');
  p := tests.pool('AMN','GLOVES');
  perform tests.eq(p.qty, 40::numeric, 'Q 40');
  perform tests.eq(p.value, 43::numeric, 'V 43');
  perform tests.eq(p.wac, 1.075::numeric, 'W 1.075');
  -- a correction that takes the Store below zero on its net effect must be confirmed
  r3 := tests.ok(tests.receipt('amn', 'AMN', 'Q-3', '[{"sku":"GAUZE","qty":100,"unit_cost":1.00}]'), 'R3');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'lines', '[{"sku":"GAUZE","qty":90,"loc":"AMN/STORE"}]'::jsonb)), 'issue 90');
  perform tests.code(tests.call('hqmod', 'inv_correct_receipt', jsonb_build_object('receipt_id', r3->'receipt_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_QTY', 'receipt', jsonb_build_object('supplier_id', v_supplier,
    'invoice_no', 'Q-3', 'invoice_date', tests.today(),
    'lines', tests.lines('[{"sku":"GAUZE","qty":50,"unit_cost":1.00}]')))), 'NEGATIVE_STOCK_CONFIRM', 'net -50 on 10 on hand');
  -- wrong product: GAUZE line was really GLOVES (pool of each product netted separately)
  r3 := tests.ok(tests.receipt('amn', 'AMN', 'Q-4', '[{"sku":"MILK","qty":10,"unit_cost":20.00}]'), 'R4 as MILK');
  perform tests.ok(tests.call('hqmod', 'inv_correct_receipt', jsonb_build_object('receipt_id', r3->'receipt_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_PRODUCT', 'receipt', jsonb_build_object('supplier_id', v_supplier,
    'invoice_no', 'Q-4', 'invoice_date', tests.today(),
    'lines', tests.lines('[{"sku":"NEWPROD","qty":10,"unit_cost":20.00}]')))), 'product correction');
  perform tests.eq((tests.pool('AMN','MILK')).qty::text || '/' || (tests.pool('AMN','MILK')).value, '0.0000/0.0000', 'MILK pool emptied');
  perform tests.eq((tests.pool('AMN','NEWPROD')).qty::text || '/' || (tests.pool('AMN','NEWPROD')).wac, '10.0000/20.000000', 'NEWPROD pool filled');
  -- a reversal cannot be dated before the original
  perform tests.code(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id',
    (select txn_id from public.tbl_inv_receipts where invoice_no = 'Q-1'), 'txn_date', tests.go_live(),
    'performed_by_staff', 'HQ-ND', 'reason_code', 'OTHER')), 'DATE_BEFORE_ORIGINAL', 'reversal before the original');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'caches clean');
end $$;

-- @test immutability: ledger rows cannot be updated, deleted or truncated; caches only via the engine
do $$
declare
  d jsonb;
begin
  d := tests.ok(tests.receipt('amn', 'AMN', 'IM1', '[{"sku":"GLOVES","qty":10,"unit_cost":1.00}]'), 'stock');
  perform tests.raises(format('update public.tbl_inv_txns set remarks = %L where id = %s', 'x', d->>'txn_id'), 'INV_IMMUTABLE%', 'txn update');
  perform tests.raises(format('delete from public.tbl_inv_txn_lines where txn_id = %s', d->>'txn_id'), 'INV_IMMUTABLE%', 'line delete');
  perform tests.raises('truncate public.tbl_inv_audit_log', 'INV_IMMUTABLE%', 'truncate');
  perform tests.raises('delete from public.tbl_inv_idempotency', 'INV_IMMUTABLE%', 'idempotency delete');
  perform tests.raises('update public.tbl_inv_cost_pools set qty = 999', 'INV_ENGINE_ONLY%', 'pool outside the engine');
  perform tests.raises('update public.tbl_inv_balances set qty = 999', 'INV_ENGINE_ONLY%', 'bucket outside the engine');
  perform tests.raises(format('update public.tbl_inv_receipts set remarks = %L', 'x'), 'INV_ENGINE_ONLY%', 'document outside the engine');
  perform set_config('inv.posting', 'on', true);
  perform tests.raises(format('update public.tbl_inv_receipts set invoice_no = %L', 'HACK'), 'INV_TRANSITION%', 'non-whitelisted column');
  perform tests.raises('update public.tbl_inv_receipts set is_voided = true', '%', 'voiding without a txn breaks a CHECK');
  perform set_config('inv.posting', 'off', true);
  perform tests.raises(format('delete from public.tbl_inv_products where id = %s', tests.prod('GLOVES')), 'INV_IMMUTABLE%', 'master data delete');
  perform tests.raises('select public.fn_inv_purge_demo() from public.tbl_branches where false; delete from public.tbl_inv_txns',
                       'INV_IMMUTABLE%', 'no delete without the purge');
  -- the logged-in user cannot write at all
  perform tests.login('amn');
  perform tests.raises(format('insert into public.tbl_inv_idempotency (key, rpc, account_id, request_hash, result) values (gen_random_uuid(), %L, 1, %L, %L)', 'x', '\x00', '{}'),
                       'permission denied%', 'no client INSERT');
  perform tests.raises(format('update public.tbl_inv_cost_pools set qty = 1'), 'permission denied%', 'no client UPDATE');
  perform tests.raises('select public.fn_inv_write_txns(''[]'', 1, gen_random_uuid())', 'permission denied%', 'engine not executable');
  perform tests.logout();
end $$;

-- @test master-data guards: UOM factor and base UOM frozen once used (D-106), owner rules (D-102)
do $$
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'MD1', '[{"sku":"GLOVES","uom":"BOX","qty":1,"unit_cost":100.00}]'), 'use BOX');
  perform tests.raises(format('update public.tbl_inv_product_uoms set factor_to_base = 50 where product_id = %s and uom_id = %s',
                              tests.prod('GLOVES'), tests.uom('BOX')), 'INV_MASTER: factor_to_base%', 'factor frozen');
  perform tests.raises(format('update public.tbl_inv_products set base_uom_id = %s where id = %s', tests.uom('PCS'), tests.prod('GLOVES')),
                       'INV_MASTER: base UOM%', 'base UOM frozen');
  perform tests.raises(format('update public.tbl_inv_products set owner_branch_id = 1 where id = %s', tests.prod('GAUZE')),
                       'INV_MASTER: owner_branch_id must be NULL or a demo branch%', 'real branch cannot own products');
  perform tests.raises(format('update public.tbl_inv_products set category_id = (select id from public.tbl_inv_categories where code = %L) where id = %s',
                              'SERVICE', tests.prod('GAUZE')), 'INV_MASTER: is_stock_item%', 'stock flag follows category');
  -- a conversion can be edited while unused
  update public.tbl_inv_product_uoms set factor_to_base = 20 where product_id = tests.prod('GAUZE') and uom_id = tests.uom('PACK');
  set constraints all immediate;
  perform tests.raises(format('insert into public.tbl_inv_product_uoms (product_id, uom_id, factor_to_base) values (%s, %s, 1)',
                              tests.prod('GAUZE'), tests.uom('PCS')), 'INV_MASTER: product%', 'only the base UOM has factor 1');
end $$;

-- @test idempotency: replay returns the stored result; a reused key with another payload is refused
do $$
declare
  k uuid := gen_random_uuid();
  a jsonb;
  b jsonb;
  n int;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'ID0', '[{"sku":"GLOVES","qty":50,"unit_cost":1.00}]'), 'stock');
  a := tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
         'lines', '[{"sku":"GLOVES","qty":5,"loc":"AMN/STORE"}]'::jsonb), k);
  perform tests.ok(a, 'first');
  n := (select count(*) from public.tbl_inv_txns);
  b := tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
         'lines', '[{"sku":"GLOVES","qty":5,"loc":"AMN/STORE"}]'::jsonb), k);
  perform tests.eq((b->>'replayed')::boolean, true, 'replayed');
  perform tests.eq(b->'data'->>'txn_id', a->'data'->>'txn_id', 'same txn');
  perform tests.eq((select count(*) from public.tbl_inv_txns)::int, n, 'double submit posts once');
  perform tests.eq(tests.bucket('AMN','STORE','GLOVES'), 45::numeric, 'stock moved once');
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
         'lines', '[{"sku":"GLOVES","qty":6,"loc":"AMN/STORE"}]'::jsonb), k), 'IDEMPOTENCY_KEY_REUSED', 'edited payload, same key');
  perform tests.code(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'DAMAGED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":1}]'::jsonb), k),
    'IDEMPOTENCY_KEY_REUSED', 'same key, other RPC');
  perform tests.code(tests.issue('bmn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
         'lines', '[{"sku":"GLOVES","qty":5,"loc":"AMN/STORE"}]'::jsonb), k), 'FORBIDDEN', 'another login cannot replay (scope first)');
end $$;

-- @test service products: charged with no ledger rows, never stocked (D-137)
do $$
declare
  d jsonb;
begin
  d := tests.ok(tests.call('amn', 'inv_charge_service', jsonb_build_object('target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'charge_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"SVC","uom":"JOB","qty":2}]'::jsonb)), 'charge');
  perform tests.eq((select charge_kind || ':' || charge_amount from public.tbl_inv_charges where id = (d->'charge_ids'->>0)::bigint),
                   'SERVICE:50.00', '2 x 25.00');
  perform tests.eq((select txn_id from public.tbl_inv_charges where id = (d->'charge_ids'->>0)::bigint), null::bigint, 'no txn');
  perform tests.eq((select count(*) from public.tbl_inv_txn_lines where product_id = tests.prod('SVC'))::int, 0, 'no ledger lines');
  perform tests.eq((select count(*) from public.tbl_inv_balances where product_id = tests.prod('SVC'))::int, 0, 'no balance');
  perform tests.eq((select count(*) from public.tbl_inv_cost_pools where product_id = tests.prod('SVC'))::int, 0, 'no WAC pool');
  perform tests.eq((select count(*) from public.v_inv_suggested_order where product_id = tests.prod('SVC'))::int, 0, 'not in suggested order');
  -- OSEM expense: amount 0, cost at the standard cost
  d := tests.ok(tests.call('amn', 'inv_charge_service', jsonb_build_object('target', 'OSEM_EXPENSE', 'branch_id', tests.branch('AMN'),
    'charge_date', tests.today(), 'performed_by_staff', 'AMN-1', 'expense_note', 'staff', 'lines', '[{"sku":"SVC","uom":"JOB","qty":1}]'::jsonb)), 'osem');
  perform tests.eq((select charge_amount::text || '/' || cost_amount::numeric(10,2) from public.tbl_inv_charges where id = (d->'charge_ids'->>0)::bigint),
                   '0.00/5.00', 'expense');
  -- stock RPCs refuse services, the service RPC refuses stock items
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'lines', '[{"sku":"SVC","uom":"JOB","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'NOT_STOCK_ITEM', 'issue refuses service');
  perform tests.code(tests.receipt('amn', 'AMN', 'SV1', '[{"sku":"SVC","uom":"JOB","qty":1,"unit_cost":5}]'), 'NOT_STOCK_ITEM', 'receipt refuses service');
  perform tests.code(tests.call('amn', 'inv_charge_service', jsonb_build_object('target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'charge_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":1}]'::jsonb)), 'NOT_SERVICE_ITEM', 'service RPC refuses stock');
  -- reversal: MOD only, once
  d := tests.ok(tests.call('amn', 'inv_charge_service', jsonb_build_object('target', 'RESIDENT', 'resident_id', tests.res('R2'),
    'charge_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"SVC","uom":"JOB","qty":1}]'::jsonb)), 'charge R2');
  perform tests.code(tests.call('amn', 'inv_reverse_charge', jsonb_build_object('charge_id', d->'charge_ids'->0,
    'performed_by_staff', 'AMN-HN', 'reason', 'charged twice')), 'FORBIDDEN', 'branch login cannot reverse');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_charge', jsonb_build_object('charge_id', d->'charge_ids'->0,
    'performed_by_staff', 'HQ-ND', 'reason', 'charged twice')), 'reverse');
  perform tests.eq((select sum(charge_amount) from public.tbl_inv_charges where resident_id = tests.res('R2')), 0::numeric, 'credited');
  perform tests.code(tests.call('hqmod', 'inv_reverse_charge', jsonb_build_object('charge_id', d->'charge_ids'->0,
    'performed_by_staff', 'HQ-ND', 'reason', 'charged twice')), 'ALREADY_REVERSED', 'once');
end $$;

-- @test charges: price frozen at posting; PRICE_PENDING; not-chargeable goes to OSEM expense only
do $$
declare
  a jsonb;
  b jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'CH1', '[{"sku":"GLOVES","qty":100,"unit_cost":0.20},{"sku":"NOPRICE","uom":"TAB","qty":100,"unit_cost":0.05},{"sku":"NOCHARGE","qty":10,"unit_cost":3.00}]'), 'stock');
  a := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'lines', '[{"sku":"GLOVES","qty":10,"loc":"AMN/STORE"}]'::jsonb)), 'issue at 0.50');
  update public.tbl_inv_products set charge_price = 0.60 where sku = 'GLOVES';     -- Q-31: applies from save
  b := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'lines', '[{"sku":"GLOVES","qty":10,"loc":"AMN/STORE"}]'::jsonb)), 'issue at 0.60');
  perform tests.eq((select unit_charge_price::text || '/' || charge_amount from public.tbl_inv_charges where txn_id = (a->>'txn_id')::bigint), '0.5000/5.00', 'old charge keeps its price');
  perform tests.eq((select unit_charge_price::text || '/' || charge_amount from public.tbl_inv_charges where txn_id = (b->>'txn_id')::bigint), '0.6000/6.00', 'new price from save');
  perform tests.eq((select product_name from public.tbl_inv_charges where txn_id = (a->>'txn_id')::bigint), 'Gloves (M)', 'name frozen');
  a := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'lines', '[{"sku":"NOPRICE","uom":"STRIP","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'no price');
  perform tests.eq((a->>'price_pending')::boolean, true, 'PRICE_PENDING flagged');
  perform tests.eq((select coalesce(unit_charge_price::text, 'NULL') || '/' || charge_amount || '/' || qty_base from public.tbl_inv_charges where txn_id = (a->>'txn_id')::bigint),
                   'NULL/0.00/10.0000', 'pending charge row, base qty');
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'lines', '[{"sku":"NOCHARGE","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'NOT_CHARGEABLE', 'not chargeable to a resident');
  a := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE', 'expense_note', 'hand hygiene',
    'lines', '[{"sku":"NOCHARGE","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'OSEM expense');
  perform tests.eq((select charge_amount::text || '/' || cost_amount::numeric(10,2) from public.tbl_inv_charges where txn_id = (a->>'txn_id')::bigint), '0.00/3.00', 'expense at cost');
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R3'),
    'lines', '[{"sku":"GLOVES","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'INACTIVE_RESIDENT_CONFIRM', 'discharged resident needs confirmation');
  a := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R3'),
    'inactive_resident_confirmed', true, 'lines', '[{"sku":"GLOVES","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'confirmed');
  perform tests.eq((select inactive_resident_confirmed from public.tbl_inv_txns where id = (a->>'txn_id')::bigint), true, 'flag stored');
end $$;

-- @test period lock: review, lock, closing snapshot, postings refused, reversal lands in the open month, reopen
do $$
declare
  gl date := tests.go_live();
  r jsonb;
  d jsonb;
begin
  r := tests.ok(tests.receipt('amn', 'AMN', 'PL1', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]',
         jsonb_build_object('received_date', gl, 'invoice_date', gl)), 'receipt last month');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'EXCEPTIONS_NOT_REVIEWED', 'review first');
  perform tests.code(tests.call('amn', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'AMN-HN')), 'FORBIDDEN', 'branch login cannot review');
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'reviewed');
  -- a price-pending resident charge blocks the lock
  d := tests.ok(tests.issue('amn', jsonb_build_object('txn_date', gl, 'performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'allow_negative', true, 'lines', '[{"sku":"NOPRICE","uom":"TAB","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'pending');
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'reviewed after the late issue');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'PRICE_PENDING_EXISTS', 'price pending blocks');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', d->'txn_id', 'txn_date', gl,
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse the pending issue');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'EXCEPTIONS_STALE', 'postings after the review make it stale');
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'review again');
  perform tests.code(tests.call('amn', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'AMN-HN')), 'FORBIDDEN', 'branch login cannot lock');
  perform tests.ok(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'lock');
  perform tests.eq((select qty::numeric || '/' || value from public.tbl_inv_period_closing
                     where branch_id = 1 and product_id = tests.prod('GLOVES') and location_id is null), '100.0000/100.0000', 'closing pool row');
  perform tests.eq((select qty from public.tbl_inv_period_closing where branch_id = 1 and product_id = tests.prod('GLOVES')
                     and location_id = tests.loc('AMN','STORE')), 100::numeric, 'closing bucket row');
  -- nothing more can be dated in the locked month
  perform tests.code(tests.receipt('amn', 'AMN', 'PL2', '[{"sku":"GLOVES","qty":1,"unit_cost":1.00}]',
    jsonb_build_object('received_date', gl, 'invoice_date', gl)), 'PERIOD_LOCKED', 'posting into a locked month');
  perform tests.code(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', r->'txn_id', 'txn_date', gl,
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'PERIOD_LOCKED', 'reversal dated in the locked month');
  -- a reversal of a locked-month txn posts into the open month (D-130)
  d := tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', r->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY', 'allow_negative', true)), 'reverse into today');
  perform tests.eq((select txn_date from public.tbl_inv_txns where id = (d->>'reversal_txn_id')::bigint), tests.today(), 'reversal dated today');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1,
    'period_month', date_trunc('month', tests.today())::date, 'performed_by_staff', 'HQ-ND')), 'MONTH_NOT_ENDED', 'current month');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'ALREADY_LOCKED', 'twice');
  -- reopen: ADMIN only, with a reason; re-lock writes a new lock_seq
  perform tests.code(tests.call('hqmod', 'inv_reopen_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND', 'reason', 'late invoice')), 'FORBIDDEN', 'moderator cannot reopen');
  perform tests.ok(tests.call('hqadmin', 'inv_reopen_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND', 'reason', 'late invoice')), 'reopen');
  perform tests.ok(tests.receipt('amn', 'AMN', 'PL3', '[{"sku":"GLOVES","qty":1,"unit_cost":1.00}]',
    jsonb_build_object('received_date', gl, 'invoice_date', gl)), 'posting allowed again');
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 're-review');
  perform tests.eq((tests.ok(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 're-lock')->>'lock_seq')::int, 1, 'new lock_seq');
  perform tests.eq((select count(distinct lock_seq) from public.tbl_inv_period_closing where branch_id = 1)::int, 2, 'history kept');
end $$;

-- @test period lock refuses drifted caches; rebuild (postgres only) repairs them
do $$
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'DR1', '[{"sku":"GLOVES","qty":10,"unit_cost":1.00}]',
    jsonb_build_object('received_date', tests.go_live(), 'invoice_date', tests.go_live())), 'stock');
  perform set_config('inv.posting', 'on', true);
  update public.tbl_inv_cost_pools set qty = 999 where branch_id = 1 and product_id = tests.prod('GLOVES');
  perform set_config('inv.posting', 'off', true);
  perform tests.login('hqadmin');
  perform tests.eq((public.inv_verify_balances(1)->'data'->>'clean')::boolean, false, 'drift reported');
  perform tests.logout();
  perform tests.login('amn');
  perform tests.code(public.inv_verify_balances(1), 'FORBIDDEN', 'verify is ADMIN only');
  perform tests.logout();
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', tests.go_live(),
    'performed_by_staff', 'HQ-ND')), 'reviewed');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', tests.go_live(),
    'performed_by_staff', 'HQ-ND')), 'BALANCE_DRIFT', 'lock refused on drift');
  perform public.fn_inv_rebuild_caches(1);
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'rebuilt');
  perform tests.eq((tests.pool('AMN','GLOVES')).qty, 10::numeric, 'qty from the ledger');
end $$;

-- @test write-off posts directly (no limit, D-158) and count freeze (D-104)
do $$
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'WO1', '[{"sku":"GLOVES","qty":200,"unit_cost":1.10}]'), 'stock');
  perform tests.ok(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'DAMAGED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":40}]'::jsonb)), '44.00');
  perform tests.ok(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'EXPIRED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":50}]'::jsonb)),
    '55.00 also posts: no limit');
  perform tests.code(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'LOST', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":1}]'::jsonb)),
    'INVALID_REASON', 'only DAMAGED/EXPIRED');
  insert into public.tbl_inv_counts (count_no, branch_id, location_id, count_type, status, freeze_location, counted_by_staff, created_by_account)
  values ('AMN-CNT-T', 1, tests.loc('AMN','STORE'), 'MONTHLY_STORE', 'IN_PROGRESS', true, 'AMN-1', 1);
  perform tests.code(tests.receipt('amn', 'AMN', 'WO2', '[{"sku":"GLOVES","qty":1,"unit_cost":1.10}]'), 'LOCATION_COUNT_IN_PROGRESS', 'frozen store');
  perform tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'ALLOCATE',
    'from_location_id', tests.loc('AMN','FLOOR'), 'to_location_id', tests.loc('AMN','TRANSIT'), 'resident_id', tests.res('R1'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'allow_negative', true, 'lines', '[{"sku":"GLOVES","qty":1}]'::jsonb)), 'floor still posts');
end $$;

-- @test validation: dates, attribution, payload shape, duplicates, caps, sanity
do $$
declare
  gl date := tests.go_live();
begin
  perform tests.code(tests.receipt('amn', 'AMN', 'V1', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]',
    jsonb_build_object('received_date', tests.today() + 1)), 'DATE_IN_FUTURE', 'future');
  perform tests.code(tests.receipt('amn', 'AMN', 'V1', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]',
    jsonb_build_object('received_date', gl - 1)), 'DATE_BEFORE_GO_LIVE', 'before go-live');
  perform tests.code(tests.receipt('amn', 'AMN', 'V1', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]',
    jsonb_build_object('received_date', '2026-02-30')), 'INVALID_DATE', 'impossible date');
  perform tests.code(tests.receipt('amn', 'AMN', 'V1', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]',
    jsonb_build_object('received_by_staff', 'AMN-1')), 'STAFF_NOT_SENIOR', 'receipt needs a senior staff member (D-134)');
  perform tests.code(tests.receipt('amn', 'AMN', 'V1', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]',
    jsonb_build_object('received_by_staff', 'BMN-HN')), 'STAFF_WRONG_BRANCH', 'other branch staff');
  perform tests.code(tests.receipt('amn', 'AMN', 'V1', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]',
    jsonb_build_object('received_by_staff', 'AMN-X')), 'STAFF_INACTIVE', 'inactive staff');
  perform tests.ok(tests.receipt('amn', 'AMN', 'V1', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]',
    jsonb_build_object('received_by_staff', 'HQ-ND')), 'HQ Nursing Director may be attributed');
  perform tests.code(tests.receipt('amn', 'AMN', 'v-1', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]'), 'DUPLICATE_INVOICE', 'normalised invoice key');
  perform tests.code(tests.receipt('amn', 'AMN', 'V2', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]', '{"invoice_no":null}'), 'INVOICE_REQUIRED', 'invoice mandatory (D-138)');
  perform tests.code(tests.receipt('amn', 'AMN', 'V2', '[{"sku":"GLOVES","qty":1.5,"unit_cost":1}]'), 'QTY_NOT_INTEGRAL', 'EA is whole');
  perform tests.code(tests.receipt('amn', 'AMN', 'V2', '[{"sku":"GLOVES","qty":1,"unit_cost":1},{"sku":"GLOVES","qty":2,"unit_cost":1}]'), 'DUPLICATE_LINE', 'duplicate');
  perform tests.code(tests.receipt('amn', 'AMN', 'V2', '[{"sku":"GLOVES","qty":2000000,"unit_cost":1}]'), 'QTY_TOO_LARGE', 'hard qty cap');
  perform tests.code(tests.receipt('amn', 'AMN', 'V2', '[{"sku":"GLOVES","qty":1,"unit_cost":200000}]'), 'COST_TOO_LARGE', 'hard cost cap');
  perform tests.code(tests.receipt('amn', 'AMN', 'V2', '[{"sku":"GLOVES","qty":"abc","unit_cost":1}]'), 'INVALID_QTY', 'malformed qty');
  perform tests.code(tests.receipt('amn', 'AMN', 'V2', '[]'), 'INVALID_PAYLOAD', 'no lines');
  perform tests.code(tests.receipt('amn', 'AMN', 'V2', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]',
    jsonb_build_object('location_id', tests.loc('AMN','FLOOR'))), 'LOCATION_NOT_STORE', 'receipts land in Store (D-23)');
  perform tests.code(tests.receipt('amn', 'AMN', 'V2', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]', '{"discount_total":-1}'), 'INVALID_TOTALS', 'negative discount');
  -- sanity: quantity above max(10 x max, 1000), cost far from the last cost
  perform tests.code(tests.receipt('amn', 'AMN', 'V3', '[{"sku":"GLOVES","qty":6000,"unit_cost":1}]'), 'SANITY_CONFIRM', 'qty sanity');
  perform tests.ok(tests.receipt('amn', 'AMN', 'V3', '[{"sku":"GLOVES","qty":6000,"unit_cost":1}]', '{"sanity_confirmed":true}'), 'confirmed');
  perform tests.code(tests.receipt('amn', 'AMN', 'V4', '[{"sku":"GLOVES","qty":10,"unit_cost":5}]'), 'SANITY_CONFIRM', 'unit cost 5.00 vs 1.00');
  perform tests.code(tests.call('inactive', 'inv_post_issue', '{}'::jsonb), 'FORBIDDEN', 'inactive account');
  update public.tbl_inv_branch_settings set is_enabled = false where branch_id = 4;
  perform tests.code(tests.receipt('bgn', 'BGN', 'V5', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]'), 'INVENTORY_NOT_ENABLED', 'disabled branch');
end $$;

-- @test RLS: branch logins see only their branch; HQ sees every real NUR branch; charges and audit by rank
do $$
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'RL1', '[{"sku":"GLOVES","qty":10,"unit_cost":1}]'), 'AMN');
  perform tests.ok(tests.receipt('bmn', 'BMN', 'RL2', '[{"sku":"GLOVES","qty":10,"unit_cost":1}]'), 'BMN');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'lines', '[{"sku":"GLOVES","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'AMN charge');
  perform tests.ok(tests.receipt('demo', 'DEMO', 'RL3', '[{"sku":"GLOVES","qty":10,"unit_cost":1}]',
    '{"received_by_staff":"DEMO-HN"}'), 'DEMO');

  perform tests.login('amn');
  perform tests.eq((select array_agg(distinct branch_id) from public.tbl_inv_txns), array[1::bigint], 'amn txns');
  perform tests.eq((select array_agg(distinct branch_id) from public.tbl_inv_txn_lines), array[1::bigint], 'amn lines');
  perform tests.eq((select array_agg(distinct branch_id) from public.tbl_inv_locations), array[1::bigint], 'amn locations');
  perform tests.eq((select count(*) from public.tbl_inv_receipts)::int, 1, 'amn receipts');
  perform tests.eq((select count(*) from public.tbl_inv_charges)::int, 1, 'branch login sees own charges');
  perform tests.eq((select count(*) from public.tbl_inv_audit_log)::int, 0, 'no audit for the branch login');
  perform tests.eq((select count(*) from public.tbl_inv_idempotency)::int, 0, 'idempotency invisible');
  perform tests.eq((select count(*) from public.tbl_inv_counters)::int, 0, 'counters invisible');
  perform tests.eq((select count(*) from public.v_inv_stock_balance where branch_id <> 1)::int, 0, 'view obeys RLS');
  perform tests.logout();

  perform tests.login('bmn');
  perform tests.eq((select array_agg(distinct branch_id) from public.tbl_inv_txns), array[3::bigint], 'bmn txns');
  perform tests.eq((select count(*) from public.tbl_inv_charges)::int, 0, 'no AMN charges');
  perform tests.logout();

  perform tests.login('hqmod');
  perform tests.eq(public.inv_accessible_branch_ids(), array[1,3,4]::bigint[], 'HQ scope = real NUR branches');
  perform tests.eq((select array_agg(distinct branch_id order by branch_id) from public.tbl_inv_txns), array[1,3]::bigint[], 'HQ sees AMN+BMN, not DEMO');
  perform tests.eq((select count(*) from public.tbl_inv_audit_log where branch_id = 6)::int, 0, 'no demo audit for HQ');
  perform tests.eq((select count(*) > 0 from public.tbl_inv_audit_log), true, 'HQ moderator reads audit');
  perform tests.logout();

  -- cross-branch posting is refused
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'lines', '[{"sku":"GLOVES","qty":1,"loc":"BMN/STORE"}]'::jsonb)), 'FORBIDDEN', 'amn cannot issue at BMN');
  perform tests.code(tests.receipt('amn', 'BMN', 'RL4', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]'), 'FORBIDDEN', 'amn cannot receive at BMN');
  -- HQ may operate on a branch (review/management access)
  perform tests.ok(tests.receipt('hqmod', 'BGN', 'RL5', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]'), 'HQ moderator records a BGN receipt');
end $$;

-- @test PHY branch: no inventory access at all (D-135)
do $$
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'PH1', '[{"sku":"GLOVES","qty":10,"unit_cost":1}]'), 'data exists');
  perform tests.login('amp');
  perform tests.eq(public.inv_accessible_branch_ids(), '{}'::bigint[], 'empty scope');
  perform tests.eq(public.inv_my_rank(), 0, 'rank 0');
  perform tests.eq((select count(*) from public.tbl_inv_locations)::int, 0, 'no locations');
  perform tests.eq((select count(*) from public.tbl_inv_products)::int, 0, 'no catalogue');
  perform tests.eq((select count(*) from public.tbl_inv_uoms)::int, 0, 'no UOMs');
  perform tests.eq((select count(*) from public.tbl_inv_txns)::int, 0, 'no ledger');
  perform tests.logout();
  perform tests.code(tests.receipt('amp', 'AMN', 'PH2', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]'), 'FORBIDDEN', 'cannot post');
  perform tests.code(tests.call('amp', 'inv_charge_service', jsonb_build_object('target', 'OSEM_EXPENSE', 'branch_id', 2,
    'charge_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"SVC","uom":"JOB","qty":1}]'::jsonb)), 'FORBIDDEN', 'cannot charge');
end $$;

-- @test DEMO isolation: pinned to its branch, own products invisible elsewhere, no global master data (F1)
do $$
begin
  perform tests.ok(tests.receipt('demo', 'DEMO', 'DM1', '[{"sku":"DEMOPROD","qty":5,"unit_cost":1}]',
    jsonb_build_object('received_by_staff', 'DEMO-HN', 'supplier_id', (select id from public.tbl_inv_suppliers where owner_branch_id = 6))), 'demo receipt');
  perform tests.login('demo');
  perform tests.eq(public.inv_accessible_branch_ids(), array[6]::bigint[], 'demo scope');
  perform tests.eq((select array_agg(distinct branch_id) from public.tbl_inv_locations), array[6::bigint], 'demo locations');
  perform tests.eq((select count(*) from public.tbl_inv_products where sku in ('GLOVES','DEMOPROD'))::int, 2, 'global + own products');
  perform tests.eq(public.inv_is_hq_admin(), false, 'demo ADMIN is not HQ admin');
  perform tests.logout();
  perform tests.login('amn');
  perform tests.eq((select count(*) from public.tbl_inv_products where sku = 'DEMOPROD')::int, 0, 'demo product hidden from AMN');
  perform tests.eq((select count(*) from public.tbl_inv_suppliers where owner_branch_id = 6)::int, 0, 'demo supplier hidden');
  perform tests.logout();
  perform tests.login('hqadmin');
  perform tests.eq((select count(*) from public.tbl_inv_txns where branch_id = 6)::int, 0, 'HQ admin does not see demo txns');
  perform tests.eq((select count(*) from public.tbl_inv_products where sku = 'DEMOPROD')::int, 0, 'nor demo products');
  perform tests.eq(public.inv_is_hq_admin(), true, 'real HQ admin');
  perform tests.logout();
  perform tests.code(tests.receipt('demo', 'AMN', 'DM2', '[{"sku":"GLOVES","qty":1,"unit_cost":1}]'), 'FORBIDDEN', 'demo cannot post to AMN');
  perform tests.code(tests.receipt('amn', 'AMN', 'DM3', '[{"sku":"DEMOPROD","qty":1,"unit_cost":1}]'), 'PRODUCT_NOT_FOUND', 'AMN cannot use a demo product');
  perform tests.code(tests.call('demo', 'inv_dispatch_branch_transfer', jsonb_build_object(
    'from_location_id', tests.loc('DEMO','STORE'), 'to_branch_id', tests.branch('AMN'), 'txn_date', tests.today(),
    'performed_by_staff', 'DEMO-1', 'lines', '[{"sku":"DEMOPROD","qty":1}]'::jsonb)), 'INVALID_DESTINATION', 'demo → real refused');
  -- global master data is HQ-admin only (no master-data RPCs yet; the capability says no, and grants deny writes)
  perform tests.login('demo');
  perform tests.raises(format('update public.tbl_inv_products set charge_price = 0.01 where sku = %L', 'GLOVES'), 'permission denied%', 'demo cannot touch the catalogue');
  perform tests.logout();
end $$;

-- @test capability matrix (D-134): shared branch login is Head-Nurse tier, approvals stay with MOD/ADMIN
do $$
begin
  perform tests.impersonate('amn');
  perform tests.eq(public.fn_inv_can('ISSUE', 1), true, 'staff action');
  perform tests.eq(public.fn_inv_can('RECEIPT', 1), true, 'HN action on the branch login (V1)');
  perform tests.eq(public.fn_inv_can('TRANSIT_RELEASE', 1), true, 'HN action');
  perform tests.eq(public.fn_inv_can('REVERSE', 1), false, 'MOD action');
  perform tests.eq(public.fn_inv_can('PERIOD_LOCK', 1), false, 'MOD action');
  perform tests.eq(public.fn_inv_can('ISSUE', 3), false, 'other branch');
  perform tests.eq(public.fn_inv_can('MASTER_DATA', null), false, 'global master data');
  perform tests.eq(public.fn_inv_can('NO_SUCH_ACTION', 1), false, 'unknown action denied');
  perform tests.logout();
  perform tests.impersonate('hqmod');
  perform tests.eq(public.fn_inv_can('REVERSE', 4), true, 'HQ moderator');
  perform tests.eq(public.fn_inv_can('PERIOD_REOPEN', 4), false, 'reopen is ADMIN');
  perform tests.eq(public.fn_inv_can('ISSUE', 6), false, 'not demo');
  perform tests.logout();
  perform tests.impersonate('hqadmin');
  perform tests.eq(public.fn_inv_can('MASTER_DATA', null), true, 'HQ admin');
  perform tests.logout();
  perform tests.impersonate('demo');
  perform tests.eq(public.fn_inv_can('MASTER_DATA_DEMO', 6), true, 'demo admin owns demo rows');
  perform tests.eq(public.fn_inv_can('MASTER_DATA', null), false, 'but not global rows');
  perform tests.logout();
end $$;

-- @test anon and grants: anon has nothing; authenticated can only SELECT and call inv_* RPCs
do $$
begin
  perform tests.as_anon();
  perform tests.raises('select count(*) from public.tbl_inv_txns', 'permission denied%', 'anon select table');
  perform tests.raises('select count(*) from public.v_inv_stock_balance', 'permission denied%', 'anon select view');
  perform tests.raises('select public.inv_post_issue(''{}'', gen_random_uuid())', 'permission denied%', 'anon RPC');
  perform tests.raises('select public.inv_accessible_branch_ids()', 'permission denied%', 'anon helper');
  perform tests.logout();
  perform tests.eq((
    select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','v','S')
       and (c.relname like 'tbl\_inv\_%' or c.relname like 'v\_inv\_%')
       and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                else has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') end)::int,
    0, 'anon: no privilege on r/v/S');
  perform tests.eq((
    select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','v')
       and (c.relname like 'tbl\_inv\_%' or c.relname like 'v\_inv\_%')
       and has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))::int, 0, 'authenticated: SELECT only');
  perform tests.eq((
    select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'tbl\_inv\_%'
       and case when c.relkind = 'S' then has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') else false end)::int, 0, 'authenticated: no sequences');
  perform tests.eq((
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'inv\_%' or p.proname like 'fn\_inv\_%')
       and has_function_privilege('anon', p.oid, 'EXECUTE'))::int, 0, 'anon: no EXECUTE');
  perform tests.eq((
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fn\_inv\_%'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE'))::int, 0, 'authenticated: no internal fn_inv_*');
  perform tests.eq((
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'inv\_%' and p.prosecdef
       and not (coalesce(p.proconfig, '{}') @> array['search_path=""']))::int, 0, 'every definer RPC pins search_path');
  perform tests.eq((
    select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'tbl\_inv\_%' and not c.relrowsecurity)::int, 0, 'RLS on every table');
  perform tests.eq((
    select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid
     where c.relname like 'tbl\_inv\_%' and pol.polcmd <> 'r')::int, 0, 'SELECT-only policies');
end $$;

-- @test DEMO purge (postgres only) removes demo rows and leaves real branches alone
do $$
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'PG1', '[{"sku":"GLOVES","qty":10,"unit_cost":1}]'), 'real');
  perform tests.ok(tests.receipt('demo', 'DEMO', 'PG2', '[{"sku":"DEMOPROD","qty":5,"unit_cost":1}]',
    jsonb_build_object('received_by_staff', 'DEMO-HN', 'supplier_id', (select id from public.tbl_inv_suppliers where owner_branch_id = 6))), 'demo');
  perform tests.ok(tests.issue('demo', jsonb_build_object('performed_by_staff', 'DEMO-1', 'target', 'RESIDENT', 'resident_id', tests.res('R5'),
    'lines', '[{"sku":"DEMOPROD","qty":1,"loc":"DEMO/STORE"}]'::jsonb)), 'demo issue');
  perform public.fn_inv_purge_demo();
  perform tests.eq((select count(*) from public.tbl_inv_txns where branch_id = 6)::int, 0, 'demo ledger gone');
  perform tests.eq((select count(*) from public.tbl_inv_products where owner_branch_id = 6)::int, 0, 'demo products gone');
  perform tests.eq((select count(*) from public.tbl_inv_txns where branch_id = 1)::int, 1, 'AMN untouched');
  perform tests.eq((select count(*) from public.tbl_inv_locations where branch_id = 6)::int, 3, 'demo locations kept');
  perform tests.login('demo');
  perform tests.raises('select public.fn_inv_purge_demo()', 'permission denied%', 'not callable by the demo login');
  perform tests.logout();
end $$;

-- ============================================================================
-- Phase 1 audit fixes (docs/inventory-design-audit.md, P1-1 … P1-20)
-- Every block runs in a FRESH database session (runner, P1-9), so each call
-- below is the first of its kind in its backend.
-- ============================================================================

-- @test P1-1 regression: reversing an ISSUE is the first reversal in a fresh session
do $$
declare
  d jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P11', '[{"sku":"GLOVES","qty":10,"unit_cost":1.00}]'), 'stock');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'lines', '[{"sku":"GLOVES","qty":2,"loc":"AMN/STORE"}]'::jsonb)), 'issue');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', d->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_QTY')), 'first reversal in this backend works');
end $$;

-- @test P1-1 regression: reversing a RECEIPT is the first reversal in a fresh session
do $$
declare
  r jsonb;
begin
  r := tests.ok(tests.receipt('amn', 'AMN', 'P11B', '[{"sku":"GLOVES","qty":10,"unit_cost":1.00}]'), 'stock');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', r->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'receipt reversal works first time');
end $$;

-- @test P1-2: a posting after the review makes it stale; a month is reviewed only after it ends
do $$
declare
  gl date := tests.go_live();
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P12', '[{"sku":"GAUZE","qty":10,"unit_cost":1.00}]',
    jsonb_build_object('received_date', gl, 'invoice_date', gl)), 'stock last month');
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'reviewed');
  -- the auditor's probe: back-dated OSEM issue of 500 units, taking the Floor negative, after the review
  perform tests.ok(tests.issue('amn', jsonb_build_object('txn_date', gl, 'performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'allow_negative', true, 'lines', '[{"sku":"GAUZE","qty":500,"loc":"AMN/FLOOR"}]'::jsonb)), 'late back-dated issue');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'EXCEPTIONS_STALE', 'lock refused: review is stale');
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'review again');
  -- a late SERVICE charge (no ledger row) also makes the review stale
  perform tests.ok(tests.call('amn', 'inv_charge_service', jsonb_build_object('target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'charge_date', gl, 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"SVC","uom":"JOB","qty":1}]'::jsonb)), 'late service charge');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'EXCEPTIONS_STALE', 'charge-only posting also stales');
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'review a third time');
  perform tests.ok(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'now it locks');
  -- the current month has not ended: no review yet
  perform tests.code(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1,
    'period_month', date_trunc('month', tests.today())::date, 'performed_by_staff', 'HQ-ND')), 'MONTH_NOT_ENDED', 'running month');
  -- with a frozen clock on the last day of the go-live month, that month has not ended either
  perform tests.freeze_today((gl + interval '1 month' - interval '1 day')::date);
  perform tests.code(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 3, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'MONTH_NOT_ENDED', 'last day of the month is not "ended"');
  perform tests.freeze_today((gl + interval '1 month')::date);
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 3, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'first day of the next month: reviewable');
end $$;

-- @test D-157: a zero-value inflow into Q <= 0 takes the incoming cost (FOC → 0); unknown stays unknown
do $$
declare
  r record;
  d jsonb;
begin
  -- owner example: Q -10 @ 10.00 + 10 @ 11.00 → negative value negated, W 11.00
  select * into r from public.fn_inv_pool_in(-10, -100.00, 10.00, 10, 110.00);
  perform tests.eq(r.w, 11.00::numeric, 'W = incoming cost');
  perform tests.eq(r.v, 0::numeric, 'Q 0 → V 0');
  -- maths: Q -3, V -3.00, W 1.00 + 10 free units → W 0, V 0
  select * into r from public.fn_inv_pool_in(-3, -3.00, 1.00, 10, 0);
  perform tests.eq(r.w, 0::numeric, 'W = FOC cost 0');
  perform tests.eq(r.v, 0::numeric, 'V 0');
  perform tests.eq(r.reval, 3.00::numeric, 'negative value written off');
  select * into r from public.fn_inv_pool_in(-3, 0, null, 3, 0);
  perform tests.eq(r.w, null::numeric, 'unknown cost stays unknown');
  -- engine: FOC-only receipt into a negative pool
  perform tests.ok(tests.receipt('amn', 'AMN', 'P13A', '[{"sku":"GAUZE","qty":5,"unit_cost":1.00}]'), 'stock 5 @ 1.00');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'allow_negative', true, 'lines', '[{"sku":"GAUZE","qty":8,"loc":"AMN/STORE"}]'::jsonb)), 'go to -3');
  perform tests.ok(tests.receipt('amn', 'AMN', 'P13B', '[{"sku":"GAUZE","qty":0,"foc_qty":10,"unit_cost":0}]'), 'FOC only');
  perform tests.eq((tests.pool('AMN','GAUZE')).wac, 0::numeric, 'WAC = FOC cost 0');
  perform tests.eq((tests.pool('AMN','GAUZE')).value, 0::numeric, 'pool value');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'lines', '[{"sku":"GAUZE","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'next issue');
  perform tests.eq((select unit_cost from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint), 0::numeric, 'costed at 0');
  -- engine: reversing a PENDING_COST issue keeps the pool uncosted (D-147)
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'allow_negative', true, 'lines', '[{"sku":"NEWPROD","qty":2,"loc":"AMN/STORE"}]'::jsonb)), 'pending issue');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', d->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse it');
  perform tests.eq((tests.pool('AMN','NEWPROD')).wac, null::numeric, 'WAC still unknown');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'allow_negative', true, 'lines', '[{"sku":"NEWPROD","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'next pending issue');
  perform tests.eq((select cost_source from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint), 'PENDING_COST', 'still flagged');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'I1 holds');
end $$;

-- @test P1-4: an HQ STAFF login can look but cannot act (no Head-Nurse powers anywhere)
do $$
begin
  perform tests.ok(tests.receipt('bmn', 'BMN', 'P14', '[{"sku":"GLOVES","qty":10,"unit_cost":1.00}]'), 'BMN stock');
  perform tests.impersonate('hqstaff');
  perform tests.eq(public.fn_inv_can('RECEIPT', 3), false, 'no receipt at BMN');
  perform tests.eq(public.fn_inv_can('TRANSIT_RELEASE', 4), false, 'no release at BGN');
  perform tests.eq(public.fn_inv_can('ISSUE', 1), false, 'no issue either');
  perform tests.eq(public.inv_my_rank(), 0, 'rank 0');
  perform tests.logout();
  perform tests.impersonate('amn');
  perform tests.eq(public.fn_inv_can('RECEIPT', 1), true, 'the NUR branch login keeps Head-Nurse tier');
  perform tests.logout();
  perform tests.code(tests.receipt('hqstaff', 'BMN', 'P14B', '[{"sku":"GLOVES","qty":1,"unit_cost":1.00}]'), 'FORBIDDEN', 'cannot post');
  perform tests.login('hqstaff');
  perform tests.eq((select count(*) > 0 from public.tbl_inv_txns where branch_id = 3), true, 'can read BMN stock movements');
  perform tests.eq((select count(*) > 0 from public.tbl_inv_products), true, 'can read the catalogue');
  perform tests.eq((select count(*) from public.tbl_inv_charges)::int, 0, 'no charges (rank < 2)');
  perform tests.logout();
end $$;

-- @test D-158: no write-off limit; repeated, back-dated and uncosted write-offs all post; reversal works
do $$
declare
  d jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P15', '[{"sku":"GLOVES","qty":200,"unit_cost":1.10}]'), 'stock @ 1.10');
  d := tests.ok(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'DAMAGED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":45}]'::jsonb)), '49.50');
  perform tests.ok(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'DAMAGED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":45}]'::jsonb)),
    'second the same day');
  perform tests.ok(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'reason_code', 'EXPIRED', 'txn_date', tests.today() - 1, 'performed_by_staff', 'AMN-1', 'allow_negative', true,
    'lines', '[{"sku":"GLOVES","qty":1}]'::jsonb)), 'back-dated');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', d->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_QTY')), 'reverse the first');
  perform tests.ok(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'EXPIRED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'allow_negative', true,
    'lines', '[{"sku":"NEWPROD","qty":900}]'::jsonb)), 'uncosted posts without approval');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'I1 holds');
end $$;

-- @test P1-6: goods dispatched but not received by month end are in the sender's closing figures
do $$
declare
  gl date := tests.go_live();
  t jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P16', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]',
    jsonb_build_object('received_date', gl, 'invoice_date', gl)), 'stock');
  t := tests.ok(tests.call('amn', 'inv_dispatch_branch_transfer', jsonb_build_object(
    'from_location_id', tests.loc('AMN','STORE'), 'to_branch_id', tests.branch('BMN'), 'txn_date', gl,
    'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":40}]'::jsonb)), 'dispatch 40 last month');
  -- received this month: still in transit as at last month's end
  perform tests.ok(tests.call('bmn', 'inv_receive_branch_transfer', jsonb_build_object(
    'transfer_id', t->'transfer_id', 'txn_date', tests.today(), 'performed_by_staff', 'BMN-1')), 'received this month');
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'review');
  perform tests.ok(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'lock AMN');
  perform tests.eq((select value from public.tbl_inv_period_closing where branch_id = 1 and location_id is null
                     and in_transit_transfer_id is null and product_id = tests.prod('GLOVES')), 60::numeric, 'AMN pool 60');
  perform tests.eq((select qty::text || '/' || value from public.tbl_inv_period_closing where branch_id = 1
                     and in_transit_transfer_id = (t->>'transfer_id')::bigint), '40.0000/40.0000', 'RM 40 in transit at month end');
  perform tests.eq((select sum(value) from public.tbl_inv_period_closing where branch_id = 1 and location_id is null), 100::numeric,
                   'nothing lost: 60 on hand + 40 in transit');
end $$;

-- @test P1-7: a charge credit cannot be dated before the charge
do $$
declare
  d jsonb;
begin
  d := tests.ok(tests.call('amn', 'inv_charge_service', jsonb_build_object('target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'charge_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"SVC","uom":"JOB","qty":1}]'::jsonb)), 'charge today');
  perform tests.code(tests.call('hqmod', 'inv_reverse_charge', jsonb_build_object('charge_id', d->'charge_ids'->0,
    'charge_date', tests.go_live(), 'performed_by_staff', 'HQ-ND', 'reason', 'charged twice')), 'DATE_BEFORE_ORIGINAL', 'credit before charge');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_charge', jsonb_build_object('charge_id', d->'charge_ids'->0,
    'performed_by_staff', 'HQ-ND', 'reason', 'charged twice')), 'credit today');
end $$;

-- @test P1-10: reversals of internal moves and write-offs after the WAC has moved restore stock exactly
do $$
declare
  a jsonb; b jsonb; c jsonb; w jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P110A', '[{"sku":"MILK","qty":20,"unit_cost":10.00}]'), 'stock @ 10');
  a := tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'INTERNAL',
    'from_location_id', tests.loc('AMN','STORE'), 'to_location_id', tests.loc('AMN','FLOOR'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":5}]'::jsonb)), 'S→F');
  b := tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'ALLOCATE',
    'from_location_id', tests.loc('AMN','STORE'), 'to_location_id', tests.loc('AMN','TRANSIT'), 'resident_id', tests.res('R1'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":4}]'::jsonb)), 'allocate');
  c := tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'RELEASE',
    'from_location_id', tests.loc('AMN','TRANSIT'), 'to_location_id', tests.loc('AMN','STORE'), 'resident_id', tests.res('R1'),
    'reason_code', 'DISCHARGED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-HN', 'lines', '[{"sku":"MILK","qty":1}]'::jsonb)), 'release');
  w := tests.ok(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'reason_code', 'DAMAGED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"MILK","qty":1}]'::jsonb)), 'write-off');
  -- the WAC moves: 10 more @ 13.00 → (19 x 10 + 130) / 29
  perform tests.ok(tests.receipt('amn', 'AMN', 'P110B', '[{"sku":"MILK","qty":10,"unit_cost":13.00}]'), 'more @ 13');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', w->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse write-off');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', c->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse release');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', b->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse allocation');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', a->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse S→F');
  perform tests.eq(tests.bucket('AMN','STORE','MILK'), 30::numeric, 'all 30 back in Store');
  perform tests.eq(tests.bucket('AMN','FLOOR','MILK'), 0::numeric, 'Floor empty');
  perform tests.eq(tests.bucket('AMN','TRANSIT','MILK','R1'), 0::numeric, 'Transit empty');
  perform tests.eq((tests.pool('AMN','MILK')).value, 330::numeric, 'pool value = 200 + 130 (write-off credited at its cost)');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'I1 holds');
end $$;

-- @test P1-10: a corrected receipt can itself be reversed; released allocation blocks the receipt reversal
do $$
declare
  r jsonb;
  c jsonb;
begin
  r := tests.ok(tests.receipt('amn', 'AMN', 'P110C', '[{"sku":"GAUZE","qty":10,"unit_cost":1.00}]'), 'receipt');
  c := tests.ok(tests.call('hqmod', 'inv_correct_receipt', jsonb_build_object('receipt_id', r->'receipt_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'WRONG_COST', 'receipt', jsonb_build_object(
      'supplier_id', (select id from public.tbl_inv_suppliers where owner_branch_id is null),
      'invoice_no', 'P110C', 'invoice_date', tests.today(), 'lines', tests.lines('[{"sku":"GAUZE","qty":10,"unit_cost":1.20}]')))), 'correct');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', c->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse the corrected receipt');
  perform tests.eq(tests.bucket('AMN','STORE','GAUZE'), 0::numeric, 'empty');
  perform tests.eq((tests.pool('AMN','GAUZE')).value, 0::numeric, 'no value left');
  perform tests.eq((select count(*) from public.tbl_inv_receipts where invoice_no = 'P110C' and not is_voided)::int, 0, 'both receipts voided');
  -- receive & allocate, then the Transit stock is RELEASED (not issued): message says "used"
  r := tests.ok(tests.receipt('amn', 'AMN', 'P110D', '[{"sku":"MILK","qty":3,"unit_cost":20.00,"res":"R1"}]'), 'receive & allocate');
  perform tests.ok(tests.call('amn', 'inv_post_transfer', jsonb_build_object('kind', 'RELEASE',
    'from_location_id', tests.loc('AMN','TRANSIT'), 'to_location_id', tests.loc('AMN','STORE'), 'resident_id', tests.res('R1'),
    'reason_code', 'DISCHARGED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-HN', 'lines', '[{"sku":"MILK","qty":3}]'::jsonb)), 'release');
  perform tests.code(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', r->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'TRANSIT_STOCK_USED', 'released stock blocks the cascade');
end $$;

-- @test P1-13: rejected calls leave no period, pool, bucket or counter rows behind
do $$
declare
  n0 int;
  n1 int;
begin
  n0 := (select count(*) from public.tbl_inv_balances) + (select count(*) from public.tbl_inv_cost_pools)
      + (select count(*) from public.tbl_inv_counters) + (select count(*) from public.tbl_inv_billing_periods);
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'lines', '[{"sku":"GAUZE","qty":8,"loc":"AMN/STORE"}]'::jsonb)), 'NEGATIVE_STOCK_CONFIRM', 'negative warning');
  perform tests.code(tests.receipt('amn', 'AMN', 'P113', '[{"sku":"GLOVES","qty":6000,"unit_cost":1}]'), 'SANITY_CONFIRM', 'sanity warning');
  n1 := (select count(*) from public.tbl_inv_balances) + (select count(*) from public.tbl_inv_cost_pools)
      + (select count(*) from public.tbl_inv_counters) + (select count(*) from public.tbl_inv_billing_periods);
  perform tests.eq(n1, n0, 'no rows left by rejections');
end $$;

-- @test P1-14: an unknown id answers exactly like another branch's id
do $$
begin
  perform tests.code(tests.call('amn', 'inv_reverse_txn', '{"txn_id": 999999, "performed_by_staff": "AMN-HN", "reason_code": "OTHER"}'),
    'FORBIDDEN', 'unknown txn');
  perform tests.code(tests.call('amn', 'inv_receive_branch_transfer', '{"transfer_id": 999999, "performed_by_staff": "AMN-1"}'),
    'FORBIDDEN', 'unknown transfer');
  perform tests.code(tests.issue('amn', '{"performed_by_staff": "AMN-1", "target": "OSEM_EXPENSE", "lines": [{"sku":"GLOVES","qty":1,"location_id":999999}]}'),
    'FORBIDDEN', 'unknown location');
  perform tests.code(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
    'lines', jsonb_build_array(jsonb_build_object('sku', 'GLOVES', 'qty', 1, 'location_id', tests.loc('BMN','STORE'))))),
    'FORBIDDEN', 'another branch location');
end $$;

-- @test P1-18: the paper invoice total is stored for information and never blocks
do $$
declare
  d jsonb;
begin
  d := tests.ok(tests.receipt('amn', 'AMN', 'P118', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]',
    '{"tax_total": 6.00, "invoice_total_paper": 105.00}'), 'receipt with paper total');
  perform tests.eq((select invoice_total_paper from public.tbl_inv_receipts where id = (d->>'receipt_id')::bigint), 105.00::numeric, 'stored');
  perform tests.eq((d->>'paper_difference')::numeric, -1.00::numeric, 'difference reported, not blocked');
  perform tests.code(tests.receipt('amn', 'AMN', 'P118B', '[{"sku":"GLOVES","qty":1,"unit_cost":1.00}]',
    '{"invoice_total_paper": -5}'), 'INVALID_TOTALS', 'must be a sane amount');
end $$;

-- @test P1-17: the grants file leaves nothing exposed and can be re-run on its own
do $$
begin
  perform tests.eq((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fn\_inv\_%' and p.prosecdef
       and not (coalesce(p.proconfig, '{}') @> array['search_path=""']))::int, 0, 'every definer fn_inv_* pins search_path');
  perform tests.eq((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'inv\_%' or p.proname like 'fn\_inv\_%')
       and has_function_privilege('service_role', p.oid, 'EXECUTE'))::int, 0, 'service_role executes nothing');
end $$;
