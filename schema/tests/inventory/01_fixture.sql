-- ============================================================================
-- TEST HARNESS ONLY. Fixture data + assertion helpers, applied after the
-- inventory migrations (007–012). Every test in inventory_v1_tests.sql runs
-- in its own BEGIN … ROLLBACK on top of this.
-- ============================================================================

-- ---------------------------------------------------------------- accounts
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005'), ('00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000007'), ('00000000-0000-0000-0000-000000000008'),
  ('00000000-0000-0000-0000-000000000009'), ('00000000-0000-0000-0000-000000000010');

insert into public.tbl_user_accounts (auth_user_id, email, username, branch_id, rights, status) values
  ('00000000-0000-0000-0000-000000000001', 'amn@x',      'amn',      1, 'STAFF',     'ACTIVE'),
  ('00000000-0000-0000-0000-000000000002', 'bmn@x',      'bmn',      3, 'STAFF',     'ACTIVE'),
  ('00000000-0000-0000-0000-000000000003', 'bgn@x',      'bgn',      4, 'STAFF',     'ACTIVE'),
  ('00000000-0000-0000-0000-000000000004', 'amp@x',      'amp',      2, 'STAFF',     'ACTIVE'),
  ('00000000-0000-0000-0000-000000000005', 'hqadmin@x',  'hqadmin',  5, 'ADMIN',     'ACTIVE'),
  ('00000000-0000-0000-0000-000000000006', 'hqmod@x',    'hqmod',    5, 'MODERATOR', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000007', 'demo@x',     'demo',     6, 'ADMIN',     'ACTIVE'),
  ('00000000-0000-0000-0000-000000000008', 'inactive@x', 'inactive', 1, 'STAFF',     'INACTIVE'),
  ('00000000-0000-0000-0000-000000000009', 'hqmod2@x',   'hqmod2',   5, 'MODERATOR', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000010', 'hqstaff@x',  'hqstaff',  5, 'STAFF',     'ACTIVE');   -- no such login live; audit P1-4

-- ---------------------------------------------------------------- staff
insert into public.tbl_staff ("StaffID", branch_id, staff_name, position_id, role, department, status)
select s.id, s.branch, s.name, p.id, s.role::staff_role, 'Nursing', s.status
  from (values
    ('AMN-1',  1, 'Amy Nurse',        'Staff Nurse',       'STAFF',     'ACTIVE'),
    ('AMN-HN', 1, 'Alma Head Nurse',  'Head Nurse',        'MODERATOR', 'ACTIVE'),
    ('AMN-X',  1, 'Gone Nurse',       'Head Nurse',        'MODERATOR', 'INACTIVE'),
    ('BMN-1',  3, 'Bea Nurse',        'Staff Nurse',       'STAFF',     'ACTIVE'),
    ('BMN-HN', 3, 'Permai Head Nurse','Assist. Head Nurse','MODERATOR', 'ACTIVE'),
    ('BGN-HN', 4, 'Bagan Head Nurse', 'Head Nurse',        'MODERATOR', 'ACTIVE'),
    ('HQ-ND',  5, 'Nursing Director', 'Nursing Director',  'MODERATOR', 'ACTIVE'),
    ('HQ-1',   5, 'HQ Clerk',         'Healthcare Worker', 'STAFF',     'ACTIVE'),
    ('DEMO-1', 6, 'Demo Nurse',       'Staff Nurse',       'STAFF',     'ACTIVE'),
    ('DEMO-HN',6, 'Demo Head Nurse',  'Head Nurse',        'MODERATOR', 'ACTIVE')
  ) as s(id, branch, name, pos, role, status)
  join public.tbl_positions p on p.name = s.pos;

-- ---------------------------------------------------------------- residents
insert into public.tbl_residents (branch_id, "ResidentID", resident_name, status) values
  (1, 'AMN-0001', 'R1 Alma',       'ACTIVE'),
  (1, 'AMN-0002', 'R2 Alma',       'ACTIVE'),
  (1, 'AMN-0003', 'R3 Discharged', 'DISCHARGED'),
  (3, 'BMN-0001', 'R4 Permai',     'ACTIVE'),
  (6, 'DEMO-0001','R5 Demo',       'ACTIVE');

-- ---------------------------------------------------------------- clock
-- TEST ONLY: fn_inv_today() honours a transaction-local override so date-edge
-- tests do not depend on the real calendar (audit P1-9). Production keeps the
-- plain version from 009.
create or replace function public.fn_inv_today() returns date
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('inv.test_today', true), '')::date,
                  (now() at time zone 'Asia/Kuala_Lumpur')::date)
$$;



-- ---------------------------------------------------------------- settings
-- Real branches go live on the first day of the previous month, so the lock
-- tests have a finished month to close.
update public.tbl_inv_branch_settings
   set is_enabled = true,
       go_live_date = (date_trunc('month', public.fn_inv_today()) - interval '1 month')::date
 where branch_id in (1, 3, 4, 6);

-- ---------------------------------------------------------------- master data
insert into public.tbl_inv_suppliers (owner_branch_id, name, created_by_account)
values (null, 'Medi Supply Sdn Bhd', (select id from public.tbl_user_accounts where username = 'hqadmin')),
       (6,    'Demo Supplier',       (select id from public.tbl_user_accounts where username = 'demo'));

insert into public.tbl_inv_products (owner_branch_id, sku, name, category_id, is_stock_item, base_uom_id,
  purchase_uom_id, standard_unit_cost, is_chargeable, charge_price, default_max_store, default_max_floor, created_by_account)
select x.owner, x.sku, x.name, c.id, x.stock, bu.id, pu.id, x.std, x.chargeable, x.price, x.max_s, x.max_f,
       (select id from public.tbl_user_accounts where username = 'hqadmin')
  from (values
    (null::bigint, 'GLOVES',   'Gloves (M)',        'CONSUMABLES', true,  'EA',  'BOX',   null::numeric, true,  0.50::numeric, 500::numeric, 100::numeric),
    (null,         'GAUZE',    'Gauze 10x10',       'DRESSING',    true,  'EA',  'PACK',  null,          true,  1.00,          200,          50),
    (null,         'MILK',     'Special milk tin',  'OTHERS',      true,  'EA',  'EA',    null,          true,  30.00,         null,         null),
    (null,         'NOPRICE',  'Paracetamol 500mg', 'MEDICINE',    true,  'TAB', 'STRIP', null,          true,  null,          null,         null),
    (null,         'NOCHARGE', 'Hand rub',          'CONSUMABLES', true,  'EA',  'EA',    null,          false, null,          null,         null),
    (null,         'SVC',      'Wound dressing job','SERVICE',     false, 'JOB', 'JOB',   5.00,          true,  25.00,         null,         null),
    (null,         'STDCOST',  'Catheter',          'CONSUMABLES', true,  'EA',  'EA',    2.00,          true,  4.00,          null,         null),
    (null,         'NEWPROD',  'Never received',    'CONSUMABLES', true,  'EA',  'EA',    null,          true,  1.00,          null,         null),
    (6,            'DEMOPROD', 'Demo only product', 'OTHERS',      true,  'EA',  'EA',    null,          true,  2.00,          null,         null)
  ) as x(owner, sku, name, cat, stock, base, purch, std, chargeable, price, max_s, max_f)
  join public.tbl_inv_categories c on c.code = x.cat
  join public.tbl_inv_uoms bu on bu.code = x.base
  join public.tbl_inv_uoms pu on pu.code = x.purch;

insert into public.tbl_inv_product_uoms (product_id, uom_id, factor_to_base)
select p.id, u.id, f.factor
  from (values ('GLOVES','EA',1), ('GLOVES','BOX',100), ('GAUZE','EA',1), ('GAUZE','PACK',10),
               ('MILK','EA',1), ('NOPRICE','TAB',1), ('NOPRICE','STRIP',10), ('NOCHARGE','EA',1),
               ('SVC','JOB',1), ('STDCOST','EA',1), ('NEWPROD','EA',1), ('DEMOPROD','EA',1)) as f(sku, uom, factor)
  join public.tbl_inv_products p on p.sku = f.sku
  join public.tbl_inv_uoms u on u.code = f.uom;

-- ---------------------------------------------------------------- helpers
create schema tests;
grant usage on schema tests to public;

create function tests.login(p_username text) returns void language plpgsql as $$
declare
  v_uid uuid;
begin
  execute 'reset role';
  select auth_user_id into v_uid from public.tbl_user_accounts where username = p_username;
  if v_uid is null then
    raise exception 'test: no account %', p_username;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Claims only, role unchanged: lets the owner call internal fn_inv_* as that login.
create function tests.impersonate(p_username text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',
    (select auth_user_id from public.tbl_user_accounts where username = p_username), 'role', 'authenticated')::text, true);
end $$;

create function tests.freeze_today(p_day date) returns void language plpgsql as $$
begin
  perform set_config('inv.test_today', p_day::text, true);
end $$;

create function tests.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function tests.as_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

create function tests.eq(p_actual anycompatible, p_expected anycompatible, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERT % — expected %, got %', p_label, p_expected, p_actual;
  end if;
end $$;

create function tests.ok(p_result jsonb, p_label text) returns jsonb language plpgsql as $$
begin
  if coalesce((p_result->>'ok')::boolean, false) is not true then
    raise exception 'ASSERT % — expected ok, got %', p_label, p_result;
  end if;
  return p_result->'data';
end $$;

create function tests.code(p_result jsonb, p_code text, p_label text) returns void language plpgsql as $$
begin
  if p_result->>'code' is distinct from p_code then
    raise exception 'ASSERT % — expected code %, got %', p_label, p_code, p_result;
  end if;
end $$;

create function tests.raises(p_sql text, p_like text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_like then
      return;
    end if;
    raise exception 'ASSERT % — expected error like %, got: %', p_label, p_like, sqlerrm;
  end;
  raise exception 'ASSERT % — expected an error like %, but the statement succeeded', p_label, p_like;
end $$;

create function tests.loc(p_branch text, p_kind text) returns bigint language sql stable as $$
  select l.id from public.tbl_inv_locations l join public.tbl_branches b on b."BranchID" = l.branch_id
   where b."BranchCode" = p_branch and l.kind = p_kind
$$;
create function tests.prod(p_sku text) returns bigint language sql stable as $$
  select id from public.tbl_inv_products where sku = p_sku
$$;
create function tests.uom(p_code text) returns bigint language sql stable as $$
  select id from public.tbl_inv_uoms where code = p_code
$$;
create function tests.res(p_prefix text) returns bigint language sql stable as $$
  select id from public.tbl_residents where resident_name like p_prefix || ' %'
$$;
create function tests.branch(p_code text) returns bigint language sql stable as $$
  select "BranchID" from public.tbl_branches where "BranchCode" = p_code
$$;
create function tests.today() returns date language sql stable as $$ select public.fn_inv_today() $$;
create function tests.go_live() returns date language sql stable as $$
  select (date_trunc('month', public.fn_inv_today()) - interval '1 month')::date
$$;

-- Payload lines: [{"sku","uom","qty",…,"loc":"AMN/FLOOR"}] → ids
create function tests.lines(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(
    (x - 'sku' - 'uom' - 'loc' - 'res')
    || jsonb_build_object('product_id', tests.prod(x->>'sku'), 'uom_id', tests.uom(coalesce(x->>'uom', 'EA')))
    || case when x ? 'loc' then jsonb_build_object('location_id',
          tests.loc(split_part(x->>'loc', '/', 1), split_part(x->>'loc', '/', 2))) else '{}' end
    || case when x ? 'res' then jsonb_build_object('allocate_resident_id', tests.res(x->>'res')) else '{}' end
    order by ord), '[]')
  from jsonb_array_elements(p) with ordinality as t(x, ord)
$$;

-- Post a receipt as p_user into p_branch STORE (defaults: global supplier, today,
-- the branch's Head Nurse). p_extra overrides any payload field. Ids are
-- resolved as the owner BEFORE switching to the caller's role.
create function tests.receipt(p_user text, p_branch text, p_invoice text, p_lines jsonb,
                              p_extra jsonb default '{}', p_key uuid default gen_random_uuid())
returns jsonb language plpgsql as $$
declare
  v jsonb;
  v_payload jsonb;
begin
  perform tests.logout();
  v_payload := jsonb_build_object(
         'location_id', tests.loc(p_branch, 'STORE'),
         'supplier_id', (select id from public.tbl_inv_suppliers where owner_branch_id is null limit 1),
         'invoice_no', p_invoice, 'invoice_date', tests.today(),
         'received_date', tests.today(), 'received_by_staff', p_branch || '-HN',
         'lines', tests.lines(p_lines)) || p_extra;
  perform tests.login(p_user);
  v := public.inv_post_receipt(v_payload, p_key);
  perform tests.logout();
  return v;
end $$;

-- Call any inv_* RPC as p_user; "lines" are translated with tests.lines().
create function tests.call(p_user text, p_rpc text, p_payload jsonb, p_key uuid default gen_random_uuid())
returns jsonb language plpgsql as $$
declare
  v jsonb;
  v_payload jsonb;
begin
  perform tests.logout();
  v_payload := case when p_payload ? 'lines' then p_payload || jsonb_build_object('lines', tests.lines(p_payload->'lines'))
                    else p_payload end;
  perform tests.login(p_user);
  execute format('select public.%I($1, $2)', p_rpc) into v using v_payload, p_key;
  perform tests.logout();
  return v;
end $$;

create function tests.issue(p_user text, p_payload jsonb, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select tests.call(p_user, 'inv_post_issue', jsonb_build_object('txn_date', tests.today()) || p_payload, p_key)
$$;

create function tests.pool(p_branch text, p_sku text) returns public.tbl_inv_cost_pools language sql stable as $$
  select * from public.tbl_inv_cost_pools where branch_id = tests.branch(p_branch) and product_id = tests.prod(p_sku)
$$;
create function tests.bucket(p_branch text, p_kind text, p_sku text, p_res text default null) returns numeric
language sql stable as $$
  select coalesce((select qty from public.tbl_inv_balances where location_id = tests.loc(p_branch, p_kind)
                     and product_id = tests.prod(p_sku)
                     and resident_id is not distinct from (case when p_res is null then null else tests.res(p_res) end)), 0)
$$;

grant execute on all functions in schema tests to public;
