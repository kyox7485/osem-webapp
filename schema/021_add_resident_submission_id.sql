-- Migration: Idempotency key for New Resident submissions
--
-- What this does: adds a nullable uuid column tbl_residents.submission_id and
-- a partial unique index on it. Existing rows stay NULL (and NULLs never
-- collide), so no backfill is needed. Idempotent (IF NOT EXISTS).
--
-- Why: on 2026-10-01 one New Resident form submit was retried until it
-- created BMN-0153..0156 for the same patient. The New Resident form now
-- generates one UUID per form instance and sends it with every submit;
-- createResident inserts it here, so a repeat of the same submission hits
-- this index (23505) and is redirected to the resident already created
-- instead of minting a new ResidentID. Edit/readmit flows don't set it.

alter table tbl_residents add column if not exists submission_id uuid;

create unique index if not exists tbl_residents_submission_id_key
  on tbl_residents (submission_id)
  where submission_id is not null;
