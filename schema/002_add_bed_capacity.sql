-- Migration: Add bed_capacity column to tbl_branches
-- Purpose: Store official bed capacity for each branch, replacing hard-coded occupancy calculations

ALTER TABLE tbl_branches ADD COLUMN bed_capacity integer DEFAULT NULL;

-- Comment documenting the column purpose
COMMENT ON COLUMN tbl_branches.bed_capacity IS 'Official bed capacity for this branch. Used by Admission Analytics to calculate occupancy %. NULL means capacity not yet configured.';
