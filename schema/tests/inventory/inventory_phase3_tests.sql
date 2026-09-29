-- ============================================================================
-- General Inventory — Phase 3 SQL tests (schema/014 master data, 015 stock RPCs)
-- ============================================================================
-- Same harness and rules as inventory_v1_tests.sql: every "-- @test" block
-- runs in its own fresh session inside BEGIN … ROLLBACK on top of the fixture.
-- ============================================================================

-- @test P3 product: HQ admin creates a global product + conversion; replay; SKU unique; factor rules; audited
do $$
declare
  k uuid := gen_random_uuid();
  pay jsonb;
  d jsonb;
  r jsonb;
begin
  pay := jsonb_build_object('sku', 'SYRINGE', 'name', 'Syringe 5ml',
    'category_id', (select id from public.tbl_inv_categories where code = 'CONSUMABLES'),
    'base_uom_id', tests.uom('EA'), 'purchase_uom_id', tests.uom('BOX'), 'charge_price', 0.80,
    'is_chargeable', true, 'is_active', true,
    'uoms', jsonb_build_array(jsonb_build_object('uom_id', tests.uom('BOX'), 'factor_to_base', 50)));
  d := tests.ok(tests.call('hqadmin', 'inv_save_product', pay, k), 'create');
  perform tests.eq((select owner_branch_id from public.tbl_inv_products where id = (d->>'product_id')::bigint), null::bigint, 'global row');
  perform tests.eq((select factor_to_base from public.tbl_inv_product_uoms
                     where product_id = (d->>'product_id')::bigint and uom_id = tests.uom('BOX')), 50::numeric, 'box factor');
  perform tests.eq((select factor_to_base from public.tbl_inv_product_uoms
                     where product_id = (d->>'product_id')::bigint and uom_id = tests.uom('EA')), 1::numeric, 'implied base row');
  r := tests.call('hqadmin', 'inv_save_product', pay, k);
  perform tests.eq((r->>'replayed')::boolean, true, 'same key replays');
  perform tests.eq((select count(*) from public.tbl_inv_products where sku = 'SYRINGE')::int, 1, 'one row only');
  perform tests.code(tests.call('hqadmin', 'inv_save_product', pay), 'SKU_EXISTS', 'duplicate sku');
  perform tests.code(tests.call('hqadmin', 'inv_save_product', pay || '{"sku":"X2","uoms":[]}'), 'PURCHASE_UOM_MISSING', 'purchase conversion required');
  perform tests.code(tests.call('hqadmin', 'inv_save_product', pay || jsonb_build_object('sku', 'X3', 'uoms',
    jsonb_build_array(jsonb_build_object('uom_id', tests.uom('BOX'), 'factor_to_base', 1)))), 'UOM_FACTOR_INVALID', 'only the base has factor 1');
  perform tests.code(tests.call('hqadmin', 'inv_save_product', pay || jsonb_build_object('sku', 'X4',
    'category_id', (select id from public.tbl_inv_categories where code = 'SERVICE'), 'default_max_store', 10)),
    'SERVICE_HAS_NO_MAX', 'service products have no max level');
  perform tests.eq((select count(*) from public.tbl_inv_audit_log where entity = 'product' and entity_id = d->>'product_id')::int, 1, 'audited once');
end $$;

-- @test P3 product: only HQ admin edits global rows; the demo login owns what it creates; cross-scope denied
do $$
declare
  pay jsonb;
  d jsonb;
  n int;
begin
  pay := jsonb_build_object('sku', 'NEWONE', 'name', 'New one',
    'category_id', (select id from public.tbl_inv_categories where code = 'OTHERS'),
    'base_uom_id', tests.uom('EA'), 'purchase_uom_id', tests.uom('EA'));
  perform tests.code(tests.call('amn', 'inv_save_product', pay), 'FORBIDDEN', 'branch login');
  perform tests.code(tests.call('hqmod', 'inv_save_product', pay), 'FORBIDDEN', 'HQ moderator');
  perform tests.code(tests.call('amp', 'inv_save_product', pay), 'FORBIDDEN', 'physio login');
  d := tests.ok(tests.call('demo', 'inv_save_product', pay), 'demo creates');
  perform tests.eq((select owner_branch_id from public.tbl_inv_products where id = (d->>'product_id')::bigint), 6::bigint, 'demo-owned');
  perform tests.code(tests.call('demo', 'inv_save_product', pay || jsonb_build_object('id', tests.prod('GLOVES'),
    'sku', 'GLOVES')), 'FORBIDDEN', 'demo cannot edit a global product');
  perform tests.code(tests.call('hqadmin', 'inv_save_product', pay || jsonb_build_object('id', (d->>'product_id')::bigint)),
    'FORBIDDEN', 'HQ admin cannot edit a demo-owned product');
  perform tests.login('amn');
  select count(*) into n from public.tbl_inv_products where sku = 'NEWONE';
  perform tests.logout();
  perform tests.eq(n, 0, 'a demo-owned product is invisible to a real branch');
end $$;

-- @test P3 product: base UOM, stock flag and a used factor are frozen once used (D-106)
do $$
declare
  pay jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'U1', '[{"sku":"GLOVES","uom":"BOX","qty":1,"unit_cost":100}]'), 'box receipt');
  pay := jsonb_build_object('id', tests.prod('GLOVES'), 'sku', 'GLOVES', 'name', 'Gloves (M) nitrile',
    'category_id', (select id from public.tbl_inv_categories where code = 'CONSUMABLES'),
    'base_uom_id', tests.uom('EA'), 'purchase_uom_id', tests.uom('BOX'), 'charge_price', 0.5,
    'default_max_store', 500, 'default_max_floor', 100,
    'uoms', jsonb_build_array(jsonb_build_object('uom_id', tests.uom('BOX'), 'factor_to_base', 100)));
  perform tests.ok(tests.call('hqadmin', 'inv_save_product', pay), 'rename is fine');
  perform tests.eq((select name from public.tbl_inv_products where id = tests.prod('GLOVES')), 'Gloves (M) nitrile', 'renamed');
  perform tests.code(tests.call('hqadmin', 'inv_save_product', pay || jsonb_build_object('uoms',
    jsonb_build_array(jsonb_build_object('uom_id', tests.uom('BOX'), 'factor_to_base', 120)))), 'UOM_FACTOR_LOCKED', 'used factor');
  perform tests.code(tests.call('hqadmin', 'inv_save_product', pay || jsonb_build_object('base_uom_id', tests.uom('PCS'),
    'uoms', jsonb_build_array(jsonb_build_object('uom_id', tests.uom('BOX'), 'factor_to_base', 100)))), 'BASE_UOM_LOCKED', 'used base');
  perform tests.code(tests.call('hqadmin', 'inv_save_product', pay || jsonb_build_object(
    'category_id', (select id from public.tbl_inv_categories where code = 'SERVICE'),
    'default_max_store', null, 'default_max_floor', null)), 'STOCK_FLAG_LOCKED', 'used stock flag');
  -- an unused product may still change its base UOM
  perform tests.ok(tests.call('hqadmin', 'inv_save_product', jsonb_build_object('id', tests.prod('NEWPROD'),
    'sku', 'NEWPROD', 'name', 'Never received', 'category_id', (select id from public.tbl_inv_categories where code = 'CONSUMABLES'),
    'base_uom_id', tests.uom('PCS'), 'purchase_uom_id', tests.uom('BOX'),
    'uoms', jsonb_build_array(jsonb_build_object('uom_id', tests.uom('BOX'), 'factor_to_base', 10)))), 'unused base change');
  perform tests.eq((select is_active from public.tbl_inv_product_uoms where product_id = tests.prod('NEWPROD') and uom_id = tests.uom('EA')),
    false, 'old base row deactivated');
end $$;

-- @test P3 barcode: branch Head-Nurse tier attaches to a global product; UPC/EAN clash; demo scope; deactivate
do $$
declare
  d jsonb;
begin
  perform tests.code(tests.call('amn', 'inv_add_barcode', jsonb_build_object('product_id', tests.prod('GLOVES'),
    'uom_id', tests.uom('EA'), 'barcode', '0123456789012', 'performed_by_staff', 'AMN-1')), 'STAFF_NOT_SENIOR', 'junior staff');
  d := tests.ok(tests.call('amn', 'inv_add_barcode', jsonb_build_object('product_id', tests.prod('GLOVES'),
    'uom_id', tests.uom('EA'), 'barcode', '0123456789012', 'performed_by_staff', 'AMN-HN')), 'attach');
  perform tests.eq((select owner_branch_id from public.tbl_inv_product_barcodes where id = (d->>'barcode_id')::bigint), null::bigint, 'global code');
  perform tests.code(tests.call('hqadmin', 'inv_add_barcode', jsonb_build_object('product_id', tests.prod('GAUZE'),
    'uom_id', tests.uom('EA'), 'barcode', '123456789012')), 'BARCODE_IN_USE', 'UPC-A = EAN-13 with a leading 0');
  perform tests.code(tests.call('demo', 'inv_add_barcode', jsonb_build_object('product_id', tests.prod('GLOVES'),
    'uom_id', tests.uom('EA'), 'barcode', 'DEMO-CODE-1', 'performed_by_staff', 'DEMO-HN')), 'FORBIDDEN', 'demo cannot touch a global product');
  perform tests.code(tests.call('demo', 'inv_add_barcode', jsonb_build_object('product_id', tests.prod('DEMOPROD'),
    'uom_id', tests.uom('EA'), 'barcode', '0123456789012')), 'BARCODE_IN_USE', 'a demo code cannot shadow a global one');
  perform tests.ok(tests.call('demo', 'inv_add_barcode', jsonb_build_object('product_id', tests.prod('DEMOPROD'),
    'uom_id', tests.uom('EA'), 'barcode', 'DEMO-CODE-1')), 'demo attaches to its own product');
  perform tests.code(tests.call('amn', 'inv_add_barcode', jsonb_build_object('product_id', tests.prod('GLOVES'),
    'uom_id', tests.uom('PACK'), 'barcode', 'X-1', 'performed_by_staff', 'AMN-HN')), 'UOM_NOT_CONVERTIBLE', 'uom must be a conversion');
  perform tests.code(tests.call('amn', 'inv_deactivate_barcode', jsonb_build_object('barcode_id', d->'barcode_id')), 'FORBIDDEN', 'branch cannot deactivate');
  perform tests.ok(tests.call('hqadmin', 'inv_deactivate_barcode', jsonb_build_object('barcode_id', d->'barcode_id')), 'HQ admin deactivates');
  perform tests.code(tests.call('hqadmin', 'inv_deactivate_barcode', jsonb_build_object('barcode_id', d->'barcode_id')), 'ALREADY_INACTIVE', 'twice');
  perform tests.ok(tests.call('hqadmin', 'inv_add_barcode', jsonb_build_object('product_id', tests.prod('GAUZE'),
    'uom_id', tests.uom('EA'), 'barcode', '0123456789012')), 'code reusable after deactivation');
end $$;

-- @test P3 supplier: branch Head-Nurse tier creates global; duplicates by normalised name; demo owns its own; HQ moderator denied; key reuse
do $$
declare
  d jsonb;
  k uuid := gen_random_uuid();
begin
  perform tests.code(tests.call('amn', 'inv_save_supplier', '{"name":"Pharma One","performed_by_staff":"AMN-1"}'), 'STAFF_NOT_SENIOR', 'junior');
  d := tests.ok(tests.call('amn', 'inv_save_supplier', '{"name":"Pharma One","phone":"03-1234","performed_by_staff":"AMN-HN"}', k), 'create');
  perform tests.eq((select owner_branch_id from public.tbl_inv_suppliers where id = (d->>'supplier_id')::bigint), null::bigint, 'global');
  perform tests.eq((select staff_id from public.tbl_inv_audit_log where entity = 'supplier' and entity_id = d->>'supplier_id'), 'AMN-HN', 'attributed');
  perform tests.code(tests.call('amn', 'inv_save_supplier', '{"name":"Pharma Two","performed_by_staff":"AMN-HN"}', k),
    'IDEMPOTENCY_KEY_REUSED', 'key reused with another payload');
  perform tests.code(tests.call('bmn', 'inv_save_supplier', '{"name":"  pharma   ONE ","performed_by_staff":"BMN-HN"}'), 'SUPPLIER_EXISTS', 'normalised duplicate');
  perform tests.code(tests.call('hqmod', 'inv_save_supplier', '{"name":"Mod Supplier","performed_by_staff":"HQ-ND"}'), 'FORBIDDEN', 'HQ moderator');
  perform tests.code(tests.call('amp', 'inv_save_supplier', '{"name":"Physio Supplier"}'), 'FORBIDDEN', 'physio');
  perform tests.eq((tests.ok(tests.call('demo', 'inv_save_supplier', '{"name":"Pharma One"}'), 'demo own')->>'owner_branch_id')::bigint, 6::bigint, 'demo-owned');
  perform tests.code(tests.call('demo', 'inv_save_supplier', jsonb_build_object('id', d->'supplier_id', 'name', 'Hijack')), 'FORBIDDEN', 'demo cannot edit global');
  perform tests.ok(tests.call('hqadmin', 'inv_save_supplier', jsonb_build_object('id', d->'supplier_id', 'name', 'Pharma One', 'is_active', false)), 'HQ admin deactivates');
  perform tests.eq((select is_active from public.tbl_inv_suppliers where id = (d->>'supplier_id')::bigint), false, 'inactive');
end $$;

-- @test P3 stock level: ADMIN of the branch only; STORE/FLOOR only; stock items only
do $$
begin
  perform tests.ok(tests.call('hqadmin', 'inv_set_stock_level', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'product_id', tests.prod('GLOVES'), 'max_qty', 800)), 'HQ admin sets');
  perform tests.ok(tests.call('hqadmin', 'inv_set_stock_level', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'product_id', tests.prod('GLOVES'), 'max_qty', 900)), 'HQ admin updates');
  perform tests.eq((select max_qty from public.tbl_inv_stock_levels where location_id = tests.loc('AMN','STORE')
                     and product_id = tests.prod('GLOVES')), 900::numeric, 'updated');
  perform tests.eq((select branch_id from public.tbl_inv_stock_levels where location_id = tests.loc('AMN','STORE')
                     and product_id = tests.prod('GLOVES')), 1::bigint, 'branch derived');
  perform tests.code(tests.call('amn', 'inv_set_stock_level', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'product_id', tests.prod('GLOVES'), 'max_qty', 1)), 'FORBIDDEN', 'branch login');
  perform tests.code(tests.call('demo', 'inv_set_stock_level', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'product_id', tests.prod('GLOVES'), 'max_qty', 1)), 'FORBIDDEN', 'demo on a real branch');
  perform tests.ok(tests.call('demo', 'inv_set_stock_level', jsonb_build_object('location_id', tests.loc('DEMO','FLOOR'),
    'product_id', tests.prod('DEMOPROD'), 'max_qty', 20)), 'demo on its own branch');
  perform tests.code(tests.call('hqadmin', 'inv_set_stock_level', jsonb_build_object('location_id', tests.loc('AMN','TRANSIT'),
    'product_id', tests.prod('GLOVES'), 'max_qty', 1)), 'INVALID_LOCATIONS', 'no transit max');
  perform tests.code(tests.call('hqadmin', 'inv_set_stock_level', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'product_id', tests.prod('SVC'), 'max_qty', 1)), 'NOT_STOCK_ITEM', 'service');
  perform tests.code(tests.call('hqadmin', 'inv_set_stock_level', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'product_id', tests.prod('DEMOPROD'), 'max_qty', 1)), 'PRODUCT_NOT_FOUND', 'demo product at a real branch');
end $$;

-- @test P3 opening balance: ADMIN in the window, dated go-live, INPUT cost, S/F/T; activity and window blocks; replay
do $$
declare
  gl date := (select go_live_date from public.tbl_inv_branch_settings where branch_id = 1);
  k uuid := gen_random_uuid();
  pay jsonb;
  d jsonb;
  p public.tbl_inv_cost_pools;
begin
  perform tests.freeze_today(gl + 2);
  pay := jsonb_build_object('performed_by_staff', 'HQ-ND', 'lines', jsonb_build_array(
    jsonb_build_object('sku', 'GLOVES', 'qty', 40, 'unit_cost', 0.85, 'loc', 'AMN/STORE'),
    jsonb_build_object('sku', 'GAUZE', 'uom', 'PACK', 'qty', 2, 'unit_cost', 10.00, 'loc', 'AMN/FLOOR'),
    jsonb_build_object('sku', 'MILK', 'qty', 3, 'unit_cost', 30, 'loc', 'AMN/TRANSIT', 'resident_id', tests.res('R1'))));
  perform tests.code(tests.call('amn', 'inv_post_opening_balance', pay), 'FORBIDDEN', 'branch login cannot');
  perform tests.code(tests.call('demo', 'inv_post_opening_balance', pay), 'FORBIDDEN', 'demo cannot touch AMN');
  perform tests.code(tests.call('bgn', 'inv_post_opening_balance', pay), 'FORBIDDEN', 'another branch cannot');
  d := tests.ok(tests.call('hqadmin', 'inv_post_opening_balance', pay, k), 'opening');
  perform tests.eq((select txn_date from public.tbl_inv_txns where id = (d->>'txn_id')::bigint), gl, 'dated go-live');
  perform tests.eq((select count(*) from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint and cost_source = 'INPUT')::int, 3, 'INPUT cost');
  p := tests.pool('AMN', 'GLOVES');
  perform tests.eq(p.qty, 40::numeric, 'Q'); perform tests.eq(p.value, 34::numeric, 'V'); perform tests.eq(p.wac, 0.85::numeric, 'W');
  perform tests.eq((tests.pool('AMN', 'GAUZE')).qty, 20::numeric, 'packs → base');
  perform tests.eq((tests.pool('AMN', 'GAUZE')).wac, 1::numeric, 'cost per entered UOM');
  perform tests.eq(tests.bucket('AMN', 'TRANSIT', 'MILK', 'R1'), 3::numeric, 'transit bucket');
  perform tests.eq((tests.call('hqadmin', 'inv_post_opening_balance', pay, k)->>'replayed')::boolean, true, 'replay');
  perform tests.eq((tests.pool('AMN', 'GLOVES')).qty, 40::numeric, 'replay posted nothing');
  -- more opening lines for a product that only has opening lines: fine
  perform tests.ok(tests.call('hqadmin', 'inv_post_opening_balance', jsonb_build_object('performed_by_staff', 'HQ-ND',
    'lines', '[{"sku":"GLOVES","qty":10,"unit_cost":0.85,"loc":"AMN/FLOOR"}]'::jsonb)), 'second opening');
  -- after any other movement the pool is closed to opening lines
  perform tests.ok(tests.receipt('amn', 'AMN', 'OB-1', '[{"sku":"GLOVES","qty":10,"unit_cost":1.00}]'), 'receipt');
  perform tests.code(tests.call('hqadmin', 'inv_post_opening_balance', jsonb_build_object('performed_by_staff', 'HQ-ND',
    'lines', '[{"sku":"GLOVES","qty":1,"unit_cost":1,"loc":"AMN/STORE"}]'::jsonb)), 'OPENING_POOL_HAS_ACTIVITY', 'pool has activity');
  perform tests.code(tests.call('hqadmin', 'inv_post_opening_balance', jsonb_build_object('performed_by_staff', 'HQ-ND',
    'lines', '[{"sku":"MILK","qty":1,"unit_cost":1,"loc":"AMN/TRANSIT"}]'::jsonb)), 'RESIDENT_NOT_FOUND', 'transit needs a resident');
  perform tests.code(tests.call('hqadmin', 'inv_post_opening_balance', jsonb_build_object('performed_by_staff', 'HQ-ND',
    'lines', '[{"sku":"STDCOST","qty":1,"loc":"AMN/STORE"}]'::jsonb)), 'INVALID_COST', 'cost required');
  perform tests.freeze_today(gl + 8);
  perform tests.code(tests.call('hqadmin', 'inv_post_opening_balance', jsonb_build_object('performed_by_staff', 'HQ-ND',
    'lines', '[{"sku":"STDCOST","qty":1,"unit_cost":2,"loc":"AMN/STORE"}]'::jsonb)), 'OPENING_WINDOW_CLOSED', 'window closed');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'caches clean');
end $$;

-- @test P3 return from issue: original cost, RETURN_CREDIT, qty cap, Transit only for the issue's resident, issue-reversal guard
do $$
declare
  d jsonb;
  v_line bigint;
  v_charge bigint;
  r1 jsonb;
  r2 jsonb;
  v_osem jsonb;
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'RI-1', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]'), 'stock @1.00');
  d := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'RESIDENT',
         'resident_id', tests.res('R1'), 'lines', '[{"sku":"GLOVES","qty":10,"loc":"AMN/STORE"}]'::jsonb)), 'issue 10');
  v_line := (select id from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint);
  v_charge := (select id from public.tbl_inv_charges where txn_line_id = v_line);
  perform tests.ok(tests.receipt('amn', 'AMN', 'RI-2', '[{"sku":"GLOVES","qty":100,"unit_cost":1.40}]'), 'WAC moves');

  r1 := tests.ok(tests.call('amn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
          'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
          'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'EA', 'qty', 4)))), 'return 4');
  perform tests.eq((select value from public.tbl_inv_txn_lines where txn_id = (r1->>'txn_id')::bigint), 4::numeric, 'value at issue cost');
  perform tests.eq((select cost_source from public.tbl_inv_txn_lines where txn_id = (r1->>'txn_id')::bigint), 'ORIGINAL', 'cost source');
  perform tests.eq((select source_line_id from public.tbl_inv_txn_lines where txn_id = (r1->>'txn_id')::bigint), v_line, 'linked to the issue line');
  perform tests.eq(tests.bucket('AMN','FLOOR','GLOVES'), 4::numeric, 'back on the floor');
  perform tests.eq((select charge_amount from public.tbl_inv_charges where txn_id = (r1->>'txn_id')::bigint), -2.00::numeric, 'credit at 0.50');
  perform tests.eq((select related_charge_id from public.tbl_inv_charges where txn_id = (r1->>'txn_id')::bigint), v_charge, 'credit linked');
  perform tests.eq((r1->>'credit_amount')::numeric, -2.00::numeric, 'result credit');
  perform tests.code(tests.call('amn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
    'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'EA', 'qty', 7)))), 'RETURN_EXCEEDS_ISSUED', 'only 6 left');
  -- the rest into the resident's own Transit bucket, taking the exact remaining value
  r2 := tests.ok(tests.call('amn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','TRANSIT'),
          'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
          'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'EA', 'qty', 6)))), 'return 6 to transit');
  perform tests.eq(tests.bucket('AMN','TRANSIT','GLOVES','R1'), 6::numeric, 'resident transit bucket');
  perform tests.eq((select value from public.tbl_inv_txn_lines where txn_id = (r2->>'txn_id')::bigint), 6::numeric, 'remaining value');
  -- cross-branch
  perform tests.code(tests.call('bmn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'txn_date', tests.today(), 'performed_by_staff', 'BMN-1',
    'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'EA', 'qty', 1)))), 'FORBIDDEN', 'bmn at AMN');
  perform tests.code(tests.call('bmn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('BMN','FLOOR'),
    'txn_date', tests.today(), 'performed_by_staff', 'BMN-1',
    'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'EA', 'qty', 1)))), 'ISSUE_LINE_NOT_FOUND', 'AMN issue from BMN');
  -- the issue cannot be reversed while returns stand; reverse a return first
  perform tests.raises(format($q$select tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', %s,
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY'))$q$, d->>'txn_id'), '%INV_ISSUE_HAS_RETURNS%', 'issue reversal guarded');
  perform tests.ok(tests.call('hqmod', 'inv_reverse_txn', jsonb_build_object('txn_id', r1->'txn_id',
    'performed_by_staff', 'HQ-ND', 'reason_code', 'DATA_ENTRY')), 'reverse return 1');
  perform tests.eq((select coalesce(sum(charge_amount), 0) from public.tbl_inv_charges c
                     where c.related_charge_id = v_charge and c.txn_id = (r1->>'txn_id')::bigint)
                 + (select coalesce(sum(charge_amount), 0) from public.tbl_inv_charges c
                     where c.related_charge_id = (select id from public.tbl_inv_charges where txn_id = (r1->>'txn_id')::bigint)),
                   0::numeric, 'return credit reversed');
  perform tests.ok(tests.call('amn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
    'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'EA', 'qty', 4)))), 'reversed return frees the qty');
  -- OSEM expense: cost-only credit, never into Transit
  perform tests.ok(tests.receipt('amn', 'AMN', 'RI-3', '[{"sku":"GAUZE","qty":50,"unit_cost":1.00}]'), 'gauze');
  v_osem := tests.ok(tests.issue('amn', jsonb_build_object('performed_by_staff', 'AMN-1', 'target', 'OSEM_EXPENSE',
              'expense_note', 'Ward use', 'lines', '[{"sku":"GAUZE","qty":5,"loc":"AMN/STORE"}]'::jsonb)), 'osem issue');
  v_line := (select id from public.tbl_inv_txn_lines where txn_id = (v_osem->>'txn_id')::bigint);
  perform tests.code(tests.call('amn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','TRANSIT'),
    'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
    'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'EA', 'qty', 1)))), 'INVALID_LOCATIONS', 'no OSEM return into transit');
  r1 := tests.ok(tests.call('amn', 'inv_post_return_from_issue', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
          'txn_date', tests.today(), 'performed_by_staff', 'AMN-1',
          'lines', jsonb_build_array(jsonb_build_object('issue_line_id', v_line, 'uom', 'EA', 'qty', 2)))), 'osem return');
  perform tests.eq((select charge_amount from public.tbl_inv_charges where txn_id = (r1->>'txn_id')::bigint), 0::numeric, 'no money');
  perform tests.eq((select cost_amount from public.tbl_inv_charges where txn_id = (r1->>'txn_id')::bigint), -2::numeric, 'cost credit');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'caches clean');
end $$;

-- @test P3 return to supplier: Head-Nurse tier, STORE only, at WAC, receipt link checks, negative confirm with the same key
do $$
declare
  rc jsonb;
  d jsonb;
  k uuid := gen_random_uuid();
  pay jsonb;
  v_other bigint;
  v_sup bigint := (select id from public.tbl_inv_suppliers where owner_branch_id is null limit 1);
begin
  rc := tests.ok(tests.receipt('amn', 'AMN', 'RS-1', '[{"sku":"GAUZE","qty":100,"unit_cost":2.00}]'), 'receipt');
  pay := jsonb_build_object('location_id', tests.loc('AMN','STORE'), 'supplier_id', v_sup, 'receipt_id', rc->'receipt_id',
    'supplier_credit_value', 25.00, 'txn_date', tests.today(), 'performed_by_staff', 'AMN-HN',
    'lines', '[{"sku":"GAUZE","qty":10}]'::jsonb);
  perform tests.code(tests.call('amn', 'inv_post_return_to_supplier', pay || '{"performed_by_staff":"AMN-1"}'), 'STAFF_NOT_SENIOR', 'junior');
  perform tests.code(tests.call('amn', 'inv_post_return_to_supplier', pay || jsonb_build_object('location_id', tests.loc('AMN','FLOOR'))),
    'LOCATION_NOT_STORE', 'store only');
  perform tests.code(tests.call('bmn', 'inv_post_return_to_supplier', pay || '{"performed_by_staff":"BMN-HN"}'), 'FORBIDDEN', 'cross-branch');
  d := tests.ok(tests.call('amn', 'inv_post_return_to_supplier', pay), 'return 10');
  perform tests.eq((d->>'value')::numeric, 20::numeric, 'at WAC');
  perform tests.eq((tests.pool('AMN','GAUZE')).value, 180::numeric, 'pool value');
  perform tests.eq((select source_doc_id from public.tbl_inv_txns where id = (d->>'txn_id')::bigint), (rc->>'receipt_id')::bigint, 'receipt link');
  perform tests.eq((select (after_data->>'supplier_credit_value')::numeric from public.tbl_inv_audit_log
                     where txn_id = (d->>'txn_id')::bigint), 25::numeric, 'credit value kept as info');
  insert into public.tbl_inv_suppliers (name, created_by_account)
  values ('Other Supplier', (select id from public.tbl_user_accounts where username = 'hqadmin')) returning id into v_other;
  perform tests.code(tests.call('amn', 'inv_post_return_to_supplier', pay || jsonb_build_object('supplier_id', v_other)),
    'RECEIPT_NOT_FOUND', 'receipt of another supplier');
  perform tests.code(tests.call('amn', 'inv_post_return_to_supplier', pay || '{"lines":[{"sku":"MILK","qty":1}]}'),
    'PRODUCT_NOT_ON_RECEIPT', 'product not on the receipt');
  pay := pay - 'receipt_id' || '{"lines":[{"sku":"GAUZE","qty":200}]}';
  perform tests.code(tests.call('amn', 'inv_post_return_to_supplier', pay, k), 'NEGATIVE_STOCK_CONFIRM', 'confirm needed');
  perform tests.ok(tests.call('amn', 'inv_post_return_to_supplier', pay || '{"allow_negative":true}', k), 'confirmed with the same key');
  perform tests.eq(tests.bucket('AMN','STORE','GAUZE'), -110::numeric, 'negative after confirm');
end $$;

-- @test P3 adjustment: request posts nothing; approve by another login and staff at WAC/fallback/pending; negative confirm; reject; cancel
do $$
declare
  a jsonb;
  d jsonb;
  k uuid := gen_random_uuid();
begin
  perform tests.ok(tests.receipt('amn', 'AMN', 'AD-1', '[{"sku":"GLOVES","qty":100,"unit_cost":1.00}]'), 'stock');
  perform tests.code(tests.call('amn', 'inv_request_adjustment', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'LOST', 'justification', 'x', 'performed_by_staff', 'AMN-HN',
    'lines', '[{"sku":"GLOVES","qty_delta_base":-10}]'::jsonb)), 'JUSTIFICATION_REQUIRED', 'justification');
  perform tests.code(tests.call('bmn', 'inv_request_adjustment', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'LOST', 'justification', 'Missing box', 'performed_by_staff', 'BMN-HN',
    'lines', '[{"sku":"GLOVES","qty_delta_base":-10}]'::jsonb)), 'FORBIDDEN', 'cross-branch request');
  a := tests.ok(tests.call('amn', 'inv_request_adjustment', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'LOST', 'justification', 'Missing box', 'performed_by_staff', 'AMN-HN',
    'lines', '[{"sku":"GLOVES","qty_delta_base":-10}]'::jsonb)), 'request');
  perform tests.eq((select status from public.tbl_inv_adjustments where id = (a->>'adjustment_id')::bigint), 'PENDING', 'pending');
  perform tests.eq(a->>'adjustment_no' like 'AMN-ADJ-%', true, 'numbered');
  perform tests.eq(tests.bucket('AMN','STORE','GLOVES'), 100::numeric, 'nothing posted yet');
  perform tests.code(tests.call('amn', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'APPROVE', 'performed_by_staff', 'AMN-HN')), 'FORBIDDEN', 'branch login cannot approve');
  perform tests.code(tests.call('hqmod', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'APPROVE', 'performed_by_staff', 'AMN-HN')), 'SOD_SAME_STAFF', 'approver staff differs');
  d := tests.ok(tests.call('hqmod', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-1')), 'approve');
  perform tests.eq(tests.bucket('AMN','STORE','GLOVES'), 90::numeric, 'posted');
  perform tests.eq((select value from public.tbl_inv_txn_lines where txn_id = (d->>'txn_id')::bigint), -10::numeric, 'at WAC');
  perform tests.eq((select txn_date from public.tbl_inv_txns where id = (d->>'txn_id')::bigint), tests.today(), 'dated approval day');
  perform tests.eq((select txn_id from public.tbl_inv_adjustments where id = (a->>'adjustment_id')::bigint), (d->>'txn_id')::bigint, 'linked');
  perform tests.code(tests.call('hqmod2', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'REJECT', 'performed_by_staff', 'HQ-1')), 'ADJUSTMENT_NOT_PENDING', 'decided once');
  -- positive lines: pool WAC, else standard cost, else PENDING_COST
  a := tests.ok(tests.call('amn', 'inv_request_adjustment', jsonb_build_object('location_id', tests.loc('AMN','FLOOR'),
    'reason_code', 'FOUND', 'justification', 'Found in cupboard', 'performed_by_staff', 'AMN-HN',
    'lines', '[{"sku":"GLOVES","qty_delta_base":5},{"sku":"STDCOST","qty_delta_base":3},{"sku":"NEWPROD","qty_delta_base":2}]'::jsonb)), 'found');
  d := tests.ok(tests.call('hqmod', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-1')), 'approve found');
  perform tests.eq((select string_agg(cost_source || ':' || value::text, ',' order by line_no) from public.tbl_inv_txn_lines
                     where txn_id = (d->>'txn_id')::bigint), 'WAC:5.0000,MASTER_FALLBACK:6.0000,PENDING_COST:0.0000', 'cost sources');
  -- negative-stock confirm round trip reuses the key
  a := tests.ok(tests.call('amn', 'inv_request_adjustment', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'COUNT_VARIANCE', 'justification', 'Count found far less', 'performed_by_staff', 'AMN-HN',
    'lines', '[{"sku":"GLOVES","qty_delta_base":-500}]'::jsonb)), 'big loss');
  perform tests.code(tests.call('hqmod', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-1'), k), 'NEGATIVE_STOCK_CONFIRM', 'confirm needed');
  perform tests.eq((select status from public.tbl_inv_adjustments where id = (a->>'adjustment_id')::bigint), 'PENDING', 'still pending');
  perform tests.ok(tests.call('hqmod', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-1', 'allow_negative', true), k), 'confirmed');
  -- reject / cancel
  a := tests.ok(tests.call('amn', 'inv_request_adjustment', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'OTHER', 'justification', 'Not sure yet', 'performed_by_staff', 'AMN-HN',
    'lines', '[{"sku":"GAUZE","qty_delta_base":1}]'::jsonb)), 'req 3');
  perform tests.code(tests.call('hqmod', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'CANCEL', 'performed_by_staff', 'HQ-1')), 'FORBIDDEN', 'only the requester cancels');
  perform tests.ok(tests.call('amn', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'CANCEL', 'performed_by_staff', 'AMN-HN')), 'requester cancels');
  perform tests.eq((select status from public.tbl_inv_adjustments where id = (a->>'adjustment_id')::bigint), 'CANCELLED', 'cancelled');
  a := tests.ok(tests.call('amn', 'inv_request_adjustment', jsonb_build_object('location_id', tests.loc('AMN','STORE'),
    'reason_code', 'OTHER', 'justification', 'Try again later', 'performed_by_staff', 'AMN-HN',
    'lines', '[{"sku":"GAUZE","qty_delta_base":1}]'::jsonb)), 'req 4');
  perform tests.ok(tests.call('hqmod', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'REJECT', 'performed_by_staff', 'HQ-1', 'note', 'No evidence')), 'reject');
  perform tests.eq((select status from public.tbl_inv_adjustments where id = (a->>'adjustment_id')::bigint), 'REJECTED', 'rejected');
  perform tests.eq(jsonb_array_length(public.fn_inv_verify_balances(1)), 0, 'caches clean');
end $$;

-- @test P3 adjustment: the demo ADMIN cannot approve its own request (separation of duties)
do $$
declare
  a jsonb;
begin
  a := tests.ok(tests.call('demo', 'inv_request_adjustment', jsonb_build_object('location_id', tests.loc('DEMO','STORE'),
    'reason_code', 'FOUND', 'justification', 'Demo found', 'performed_by_staff', 'DEMO-HN',
    'lines', '[{"sku":"DEMOPROD","qty_delta_base":2}]'::jsonb)), 'demo request');
  perform tests.code(tests.call('demo', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'APPROVE', 'performed_by_staff', 'DEMO-1')), 'SOD_SAME_ACCOUNT', 'same login');
  perform tests.code(tests.call('hqmod', 'inv_decide_adjustment', jsonb_build_object('adjustment_id', a->'adjustment_id',
    'decision', 'APPROVE', 'performed_by_staff', 'HQ-1')), 'FORBIDDEN', 'HQ cannot reach demo');
end $$;
