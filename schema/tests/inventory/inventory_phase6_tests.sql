-- ============================================================================
-- General Inventory — Phase 6 SQL tests (schema/019 charging and month-end)
-- ============================================================================
-- Same harness and rules as inventory_v1_tests.sql: every "-- @test" block
-- runs in its own fresh session inside BEGIN … ROLLBACK on top of the fixture.
-- Fixture facts used: NOPRICE (chargeable, no price; base TAB, STRIP = 10),
-- GLOVES 0.50/EA; amn = ALMA shared login (rank 2), bmn = other branch,
-- hqmod (rank 3), hqadmin, demo = DEMO branch admin; AMN-1 junior, AMN-HN
-- senior, HQ-ND senior HQ; residents R1/R2 (ALMA), R4 (Permai), R5 (Demo).
-- ============================================================================

-- @test P6 pricing: MOD prices a PRICE_PENDING line once, amount math, return credits then use the PRICING price
do $$
declare
  d jsonb;
  v_line bigint;
  v_charge bigint;
  pay jsonb;
  k uuid := gen_random_uuid();
  r jsonb;
  r1 jsonb;
  r2 jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P6-1', '[{"sku":"NOPRICE","uom":"STRIP","qty":2,"unit_cost":1}]'), 'stock 20 TAB');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"NOPRICE","uom":"TAB","qty":3,"loc":"AMN/STORE"}]'::jsonb)), 'pending issue');
  perform tests.eq((d->>'price_pending')::boolean, true, 'pending');
  v_line := (select id from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint);
  v_charge := (select id from public.tbl_inv_charges where txn_line_id = v_line);
  pay := jsonb_build_object('charge_id', v_charge, 'unit_charge_price', 0.25, 'reason', 'Price agreed with family', 'performed_by_staff', 'HQ-ND');

  perform tests.code(tests.call('amn', 'inv_price_charge', pay), 'FORBIDDEN', 'branch login cannot price');
  perform tests.code(tests.call('bmn', 'inv_price_charge', pay), 'FORBIDDEN', 'other branch');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay || '{"unit_charge_price": -1}'), 'INVALID_PRICE', 'negative');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay || '{"unit_charge_price": 0.12345}'), 'INVALID_PRICE', '5 dp');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay || '{"reason": "no"}'), 'INVALID_REASON', 'reason');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay - 'performed_by_staff'), 'STAFF_REQUIRED', 'staff');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay || '{"performed_by_staff": "BMN-1"}'), 'STAFF_WRONG_BRANCH', 'staff of another branch');

  r := tests.ok(tests.call('hqmod', 'inv_price_charge', pay, k), 'priced');
  perform tests.eq((r->>'charge_amount')::numeric, 0.75::numeric, 'amount = 3 × 0.25');
  perform tests.eq((select charge_kind || '/' || (qty_base = 0) || '/' || unit_charge_price || '/' || charge_amount || '/' || (related_charge_id = v_charge)
                      from public.tbl_inv_charges where id = (r->>'pricing_charge_id')::bigint),
                   'PRICING/true/0.2500/0.75/true', 'PRICING child');
  perform tests.eq((select billing_period_id from public.tbl_inv_charges where id = (r->>'pricing_charge_id')::bigint),
                   (select billing_period_id from public.tbl_inv_charges where id = v_charge), 'same period as the original');
  perform tests.eq((tests.call('hqmod', 'inv_price_charge', pay, k)->>'replayed')::boolean, true, 'replay');
  perform tests.eq((select count(*) from public.tbl_inv_charges where charge_kind = 'PRICING')::int, 1, 'one child');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay), 'ALREADY_PRICED', 'only once');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay || jsonb_build_object('charge_id', r->'pricing_charge_id')),
    'NOT_PRICE_PENDING', 'a PRICING row is not pending');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"NOPRICE","uom":"TAB","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'second pending');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay || jsonb_build_object('charge_id',
    (select c.id from public.tbl_inv_charges c where c.txn_id = (d->>'txn_id')::bigint)) || '{"reason":"x"}'), 'INVALID_REASON', 'still checked');
  -- a priced charge (GLOVES 0.50) is not pending
  perform tests.ok(tests.receipt('amn', 'AMN', 'P6-2', '[{"sku":"GLOVES","qty":10,"unit_cost":0.2}]'), 'gloves');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"GLOVES","qty":2,"loc":"AMN/STORE"}]'::jsonb)), 'priced issue');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay || jsonb_build_object('charge_id',
    (select c.id from public.tbl_inv_charges c where c.txn_id = (d->>'txn_id')::bigint))), 'NOT_PRICE_PENDING', 'already priced at posting');
  -- OSEM-expense charges are never priced
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE', 'expense_note', 'ward use',
         'lines', '[{"sku":"NOPRICE","uom":"TAB","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'expense issue');
  perform tests.code(tests.call('hqmod', 'inv_price_charge', pay || jsonb_build_object('charge_id',
    (select c.id from public.tbl_inv_charges c where c.txn_id = (d->>'txn_id')::bigint))), 'NOT_PRICE_PENDING', 'expense');

  -- returns after pricing credit at the PRICING price, the last units take the exact remainder (net 0)
  r1 := tests.ok(tests.call('amn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
          'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
          'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'TAB', 'qty', 1)))), 'return 1');
  perform tests.eq((r1->>'credit_amount')::numeric, -0.25::numeric, 'credit at the PRICING price');
  perform tests.eq((select unit_charge_price from public.tbl_inv_charges where txn_id = (r1->>'txn_id')::bigint), 0.25::numeric, 'credit carries the price');
  r2 := tests.ok(tests.call('amn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
          'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
          'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'TAB', 'qty', 2)))), 'return the rest');
  perform tests.eq((r2->>'credit_amount')::numeric, -0.50::numeric, 'remainder');
  perform tests.eq((select sum(charge_amount) from public.tbl_inv_charges where id = v_charge or related_charge_id = v_charge),
                   0::numeric, 'effective amount nets to zero');
end $$;

-- @test P6 pricing after a return bills only the net quantity; a priced-then-locked month refuses pricing
do $$
declare
  d jsonb;
  v_line bigint;
  v_charge bigint;
  r jsonb;
  gl date := tests.go_live();
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P6-3', '[{"sku":"NOPRICE","uom":"STRIP","qty":2,"unit_cost":1}]'), 'stock');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"NOPRICE","uom":"TAB","qty":4,"loc":"AMN/STORE"}]'::jsonb)), 'pending');
  v_line := (select id from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint);
  v_charge := (select id from public.tbl_inv_charges where txn_line_id = v_line);
  perform tests.ok(tests.call('amn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
    'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'TAB', 'qty', 1)))), 'return before pricing');
  r := tests.ok(tests.call('hqmod', 'inv_price_charge', jsonb_build_object('charge_id', v_charge, 'unit_charge_price', 2,
         'reason', 'Late price', 'performed_by_staff', 'HQ-ND')), 'price');
  perform tests.eq((r->>'charge_amount')::numeric, 6.00::numeric, '(4 - 1) × 2');

  -- a locked month refuses pricing
  d := tests.ok(tests.issue('amn', jsonb_build_object('txn_date', gl, 'performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R2'), 'allow_negative', true, 'lines', '[{"sku":"NOPRICE","uom":"TAB","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'pending last month');
  v_charge := (select c.id from public.tbl_inv_charges c where c.txn_id = (d->>'txn_id')::bigint);
  perform set_config('inv.posting', 'on', true);
  update public.tbl_inv_billing_periods set status = 'LOCKED', locked_at = now(), locked_by_account = 1
   where branch_id = 1 and period_month = date_trunc('month', gl)::date;
  perform set_config('inv.posting', 'off', true);
  perform tests.code(tests.call('hqmod', 'inv_price_charge', jsonb_build_object('charge_id', v_charge, 'unit_charge_price', 2,
    'reason', 'Too late', 'performed_by_staff', 'HQ-ND')), 'PERIOD_LOCKED', 'locked month');
end $$;

-- @test P6 manual adjustment: tier, scope, open-period rule, negative amounts, validation
do $$
declare
  gl date := tests.go_live();
  d jsonb;
  v_charge bigint;
  pay jsonb;
  r jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P6-4', '[{"sku":"GLOVES","qty":10,"unit_cost":0.2}]'), 'stock');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"GLOVES","qty":2,"loc":"AMN/STORE"}]'::jsonb)), 'issue');
  v_charge := (select c.id from public.tbl_inv_charges c where c.txn_id = (d->>'txn_id')::bigint);
  pay := jsonb_build_object('resident_id', tests.res('R1'), 'amount', -5.50, 'reason', 'Goodwill credit', 'performed_by_staff', 'HQ-ND');

  perform tests.code(tests.call('amn', 'inv_manual_charge_adjustment', pay), 'FORBIDDEN', 'branch login (rank 2)');
  perform tests.code(tests.call('bmn', 'inv_manual_charge_adjustment', pay), 'FORBIDDEN', 'other branch');
  perform tests.code(tests.call('demo', 'inv_manual_charge_adjustment', pay), 'FORBIDDEN', 'demo login, real resident');
  r := tests.ok(tests.call('hqmod', 'inv_manual_charge_adjustment', pay), 'negative allowed');
  perform tests.eq((select charge_kind || '/' || charge_amount || '/' || (qty_base = 0) || '/' || branch_id || '/' || (related_charge_id is null)
                      from public.tbl_inv_charges where id = (r->>'charge_id')::bigint),
                   'MANUAL_ADJUSTMENT/-5.50/true/1/true', 'row, no related charge');
  r := tests.ok(tests.call('hqadmin', 'inv_manual_charge_adjustment', jsonb_build_object('related_charge_id', v_charge,
         'amount', 12.34, 'reason', 'Extra fee', 'performed_by_staff', 'HQ-ND')), 'positive, resident from the related charge');
  perform tests.eq((select resident_id = tests.res('R1') and related_charge_id = v_charge from public.tbl_inv_charges
                     where id = (r->>'charge_id')::bigint), true, 'resident derived');
  perform tests.code(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || '{"amount": 0}'), 'INVALID_AMOUNT', 'zero');
  perform tests.code(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || '{"amount": 1.234}'), 'INVALID_AMOUNT', '3 dp');
  perform tests.code(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || '{"reason": "ok"}'), 'INVALID_REASON', 'reason');
  perform tests.code(tests.call('hqmod', 'inv_manual_charge_adjustment', pay - 'resident_id'), 'FORBIDDEN', 'no resident, no related charge: no branch to authorise');
  perform tests.code(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || jsonb_build_object('related_charge_id', v_charge,
    'resident_id', tests.res('R2'))), 'RESIDENT_MISMATCH', 'resident differs from the related charge');
  perform tests.code(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || jsonb_build_object('related_charge_id', v_charge,
    'resident_id', tests.res('R4'))), 'RESIDENT_MISMATCH', 'resident of another branch');
  perform tests.code(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || jsonb_build_object('charge_date', tests.today() + 1)),
    'DATE_IN_FUTURE', 'future');
  perform tests.code(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || jsonb_build_object('charge_date', gl - 40)),
    'DATE_BEFORE_GO_LIVE', 'before go-live');
  -- the branch comes from the resident: R4 posts into Permai
  r := tests.ok(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || jsonb_build_object('resident_id', tests.res('R4'))), 'Permai resident');
  perform tests.eq((select branch_id from public.tbl_inv_charges where id = (r->>'charge_id')::bigint), tests.branch('BMN'), 'branch from the resident');
  -- a past OPEN month is fine, a LOCKED one is not (D-75)
  perform tests.ok(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || jsonb_build_object('charge_date', gl)), 'open last month');
  perform set_config('inv.posting', 'on', true);
  update public.tbl_inv_billing_periods set status = 'LOCKED', locked_at = now(), locked_by_account = 1
   where branch_id = 1 and period_month = date_trunc('month', gl)::date;
  perform set_config('inv.posting', 'off', true);
  perform tests.code(tests.call('hqmod', 'inv_manual_charge_adjustment', pay || jsonb_build_object('charge_date', gl)), 'PERIOD_LOCKED', 'locked month');
  r := tests.ok(tests.call('hqmod', 'inv_manual_charge_adjustment', pay), 'today still fine');
  perform tests.eq((select count(*) from public.tbl_inv_audit_log where action = 'CHARGE_MANUAL_ADJUSTED')::int, 5, 'audited');
end $$;

-- @test P6 exceptions view: kinds, PRICE_PENDING blocking until priced, rank and branch scoping, DEMO isolation
do $$
declare
  d jsonb;
  v_charge bigint;
  n int;
  rows_seen text;
  v_r1 bigint := tests.res('R1');
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P6-5', '[{"sku":"NOPRICE","uom":"STRIP","qty":3,"unit_cost":1},{"sku":"GLOVES","qty":100,"unit_cost":0.2}]'), 'stock');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"NOPRICE","uom":"TAB","qty":2,"loc":"AMN/STORE"}]'::jsonb)), 'pending');
  v_charge := (select c.id from public.tbl_inv_charges c where c.txn_id = (d->>'txn_id')::bigint);
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE', 'expense_note', 'ward use',
    'lines', '[{"sku":"GLOVES","qty":5,"loc":"AMN/STORE"}]'::jsonb)), 'expense');
  perform tests.ok(tests.call('amn', 'inv_post_write_off', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'DAMAGED', 'txn_date', tests.today(), 'performed_by_staff', 'AMN-1', 'lines', '[{"sku":"GLOVES","qty":10}]'::jsonb)), 'write-off');
  -- DEMO branch: its own pending charge
  perform tests.ok(tests.receipt('demo', 'DEMO', 'P6-D', '[{"sku":"NOPRICE","uom":"STRIP","qty":1,"unit_cost":1}]'), 'demo stock');
  perform tests.ok(tests.issue('demo', jsonb_build_object('performed_by_staff', 'DEMO-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R5'), 'lines', '[{"sku":"NOPRICE","uom":"TAB","qty":1,"loc":"DEMO/STORE"}]'::jsonb)), 'demo pending');

  perform tests.login('hqmod');
  select string_agg(kind || ':' || is_blocking::text || ':' || from_branch_login::text, ',' order by kind) into rows_seen
    from public.v_inv_exceptions where branch_id = 1;
  perform tests.logout();
  perform tests.eq(rows_seen,
    'OSEM_EXPENSE_ISSUE:false:true,PRICE_PENDING:true:true,WRITE_OFF:false:true', 'kinds, blocking flag, branch-login flag');
  perform tests.login('hqmod');
  select count(*) into n from public.v_inv_exceptions where branch_id = 6;
  perform tests.eq(n, 0, 'non-demo login does not see demo rows');
  select count(*) into n from public.v_inv_exceptions where kind = 'PRICE_PENDING' and amount = 0 and qty = 2 and resident_id = v_r1;
  perform tests.eq(n, 1, 'qty and resident on the row');
  perform tests.logout();
  perform tests.login('amn');
  select count(*) into n from public.v_inv_exceptions;
  perform tests.logout();
  perform tests.eq(n, 0, 'branch login (rank 2) sees nothing');
  perform tests.login('bmn');
  select count(*) into n from public.v_inv_exceptions;
  perform tests.logout();
  perform tests.eq(n, 0, 'other branch sees nothing');
  perform tests.login('demo');
  select count(*) into n from public.v_inv_exceptions where branch_id <> 6;
  perform tests.eq(n, 0, 'demo login sees no real branch');
  select count(*) into n from public.v_inv_exceptions where branch_id = 6 and kind = 'PRICE_PENDING';
  perform tests.eq(n, 1, 'demo login sees its own');
  perform tests.logout();
  perform tests.as_anon();
  perform tests.raises('select count(*) from public.v_inv_exceptions', '%permission denied%', 'anon');
  perform tests.logout();

  -- pricing clears it
  perform tests.ok(tests.call('hqmod', 'inv_price_charge', jsonb_build_object('charge_id', v_charge, 'unit_charge_price', 0.4,
    'reason', 'Standard price', 'performed_by_staff', 'HQ-ND')), 'priced');
  perform tests.login('hqmod');
  select count(*) into n from public.v_inv_exceptions where kind = 'PRICE_PENDING' and branch_id = 1;
  perform tests.logout();
  perform tests.eq(n, 0, 'no longer pending');

  -- a reversed write-off drops out
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object(
    'txn_id', (select id from public.tbl_inv_txns where txn_type = 'DAMAGED_EXPIRED' and branch_id = 1),
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse write-off');
  perform tests.login('hqmod');
  select count(*) into n from public.v_inv_exceptions where kind = 'WRITE_OFF';
  perform tests.logout();
  perform tests.eq(n, 0, 'reversed write-off not listed');
end $$;

-- @test P6 exceptions view: negative-stock confirmation is listed and attributed
do $$
declare
  kinds text;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P6-6', '[{"sku":"GLOVES","qty":50,"unit_cost":0.2}]'), 'stock');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
    'resident_id', tests.res('R1'), 'allow_negative', true,
    'lines', '[{"sku":"GLOVES","qty":500,"loc":"AMN/STORE"}]'::jsonb)), 'negative issue');
  perform tests.login('hqmod');
  select string_agg(distinct kind, ',' order by kind) into kinds from public.v_inv_exceptions where branch_id = 1;
  perform tests.logout();
  perform tests.eq(kinds, 'NEGATIVE_STOCK_CONFIRMED', 'negative-stock confirmation is listed');
end $$;

-- @test P6 lock: PRICE_PENDING blocks, pricing then review then lock succeeds
do $$
declare
  gl date := tests.go_live();
  d jsonb;
  v_charge bigint;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P6-7', '[{"sku":"NOPRICE","uom":"STRIP","qty":2,"unit_cost":1}]',
    jsonb_build_object('received_date', gl, 'invoice_date', gl)), 'stock last month');
  d := tests.ok(tests.issue('amn', jsonb_build_object('txn_date', gl, 'performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"NOPRICE","uom":"TAB","qty":2,"loc":"AMN/STORE"}]'::jsonb)), 'pending last month');
  v_charge := (select c.id from public.tbl_inv_charges c where c.txn_id = (d->>'txn_id')::bigint);
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'reviewed');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'PRICE_PENDING_EXISTS', 'blocked');
  perform tests.ok(tests.call('hqmod', 'inv_price_charge', jsonb_build_object('charge_id', v_charge, 'unit_charge_price', 0.3,
    'reason', 'Standard price', 'performed_by_staff', 'HQ-ND')), 'priced');
  perform tests.code(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'EXCEPTIONS_STALE', 'pricing is a posting after the review');
  perform tests.ok(tests.call('hqmod', 'inv_mark_exceptions_reviewed', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'review again');
  perform tests.ok(tests.call('hqmod', 'inv_lock_period', jsonb_build_object('branch_id', 1, 'period_month', gl,
    'performed_by_staff', 'HQ-ND')), 'locked');
  -- a locked month can still be read and exported
  perform tests.ok(tests.call('hqmod', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R1'), 'billing_code', 'C-R1')), 'code');
  perform tests.eq((tests.ok(tests.call('hqmod', 'inv_export_charges', jsonb_build_object('branch_id', 1,
    'period', to_char(gl, 'YYYY-MM'), 'layout', 'ITEMISED')), 'export locked month')->>'period_locked')::boolean, true, 'says locked');
end $$;

-- @test P6 billing codes: tier, uniqueness, validation, scope
do $$
declare
  r jsonb;
begin
  perform tests.code(tests.call('amn', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R1'), 'billing_code', 'C-1')),
    'FORBIDDEN', 'branch login');
  perform tests.code(tests.call('demo', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R1'), 'billing_code', 'C-1')),
    'FORBIDDEN', 'demo login, real resident');
  perform tests.ok(tests.call('hqmod', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R1'), 'billing_code', ' C-1 ')), 'set (trimmed)');
  perform tests.eq((select billing_code from public.tbl_inv_resident_billing where resident_id = tests.res('R1')), 'C-1', 'stored trimmed');
  perform tests.ok(tests.call('hqmod', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R1'), 'billing_code', 'C-1B')), 'change');
  perform tests.eq((select billing_code from public.tbl_inv_resident_billing where resident_id = tests.res('R1')), 'C-1B', 'updated');
  perform tests.code(tests.call('hqmod', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R2'), 'billing_code', 'C-1B')),
    'DUPLICATE_BILLING_CODE', 'unique');
  perform tests.code(tests.call('hqmod', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R2'), 'billing_code', '')),
    'INVALID_BILLING_CODE', 'empty');
  perform tests.code(tests.call('hqmod', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R2'), 'billing_code', repeat('x', 41))),
    'INVALID_BILLING_CODE', 'too long');
  perform tests.eq((select branch_id from public.tbl_inv_resident_billing where resident_id = tests.res('R1')), 1::bigint, 'branch from the resident');
  perform tests.eq((select count(*) from public.tbl_inv_audit_log where action = 'BILLING_CODE_SET')::int, 2, 'audited');
end $$;

-- @test P6 export: tier, MISSING_BILLING_CODE, delta, full re-export, SUMMARY = ITEMISED, replay, locked month
do $$
declare
  per text := to_char(tests.today(), 'YYYY-MM');
  d jsonb;
  e1 jsonb;
  e2 jsonb;
  e3 jsonb;
  e4 jsonb;
  e5 jsonb;
  k uuid := gen_random_uuid();
  pay jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P6-8', '[{"sku":"GLOVES","qty":100,"unit_cost":0.2}]'), 'stock');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R1'),
    'lines', '[{"sku":"GLOVES","qty":10,"loc":"AMN/STORE"}]'::jsonb)), 'R1 5.00');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT', 'resident_id', tests.res('R2'),
    'lines', '[{"sku":"GLOVES","qty":2,"loc":"AMN/STORE"}]'::jsonb)), 'R2 1.00');
  perform tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE', 'expense_note', 'x',
    'lines', '[{"sku":"GLOVES","qty":2,"loc":"AMN/STORE"}]'::jsonb)), 'expense: never exported');
  pay := jsonb_build_object('branch_id', 1, 'period', per, 'layout', 'ITEMISED');

  perform tests.code(tests.call('amn', 'inv_export_charges', pay), 'FORBIDDEN', 'branch login');
  perform tests.code(tests.call('hqmod', 'inv_export_charges', pay || '{"branch_id": 6}'), 'FORBIDDEN', 'demo branch from a real login');
  perform tests.code(tests.call('hqmod', 'inv_export_charges', pay || '{"layout": "PDF"}'), 'INVALID_PAYLOAD', 'layout');
  perform tests.code(tests.call('hqmod', 'inv_export_charges', pay || '{"period": "2026-13"}'), 'INVALID_PAYLOAD', 'period');
  perform tests.code(tests.call('hqmod', 'inv_export_charges', pay || '{"period": "2001-01"}'), 'PERIOD_NOT_FOUND', 'no such period');
  e1 := tests.call('hqmod', 'inv_export_charges', pay);
  perform tests.code(e1, 'MISSING_BILLING_CODE', 'codes first');
  perform tests.eq(jsonb_array_length(e1->'data'->'residents'), 2, 'both residents listed');
  perform tests.eq((select count(*) from public.tbl_inv_charge_exports)::int, 0, 'nothing written');
  perform tests.ok(tests.call('hqmod', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R1'), 'billing_code', 'C-R1')), 'code R1');
  e1 := tests.call('hqmod', 'inv_export_charges', pay);
  perform tests.eq(e1->'data'->'residents'->0->>'resident_ref', 'AMN-0002', 'only R2 still missing');
  perform tests.ok(tests.call('hqmod', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R2'), 'billing_code', 'C-R2')), 'code R2');

  e1 := tests.ok(tests.call('hqmod', 'inv_export_charges', pay, k), 'first export');
  perform tests.eq((e1->>'row_count')::int, 2, 'two lines');
  perform tests.eq((e1->>'total_amount')::numeric, 6.00::numeric, 'total');
  perform tests.eq(e1->'rows'->0->>'billing_code', 'C-R1', 'ordered by resident');
  perform tests.eq((e1->'rows'->0->>'amount')::numeric, 5.00::numeric, 'amount');
  perform tests.eq(e1->'rows'->0->>'kind', 'ISSUE', 'kind');
  perform tests.eq(e1->'rows'->0->>'sku', 'GLOVES', 'sku');
  perform tests.eq((e1->'rows'->0->>'is_prior_period_credit')::boolean, false, 'not a prior period credit');
  perform tests.eq(e1->'rows'->0->>'txn_no' like 'AMN-TXN-%', true, 'txn no');
  perform tests.eq(e1->>'export_no' like 'AMN-EXP-%', true, 'export no');
  perform tests.eq((e1->>'period_locked')::boolean, false, 'open');
  perform tests.eq(length(e1->>'file_sha256'), 64, 'sha256 hex');
  perform tests.eq((select encode(file_sha256, 'hex') from public.tbl_inv_charge_exports where id = (e1->>'export_id')::bigint), e1->>'file_sha256', 'stored');
  perform tests.eq((select count(*) from public.tbl_inv_charge_export_items where export_id = (e1->>'export_id')::bigint)::int, 2, 'items');
  perform tests.eq((tests.call('hqmod', 'inv_export_charges', pay, k)->>'replayed')::boolean, true, 'replay');
  perform tests.eq((select count(*) from public.tbl_inv_charge_exports)::int, 1, 'replay wrote nothing');

  e2 := tests.ok(tests.call('hqmod', 'inv_export_charges', pay), 'second delta');
  perform tests.eq((e2->>'row_count')::int, 0, 'delta empty');
  perform tests.eq(e2->>'export_id', null, 'no export row');
  perform tests.eq((select count(*) from public.tbl_inv_charge_exports)::int, 1, 'still one export');

  -- new activity: a negative manual adjustment is in the next delta
  perform tests.ok(tests.call('hqmod', 'inv_manual_charge_adjustment', jsonb_build_object('resident_id', tests.res('R1'), 'amount', -1.50,
    'reason', 'Goodwill credit', 'performed_by_staff', 'HQ-ND')), 'adjustment');
  e3 := tests.ok(tests.call('hqmod', 'inv_export_charges', pay), 'delta with the adjustment');
  perform tests.eq((e3->>'row_count')::int, 1, 'only the new line');
  perform tests.eq(e3->'rows'->0->>'kind', 'MANUAL_ADJUSTMENT', 'kind');
  perform tests.eq((e3->>'total_amount')::numeric, -1.50::numeric, 'negative total');

  e4 := tests.ok(tests.call('hqmod', 'inv_export_charges', pay || '{"full": true}'), 'full re-export');
  perform tests.eq((e4->>'row_count')::int, 3, 'all lines again');
  perform tests.eq((e4->>'is_full')::boolean, true, 'flagged');
  perform tests.eq((select is_full from public.tbl_inv_charge_exports where id = (e4->>'export_id')::bigint), true, 'flag stored');
  perform tests.eq((e4->>'total_amount')::numeric, 4.50::numeric, 'full total');
  e5 := tests.ok(tests.call('hqmod', 'inv_export_charges', pay || '{"full": true, "layout": "SUMMARY"}'), 'summary');
  perform tests.eq((e5->>'row_count')::int, 2, 'one row per resident');
  perform tests.eq((e5->>'total_amount')::numeric, (e4->>'total_amount')::numeric, 'SUMMARY total = ITEMISED total');
  perform tests.eq((select sum((x->>'amount')::numeric) from jsonb_array_elements(e5->'rows') x),
                   (select sum((x->>'amount')::numeric) from jsonb_array_elements(e4->'rows') x), 'row sums agree');
  perform tests.eq((e5->'rows'->0->>'line_count')::int, 2, 'R1 has an issue and an adjustment');
  perform tests.eq((e5->'rows'->0->>'amount')::numeric, 3.50::numeric, 'R1 = 5.00 - 1.50');

  -- a locked month exports too
  perform set_config('inv.posting', 'on', true);
  update public.tbl_inv_billing_periods set status = 'LOCKED', locked_at = now(), locked_by_account = 1
   where branch_id = 1 and period_month = date_trunc('month', tests.today())::date;
  perform set_config('inv.posting', 'off', true);
  perform tests.eq((tests.ok(tests.call('hqmod', 'inv_export_charges', pay || '{"full": true}'), 'locked export')->>'period_locked')::boolean, true, 'locked reported');
  perform tests.eq((select count(*) from public.tbl_inv_audit_log where action = 'CHARGES_EXPORTED')::int, 5, 'audited (empty exports are not)');
end $$;

-- @test P6 export: prior-period credit flag and related period
do $$
declare
  gl date := tests.go_live();
  d jsonb;
  v_charge bigint;
  e jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'P6-9', '[{"sku":"GLOVES","qty":20,"unit_cost":0.2}]',
    jsonb_build_object('received_date', gl, 'invoice_date', gl)), 'stock last month');
  d := tests.ok(tests.issue('amn', jsonb_build_object('txn_date', gl, 'performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"GLOVES","qty":4,"loc":"AMN/STORE"}]'::jsonb)), 'issue last month');
  v_charge := (select c.id from public.tbl_inv_charges c where c.txn_id = (d->>'txn_id')::bigint);
  perform tests.ok(tests.call('hqmod', 'inv_set_resident_billing_code', jsonb_build_object('resident_id', tests.res('R1'), 'billing_code', 'C-R1')), 'code');
  perform tests.ok(tests.call('hqmod', 'inv_manual_charge_adjustment', jsonb_build_object('related_charge_id', v_charge, 'amount', -1,
    'reason', 'Credit for last month', 'performed_by_staff', 'HQ-ND')), 'adjustment today, related to last month');
  e := tests.ok(tests.call('hqmod', 'inv_export_charges', jsonb_build_object('branch_id', 1,
    'period', to_char(tests.today(), 'YYYY-MM'), 'layout', 'ITEMISED')), 'export this month');
  perform tests.eq((e->>'row_count')::int, 1, 'only this month');
  perform tests.eq(e->'rows'->0->>'related_charge_period', to_char(gl, 'YYYY-MM'), 'related period');
  perform tests.eq((e->'rows'->0->>'is_prior_period_credit')::boolean, true, 'prior period flag');
end $$;
