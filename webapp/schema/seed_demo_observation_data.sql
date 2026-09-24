-- Seed dummy Observation Chart data for DEMO branch
-- DEMO BranchID = 6
-- Run in Supabase SQL editor.

BEGIN;

-- 1. Create Active Episodes for 4 patients (365–368)
INSERT INTO tbl_observation_status (resident_id, branch_id, started_at, started_by_other)
VALUES
  (365, 6, NOW() - INTERVAL '7 days', 'Demo Staff'),
  (366, 6, NOW() - INTERVAL '7 days', 'Demo Staff'),
  (367, 6, NOW() - INTERVAL '7 days', 'Demo Staff'),
  (368, 6, NOW() - INTERVAL '7 days', 'Demo Staff')
ON CONFLICT (resident_id) WHERE ended_at IS NULL DO NOTHING;

-- 2. Create Completed Episodes for 2 patients (369–370)
INSERT INTO tbl_observation_status (resident_id, branch_id, started_at, ended_at, end_reason, started_by_other, ended_by_other)
VALUES
  (369, 6, NOW() - INTERVAL '14 days', NOW() - INTERVAL '10 days', 'Stable', 'Demo Staff', 'Demo Staff'),
  (370, 6, NOW() - INTERVAL '14 days', NOW() - INTERVAL '8 days', 'Discharged', 'Demo Staff', 'Demo Staff')
ON CONFLICT DO NOTHING;

-- 3. Create observation entries (tbl_observation_charts)
-- Timestamps: Now = 24 Sep
-- Patients:
-- A (365): Active, frequent
-- B (366): Active, variable vitals
-- C (367): Active, sparse
-- D (368): Active, populate in late entries
INSERT INTO tbl_observation_charts (
  branch_id, resident_id, entry_timestamp, active_issue,
  systolic_bp, diastolic_bp, heart_rate, temperature, spo2, created_by_other
) VALUES
  -- Comparison Test Case (Patient A/365):
  (6, 365, '2026-09-23 09:00:00+08', 'Issue A', 120, 80, 70, 36.5, 98, 'Demo Staff'),
  (6, 365, '2026-09-24 08:00:00+08', 'Issue A', 122, 82, 72, 36.6, 99, 'Demo Staff'),
  (6, 365, '2026-09-24 14:20:00+08', 'Issue A', 125, 85, 75, 36.7, 98, 'Demo Staff'),
  (6, 365, '2026-09-24 21:10:00+08', 'Issue A', 130, 90, 80, 37.0, 95, 'Demo Staff'),

  -- Patient B (366) - Fluctuating
  (6, 366, '2026-09-20 08:00:00+08', 'Issue B', 110, 70, 65, 36.0, 96, 'Demo Staff'),
  (6, 366, '2026-09-22 08:00:00+08', 'Issue B', 115, 75, 70, 36.2, 97, 'Demo Staff'),
  (6, 366, '2026-09-24 08:00:00+08', 'Issue B', 140, 95, 90, 38.0, 92, 'Demo Staff'),

  -- Patient C (367) - Sparse
  (6, 367, '2026-09-23 08:00:00+08', 'Issue C', 120, 80, 70, 36.5, 98, 'Demo Staff'),
  (6, 367, '2026-09-24 08:00:00+08', 'Issue C', 121, 81, 71, 36.6, 99, 'Demo Staff'),

  -- Patient D (368) - Missing data populated later
  (6, 368, '2026-09-23 08:00:00+08', 'Issue D', 120, 80, NULL, NULL, NULL, 'Demo Staff'),
  (6, 368, '2026-09-24 08:00:00+08', 'Issue D', 120, 80, 70, 36.5, 98, 'Demo Staff');

COMMIT;
