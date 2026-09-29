-- ============================================================================
-- TEST HARNESS ONLY — never apply to a real database.
-- Minimal stand-in for what Supabase provides and the live OSEM tables that
-- the inventory migrations depend on (column shapes copied from the live
-- project, read-only check 2026-09-29). Used by webapp/scripts/test-inventory.mjs
-- on PGlite (Postgres in WASM).
-- ============================================================================

-- Supabase roles and auth.uid() (same definition as live)
do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Live default ACL (verified): new public tables, views, sequences grant ALL
-- to anon/authenticated and new functions grant EXECUTE — so the migrations'
-- explicit revokes are really exercised here.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create extension if not exists pg_trgm;   -- live: schema public

-- Enums (live)
create type staff_role as enum ('ADMIN', 'MODERATOR', 'STAFF');
create type staff_dept as enum ('Nursing', 'Medical', 'Physiotherapy');
create type id_rights as enum ('ADMIN', 'MODERATOR', 'STAFF');

-- Core tables the inventory module references (live column shapes)
create table public.tbl_branches (
  "BranchID"      bigint generated always as identity primary key,
  "BranchName"    text not null,
  "BranchCode"    text not null unique,
  "BranchContact" text,
  "BranchAddress" text,
  "BranchLocale"  text,
  "Active"        text,
  "Function"      text,
  staff_seq       bigint not null default 0,
  resident_seq    bigint not null default 0,
  is_demo         boolean not null default false,
  telegram_chat_id text,
  bed_capacity    integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.tbl_positions (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

create table public.tbl_staff (
  "StaffID"   text primary key,
  branch_id   bigint not null references public.tbl_branches ("BranchID"),
  staff_name  text not null,
  position_id bigint not null references public.tbl_positions (id),
  role        staff_role not null,
  department  staff_dept not null,
  status      text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.tbl_user_accounts (
  id           bigint generated always as identity primary key,
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  email        text not null,
  username     text not null,
  branch_id    bigint not null references public.tbl_branches ("BranchID"),
  rights       id_rights not null,
  status       text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.tbl_residents (
  id            bigint generated always as identity primary key,
  branch_id     bigint not null references public.tbl_branches ("BranchID"),
  "ResidentID"  text not null,
  resident_name text not null,
  status        text not null default 'ACTIVE'
                  check (status in ('ACTIVE','DISCHARGED','DECEASED','TRANSFERRED OUT')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The live core tables have RLS on; mirror that so nothing leaks through them.
alter table public.tbl_branches enable row level security;
alter table public.tbl_positions enable row level security;
alter table public.tbl_staff enable row level security;
alter table public.tbl_user_accounts enable row level security;
alter table public.tbl_residents enable row level security;

-- Live ids (read-only check 2026-09-29)
insert into public.tbl_branches ("BranchID", "BranchName", "BranchCode", "Active", "Function", is_demo)
overriding system value values
  (1, 'Alma',        'AMN',  'YES', 'NUR', false),
  (2, 'Alma Physio', 'AMP',  'YES', 'PHY', false),
  (3, 'Kota Permai', 'BMN',  'YES', 'NUR', false),
  (4, 'Bagan',       'BGN',  'YES', 'NUR', false),
  (5, 'HQ',          'HQ',   'YES', 'HQ',  false),
  (6, 'Demo',        'DEMO', 'YES', 'NUR', true);

insert into public.tbl_positions (name) values
  ('Medical Officer'), ('Specialist'), ('Consultant'), ('Medical Assistant'), ('Pharmacist'),
  ('Physiotherapist'), ('Assist. Physiotherapist'), ('Rehab Assistance'), ('Occupational Therapist'),
  ('Speech Therapist'), ('Staff Nurse'), ('Assist. Nurse'), ('Caregiver'), ('Healthcare Worker'),
  ('Head Nurse'), ('Assist. Head Nurse'), ('Nursing Director');

-- ----------------------------------------------------------------------------
-- Objects schema/006_security_lockdown.sql alters (live shapes, 2026-09-29),
-- so the harness can apply 006 before the inventory migrations like live.
-- ----------------------------------------------------------------------------
create table public.tbl_audit_log (
  id          bigint generated always as identity primary key,   -- sequence tbl_audit_log_id_seq
  table_name  text,
  record_id   text,
  action      text,
  changed_by  uuid,
  changed_at  timestamptz default now(),
  old_data    jsonb,
  new_data    jsonb
);
create table public.tbl_nursing_chart_elimination_episodes (
  id        bigint generated always as identity primary key,
  branch_id bigint not null references public.tbl_branches ("BranchID")
);
create table public.tbl_resident_consumables (
  id        bigint generated always as identity primary key,
  branch_id bigint not null references public.tbl_branches ("BranchID")
);
alter table public.tbl_resident_consumables enable row level security;

-- Legacy helpers (live definitions; 006 pins their search_path)
create or replace function public.auth_account_id() returns bigint
language sql stable security definer as $$
  select id from tbl_user_accounts where auth_user_id = auth.uid();
$$;
create or replace function public.auth_branch_id() returns bigint
language sql stable security definer as $$
  select branch_id from tbl_user_accounts where auth_user_id = auth.uid();
$$;
create or replace function public.auth_role() returns id_rights
language sql stable security definer as $$
  select rights from tbl_user_accounts where auth_user_id = auth.uid();
$$;
create or replace function public.auth_is_demo_account() returns boolean
language sql stable security definer as $$
  select coalesce((select b.is_demo from tbl_user_accounts u join tbl_branches b on b."BranchID" = u.branch_id
                    where u.auth_user_id = auth.uid()), false);
$$;
create or replace function public.auth_is_all_branch_account() returns boolean
language sql stable security definer as $$
  select exists (select 1 from tbl_user_accounts u join tbl_branches b on b."BranchID" = u.branch_id
                  where u.auth_user_id = auth.uid() and (u.rights = 'ADMIN' or b."Function" in ('HQ','PHY')));
$$;

-- Generic audit trigger on the core tables inventory touches (006 replaces the body)
create or replace function public.fn_audit_trigger() returns trigger language plpgsql as $$
begin
  return coalesce(new, old);
end $$;
create trigger trg_audit_tbl_residents after insert or update or delete on public.tbl_residents
  for each row execute function public.fn_audit_trigger();
create trigger trg_audit_tbl_staff after insert or update or delete on public.tbl_staff
  for each row execute function public.fn_audit_trigger();
