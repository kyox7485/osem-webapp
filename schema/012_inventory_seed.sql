-- ============================================================================
-- 012 — General Inventory: seed data (idempotent)
-- ============================================================================
-- * base UOMs (JOB is the unit of Service products)
-- * the 5 categories agreed by the owner (Q-16, D-137)
-- * STORE / FLOOR / TRANSIT for the NUR branches AMN, BMN, BGN and DEMO
--   (Q-2, D-140: none for HQ or the physio hub)
-- * branch settings: real branches disabled until go-live; DEMO enabled
-- ============================================================================

begin;

insert into public.tbl_inv_uoms (code, name, name_ms, allow_fraction) values
  ('EA',     'Each',    'Unit',    false),
  ('PCS',    'Piece',   'Keping',  false),
  ('TAB',    'Tablet',  'Tablet',  false),
  ('CAP',    'Capsule', 'Kapsul',  false),
  ('STRIP',  'Strip',   'Jalur',   false),
  ('BOX',    'Box',     'Kotak',   false),
  ('PACK',   'Pack',    'Pek',     false),
  ('BOTTLE', 'Bottle',  'Botol',   false),
  ('TUBE',   'Tube',    'Tiub',    false),
  ('ROLL',   'Roll',    'Gulung',  false),
  ('SET',    'Set',     'Set',     false),
  ('PAIR',   'Pair',    'Pasang',  false),
  ('SACHET', 'Sachet',  'Paket',   false),
  ('ML',     'Millilitre', 'Mililiter', true),
  ('JOB',    'Job',     'Kerja',   false)
on conflict (code) do nothing;

insert into public.tbl_inv_categories (code, name, name_ms, is_service, sort_order) values
  ('CONSUMABLES', 'Consumables',    'Barang Pakai Buang', false, 10),
  ('DRESSING',    'Dressing Items', 'Barangan Balutan',   false, 20),
  ('MEDICINE',    'Medicine',       'Ubat',               false, 30),
  ('SERVICE',     'Service',        'Perkhidmatan',       true,  40),
  ('OTHERS',      'Others',         'Lain-lain',          false, 50)
on conflict (code) do nothing;

insert into public.tbl_inv_locations (branch_id, kind, name, count_frequency_days)
select b."BranchID", k.kind, k.name, k.freq
  from public.tbl_branches b
  cross join (values ('STORE', 'Store', 30), ('FLOOR', 'Floor Stock', 7), ('TRANSIT', 'Transit', null::int))
       as k(kind, name, freq)
 where b."BranchCode" in ('AMN', 'BMN', 'BGN', 'DEMO') and b."Function" = 'NUR'
on conflict (branch_id, kind) do nothing;

insert into public.tbl_inv_branch_settings (branch_id, is_enabled, go_live_date)
select b."BranchID", b.is_demo,
       case when b.is_demo then date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur'))::date end
  from public.tbl_branches b
 where b."BranchCode" in ('AMN', 'BMN', 'BGN', 'DEMO') and b."Function" = 'NUR'
on conflict (branch_id) do nothing;

-- Nothing this file created is reachable through the API until 013 (audit V-1).
select public.fn_inv_lockdown();

commit;
