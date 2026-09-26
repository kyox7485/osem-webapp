-- Admit 'Unspecified' as a hygiene assistance level.
--
-- Owner decision 2026-09-26: 4,496 Access NursingChart hygiene entries record
-- the activities but never say whether they were done by self or with
-- assistance. Rather than drop them, or guess a level (which would misstate the
-- care given), they are imported as 'Unspecified'. No column is added; only the
-- CHECK constraint's allowed list is widened.
--
-- Required once, before the first `run_migration.py --commit --tables
-- nursing_chart`. The nursing_chart dry run reports a BLOCKER until it is
-- applied, and the commit run refuses to start.
--
-- The app only ever writes 'By Self' / 'With Assistance' (its form has no
-- third option), and it renders assistance_level as stored, so these rows
-- display as 'Unspecified: <activities>'. Nothing else reads the value.
--
-- Safe to re-run: drops and re-creates the same constraint. Verified before
-- writing that no existing row holds any other value (the constraint was
-- enforcing the two-value list already).

begin;

alter table public.tbl_nursing_chart_hygiene_episodes
  drop constraint tbl_nursing_chart_hygiene_episodes_assistance_level_check;

alter table public.tbl_nursing_chart_hygiene_episodes
  add constraint tbl_nursing_chart_hygiene_episodes_assistance_level_check
  check (assistance_level = any (array['By Self'::text, 'With Assistance'::text, 'Unspecified'::text]));

commit;
