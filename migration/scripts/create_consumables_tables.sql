-- Consumables (Resident → Consumables).
--
-- Supabase mirror of two Google Sheet tabs in the consumables spreadsheet
-- (1_P_pl06r964aa8zHnDw5h8f6kg8JfQWviJ_41FctCHU), which is the source of
-- truth — same architecture as tbl_MedicationStock → tbl_medication_stock
-- (see docs/consumables.md). The webapp never writes these tables directly:
-- Next.js → Apps Script "Sync to Supabase" (consumableCountCreate) → Sheet →
-- these tables via google-apps-script/Sync to Supabase/Consumables.gs.
-- AppSheet also writes the Sheet; a 1-minute heartbeat mirrors that.
--
--   tbl_ConsumableMaster    → tbl_consumable_master     (item catalogue)
--   tbl_ResidentConsumable  → tbl_resident_consumables  (count log)
--
-- tbl_resident_consumables is an append-only log of COUNTS: every weekly
-- count adds a row. The current stock of an item for a resident is the row
-- with the latest last_count. There is no receiving / forecast.
--
-- Idempotent: safe to re-run.

create table if not exists tbl_consumable_master (
  id                bigint generated always as identity primary key,
  -- Sheet ConsumableID, e.g. C001
  consumable_id     text not null unique,
  consumable        text not null,
  unit              text not null,
  -- Target level for RestockRequired items; null when not applicable.
  max_stock         numeric check (max_stock is null or max_stock >= 0),
  restock_required  boolean not null default false,
  updated_at        timestamptz not null default now()
);

create table if not exists tbl_resident_consumables (
  id                bigint generated always as identity primary key,
  -- Sheet RecordID
  external_ref_id   text not null unique,
  -- Derived from the resident at sync time, for RLS branch scoping.
  branch_id         bigint not null references tbl_branches ("BranchID"),
  -- Sheet ResidentID, resolved via tbl_residents.ResidentID
  resident_id       bigint not null references tbl_residents (id),
  consumable_id     text not null references tbl_consumable_master (consumable_id),
  -- Only meaningful for the catalogue's "Other" item (free-text item + unit).
  other_consumable  text,
  other_unit        text,
  -- Who supplies it. Null only for legacy sheet rows left blank.
  supplier          text check (supplier is null or supplier in ('Family', 'OSEM')),
  -- Counted quantity; decimals allowed (e.g. 1.5 tins of milk powder).
  current_stock     numeric not null check (current_stock >= 0),
  -- Sheet LastCount — when the count was taken.
  last_count        timestamptz not null,
  -- Sheet CountedBy (tbl_staff.StaffID)
  counted_by        text references tbl_staff ("StaffID"),
  created_at        timestamptz not null default now()
);

create index if not exists idx_resident_consumables_resident
  on tbl_resident_consumables (resident_id, last_count desc);
create index if not exists idx_resident_consumables_branch
  on tbl_resident_consumables (branch_id);

-- Catalogue: readable by every signed-in account (no branch data in it).
-- Writes come only from Apps Script with the service key (bypasses RLS).
alter table tbl_consumable_master enable row level security;
drop policy if exists read_tbl_consumable_master on tbl_consumable_master;
create policy read_tbl_consumable_master on tbl_consumable_master
  for select
  to authenticated
  using (true);

-- Same branch-scope policy as tbl_medication_stock / tbl_residents
-- (DEMO rows invisible to non-DEMO admins).
alter table tbl_resident_consumables enable row level security;
drop policy if exists branch_scope_tbl_resident_consumables on tbl_resident_consumables;
create policy branch_scope_tbl_resident_consumables on tbl_resident_consumables
  for all
  using (
    (branch_id = auth_branch_id())
    or (
      (auth_role() = any (array['ADMIN'::id_rights, 'MODERATOR'::id_rights]))
      and (not auth_is_demo_account())
      and (not exists (select 1 from tbl_branches b where b."BranchID" = tbl_resident_consumables.branch_id and b.is_demo))
    )
  )
  with check (
    (branch_id = auth_branch_id())
    or (
      (auth_role() = any (array['ADMIN'::id_rights, 'MODERATOR'::id_rights]))
      and (not auth_is_demo_account())
      and (not exists (select 1 from tbl_branches b where b."BranchID" = tbl_resident_consumables.branch_id and b.is_demo))
    )
  );
