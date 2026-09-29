-- Migration: Index tbl_vital.entry_timestamp for all-residents / all-branches reads
-- Purpose: Stop the Vital Signs tab timing out when the resident filter is
--          "All Residents" and no date range is set.
--
-- The existing indexes are both leading-column on a column the query does
-- not constrain in that shape:
--
--   idx_vital_resident (resident_id, entry_timestamp desc)
--   idx_vital_branch   (branch_id,  entry_timestamp desc)
--
-- An HQ admin's vitals read degrades the branch filter to
-- "branch_id not in (<DEMO branches>)", which is not an equality, so
-- idx_vital_branch cannot drive an index scan either. With neither
-- applicable, Postgres seq-scans all ~37k rows (the AMN clinical migration
-- of 2026-09-26) and sorts them before the LIMIT 500 can return the first
-- row -- LIMIT does not help, the sort has to finish first. That crossed
-- the statement timeout as "canceling statement due to statement timeout".
--
-- This index matches the shape the report queries actually use: order by
-- entry_timestamp desc, limit N. It also serves the Nursing Chart tab,
-- which has the same all-branches shape.

create index if not exists idx_vital_timestamp
  on tbl_vital (entry_timestamp desc);

-- The nursing chart tab has the identical shape and the identical two
-- leading-column indexes (idx_nce_resident / idx_nce_branch), so it times
-- out for the same reason. Fixed in the same migration.
create index if not exists idx_nce_timestamp
  on tbl_nursing_chart_entries (entry_timestamp desc);
