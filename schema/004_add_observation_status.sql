-- Observation status/episode tracking, added directly in Supabase (see
-- schema/001_init.sql's note on tbl_observation_charts for the same
-- pattern). Tracks who is currently under observation, separate from the
-- existing tbl_observation_charts report entries.

create table public.tbl_observation_status (
  id bigint generated always as identity primary key,
  resident_id integer not null references public.tbl_residents (id),
  branch_id integer not null references public.tbl_branches ("BranchID"),
  started_at timestamptz not null default now(),
  started_by text references public.tbl_staff ("StaffID"),
  started_by_other text,
  ended_at timestamptz,
  ended_by text references public.tbl_staff ("StaffID"),
  ended_by_other text,
  end_reason text,
  created_at timestamptz not null default now()
);

-- Only one active (ended_at is null) episode per resident at a time.
create unique index tbl_observation_status_active_resident_idx
  on public.tbl_observation_status (resident_id)
  where ended_at is null;

create index tbl_observation_status_branch_idx
  on public.tbl_observation_status (branch_id);

create index tbl_observation_status_resident_ended_idx
  on public.tbl_observation_status (resident_id, ended_at);

alter table public.tbl_observation_status enable row level security;

create policy obs_status_select on public.tbl_observation_status
  for select
  using (auth_role() = any (array['ADMIN'::id_rights, 'MODERATOR'::id_rights]) or branch_id = auth_branch_id());

create policy obs_status_insert on public.tbl_observation_status
  for insert
  with check (auth_role() = any (array['ADMIN'::id_rights, 'MODERATOR'::id_rights]) or branch_id = auth_branch_id());

create policy obs_status_update on public.tbl_observation_status
  for update
  using (auth_role() = any (array['ADMIN'::id_rights, 'MODERATOR'::id_rights]) or branch_id = auth_branch_id())
  with check (auth_role() = any (array['ADMIN'::id_rights, 'MODERATOR'::id_rights]) or branch_id = auth_branch_id());
