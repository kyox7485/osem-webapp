-- Correct the timezone displacement on rows written by the AMN clinical
-- migration (2026-09-26).
--
-- Cause: the migration session ran at TimeZone=UTC (the Supabase default).
-- Access returns naive datetimes with no zone, so Postgres read every
-- Malaysian wall-clock timestamp as if it were UTC. A note recorded at
-- 17:31 local was stored as the instant 17:31 UTC, which is LATER than
-- intended, not earlier -- it renders in Asia/Kuala_Lumpur as 01:31 the
-- following day. Verified against source: Access RID 10402 =
-- 2026-03-18 17:31:31, was stored as 2026-03-18 17:31:31+00, displaying as
-- 2026-03-19 01:31:31.
--
-- Fix: subtract 8 hours from the stored instant. Malaysia has been UTC+8
-- since 1981 with no DST, well before any record in these tables, so a fixed
-- interval is exact. run_migration.py now issues
-- `set time zone 'Asia/Kuala_Lumpur'` at connect, so future runs are correct
-- and must NOT be included here.
--
-- STATUS: applied and verified 2026-09-26. All 15,653 migrated rows across the
-- three tables were compared field-by-field against their Access source value
-- after the update: 15,653 exact matches, 0 mismatches. Kept for the record
-- and as a re-runnable check; it is NOT idempotent in the sense that running it
-- twice would shift everything by a further 8 hours. Do not re-apply.
--
-- Sign note, because this was got wrong once during this incident: the
-- displacement is LATE, not early. Storing a naive Malaysian time as UTC adds
-- 8 hours to the instant, so the correction subtracts. A '+8 hours' fix looks
-- plausible and silently pushes every timestamp a further day forward.
--
-- Scope is deliberately restricted to rows this migration wrote, matched
-- through etl.id_map on (source_table, source_id, branch_code='AMN'). Rows
-- the app or staff created by hand are NOT touched -- only the three clinical
-- source tables that were migrated, and only the source-side timestamp
-- column in each. created_at/updated_at are left alone: they record when the
-- row was written, which really was today.
--
-- Run this only to reproduce/audit the 2026-09-26 fix. Applying it to already-
-- corrected data would shift every timestamp 8 hours earlier again.

begin;

-- tbl_PhyIPProgressNote -> physio_assessments.entry_timestamp (10,630 rows)
update physio_assessments t
   set entry_timestamp = t.entry_timestamp - interval '8 hours'
  from etl.id_map m
 where m.target_id = t.id
   and m.source_table = 'tbl_PhyIPProgressNote'
   and m.branch_code = 'AMN'
   and t.entry_timestamp is not null;

-- tbl_ProgressNote -> tbl_progress_notes.entry_timestamp (4,970 rows)
update tbl_progress_notes t
   set entry_timestamp = t.entry_timestamp - interval '8 hours'
  from etl.id_map m
 where m.target_id = t.id
   and m.source_table = 'tbl_ProgressNote'
   and m.branch_code = 'AMN'
   and t.entry_timestamp is not null;

-- tbl_HospReferral -> tbl_hospital_referrals.referral_datetime (53 rows)
update tbl_hospital_referrals t
   set referral_datetime = t.referral_datetime - interval '8 hours'
  from etl.id_map m
 where m.target_id = t.id
   and m.source_table = 'tbl_HospReferral'
   and m.branch_code = 'AMN'
   and t.referral_datetime is not null;

commit;
