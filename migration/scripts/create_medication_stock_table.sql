-- Medication Stock (Resident → Medication → Stock).
--
-- Supabase mirror of the Google Sheet tab `tbl_MedicationStock`, which is the
-- source of truth (same architecture as tbl_MedicationOrder →
-- tbl_medication_orders — see docs/medication.md). The webapp never writes
-- this table directly: Next.js → Apps Script (stockCreate) → Sheet → this
-- table via google-apps-script/Sync to Supabase/MedicationStock.gs.
--
-- This is an audit trail of stock EVENTS only (Stock Count / Stock Received /
-- Order Changed). There is deliberately no daily row: the current forecast for
-- Count units is computed on read from the latest event + the order's dosing
-- schedule (webapp/src/lib/medication-stock.ts).
--
-- daily_usage / days_remaining are the snapshot values written to the Sheet
-- at event time (the Sheet/AppSheet convention stores 0 when not applicable,
-- e.g. Estimate units). The webapp never displays these as live values.

create table if not exists tbl_medication_stock (
  id                   bigint generated always as identity primary key,
  -- Sheet StockID
  external_ref_id      text not null unique,
  -- Derived from the resident at sync time, for RLS branch scoping.
  branch_id            bigint not null references tbl_branches ("BranchID"),
  -- Sheet ResidentID, resolved via tbl_residents.ResidentID
  resident_id          bigint not null references tbl_residents (id),
  -- Sheet RxOrderID, resolved via tbl_medication_orders.external_ref_id.
  -- Stock is tied to the EXACT order revision, never to the medication name.
  medication_order_id  bigint not null references tbl_medication_orders (id) on delete cascade,
  -- Resulting balance AFTER the event.
  balance              numeric not null check (balance >= 0),
  unit                 text not null check (unit in (
                         'Tablet', 'Capsule', 'Sachet', 'Ampoule', 'mL', 'Puff', 'Unit',
                         'Bottle', 'Tube', 'Jar', 'Cannister', 'Pump', 'Drop', 'Pen', 'Application'
                       )),
  daily_usage          numeric,
  days_remaining       numeric,
  stock_date           timestamptz not null,
  -- Sheet RegisteredBy (tbl_staff.StaffID)
  registered_by        text references tbl_staff ("StaffID"),
  entry_type           text not null check (entry_type in ('Stock Count', 'Stock Received', 'Order Changed')),
  created_at           timestamptz not null default now()
);

create index if not exists idx_medication_stock_order
  on tbl_medication_stock (medication_order_id, stock_date desc);
create index if not exists idx_medication_stock_resident
  on tbl_medication_stock (resident_id);

-- Same branch-scope policy as tbl_medication_orders / tbl_residents
-- (DEMO rows invisible to non-DEMO admins).
alter table tbl_medication_stock enable row level security;
drop policy if exists branch_scope_tbl_medication_stock on tbl_medication_stock;
create policy branch_scope_tbl_medication_stock on tbl_medication_stock
  for all
  using (
    (branch_id = auth_branch_id())
    or (
      (auth_role() = any (array['ADMIN'::id_rights, 'MODERATOR'::id_rights]))
      and (not auth_is_demo_account())
      and (not exists (select 1 from tbl_branches b where b."BranchID" = tbl_medication_stock.branch_id and b.is_demo))
    )
  )
  with check (
    (branch_id = auth_branch_id())
    or (
      (auth_role() = any (array['ADMIN'::id_rights, 'MODERATOR'::id_rights]))
      and (not auth_is_demo_account())
      and (not exists (select 1 from tbl_branches b where b."BranchID" = tbl_medication_stock.branch_id and b.is_demo))
    )
  );
