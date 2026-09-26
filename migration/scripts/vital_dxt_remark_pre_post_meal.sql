-- Admit 'Pre-Meal' and 'Post-Meal' as blood-glucose (DXT) remarks on tbl_vital.
--
-- Owner decision 2026-09-26: Access NursingChart records these two categories
-- on 2,639 readings (Pre-Meal 2,467, Post-Meal 172), but tbl_vital's CHECK only
-- admitted 'Fasting' / 'Post-Meal 1hr' / 'Post-Meal 2hr' / 'Post-Meal >4hr', so
-- the migration would have dropped them. No column is added; only the allowed
-- list is widened. The ~244 remaining one-off free-text remarks ('5am',
-- 'balik dialisis') are not categories and are not added.
--
-- The app's own vital form still offers only the original four; these two
-- values arrive only through the migration and display as stored.
--
-- Safe to re-run: drops and re-creates the same constraint.

begin;

alter table public.tbl_vital
  drop constraint tbl_vital_dxt_remark_check;

alter table public.tbl_vital
  add constraint tbl_vital_dxt_remark_check
  check (dxt_remark = any (array['Fasting'::text, 'Pre-Meal'::text, 'Post-Meal'::text,
                                 'Post-Meal 1hr'::text, 'Post-Meal 2hr'::text,
                                 'Post-Meal >4hr'::text]));

commit;
