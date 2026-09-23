-- Fix: sync resident_seq in tbl_branches to match the highest ResidentID
-- sequence number currently in use per branch.
--
-- Root cause: ResidentIDs were imported from Access with explicit values.
-- The fn_generate_resident_id trigger exits early when ResidentID is already
-- set, so resident_seq was never incremented for those imported rows.
-- When a new resident is created via the web app, the trigger increments
-- resident_seq from its stale value and generates an ID that already exists,
-- causing a unique-constraint violation on tbl_residents_residentid_unique.
--
-- This migration advances resident_seq to MAX(sequence number) in use so the
-- next new resident gets the first unused number. Branches whose resident_seq
-- is already >= the max in use are left untouched.
--
-- Applied via Supabase MCP on 2026-09-23.

UPDATE tbl_branches b
SET resident_seq = sub.max_seq
FROM (
  SELECT
    branch_id,
    MAX(CAST(SPLIT_PART("ResidentID", '-', 2) AS INTEGER)) AS max_seq
  FROM tbl_residents
  WHERE "ResidentID" ~ '^[A-Z]+-[0-9]+$'
  GROUP BY branch_id
) sub
WHERE b."BranchID" = sub.branch_id
  AND b.resident_seq < sub.max_seq;
