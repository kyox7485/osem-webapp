-- Seed realistic DEMO behaviour episodes for the Gantt timeline.
-- DEMO branch: BranchID = 6, BranchCode = 'DEMO'.
-- DEMO residents: IDs 365–384 (use 365 and 366 here).
--
-- Run ONLY when the behaviour episodes table exists and DEMO episodes
-- are absent. Check first:
--   SELECT count(*) FROM tbl_behaviour_episodes
--   WHERE branch_id = (SELECT "BranchID" FROM tbl_branches WHERE "BranchCode"='DEMO');
--
-- Episodes cover 2026-09-15 to 2026-09-21 (7 days).
-- All times are MYT (UTC+8), stored as timestamptz.

BEGIN;

-- ----------------------------------------------------------------
-- 1. Insert parent behaviour charts (one per resident per day)
-- ----------------------------------------------------------------

-- We insert charts and capture their IDs in a temp table.
CREATE TEMP TABLE tmp_demo_chart_ids (
  id        bigint,
  resident  bigint,
  obs_date  date
) ON COMMIT DROP;

WITH inserted AS (
  INSERT INTO tbl_behaviour_charts (
    branch_id, resident_id, entry_timestamp,
    verbal_behavior, physical_behavior, restraint, emotion_mood,
    disturbance_level, created_by, created_by_other
  ) VALUES
    -- Resident 365, days 15-21 Sep 2026
    (6, 365, '2026-09-15 08:00:00+08', ARRAY['Shouting','Scolding Staff'], ARRAY['Restless','Walking Around'], ARRAY['On Mitten Gloves'], ARRAY['Agitated','Angry'], 3, NULL, 'Demo Staff'),
    (6, 365, '2026-09-16 08:00:00+08', ARRAY['Shouting'], ARRAY['Restless'], ARRAY['On Mitten Gloves'], ARRAY['Agitated'], 2, NULL, 'Demo Staff'),
    (6, 365, '2026-09-17 08:00:00+08', ARRAY['Quiet','Incoherent Speech'], ARRAY['Calm','Walking Around'], ARRAY['Not on any restrain'], ARRAY['Sleepy','Relaxed'], 1, NULL, 'Demo Staff'),
    (6, 365, '2026-09-18 08:00:00+08', ARRAY['Shouting','Scolding Staff'], ARRAY['Hitting Staff','Restless'], ARRAY['On Restrainer Vest'], ARRAY['Angry','Agitated'], 4, NULL, 'Demo Staff'),
    (6, 365, '2026-09-19 08:00:00+08', ARRAY['Shouting'], ARRAY['Restless'], ARRAY['On Mitten Gloves'], ARRAY['Agitated','Anxious'], 3, NULL, 'Demo Staff'),
    (6, 365, '2026-09-20 08:00:00+08', ARRAY['Quiet'], ARRAY['Calm'], ARRAY['Not on any restrain'], ARRAY['Relaxed','Sleepy'], 0, NULL, 'Demo Staff'),
    (6, 365, '2026-09-21 08:00:00+08', ARRAY['Quiet'], ARRAY['Calm'], ARRAY['Not on any restrain'], ARRAY['Relaxed'], 1, NULL, 'Demo Staff'),
    -- Resident 366, days 15-21 Sep 2026
    (6, 366, '2026-09-15 08:00:00+08', ARRAY['Incoherent Speech'], ARRAY['Walking Around'], ARRAY['Not on any restrain'], ARRAY['Sleepy','Anxious'], 1, NULL, 'Demo Staff'),
    (6, 366, '2026-09-16 08:00:00+08', ARRAY['Quiet'], ARRAY['Calm'], ARRAY['Not on any restrain'], ARRAY['Relaxed'], 0, NULL, 'Demo Staff'),
    (6, 366, '2026-09-17 08:00:00+08', ARRAY['Shouting','Incoherent Speech'], ARRAY['Restless','Walking Around'], ARRAY['On Mitten Gloves'], ARRAY['Anxious','Crying'], 2, NULL, 'Demo Staff'),
    (6, 366, '2026-09-18 08:00:00+08', ARRAY['Quiet'], ARRAY['Calm'], ARRAY['Not on any restrain'], ARRAY['Relaxed','Sleepy'], 0, NULL, 'Demo Staff'),
    (6, 366, '2026-09-19 08:00:00+08', ARRAY['Shouting'], ARRAY['Restless'], ARRAY['On Mitten Gloves'], ARRAY['Agitated'], 2, NULL, 'Demo Staff'),
    (6, 366, '2026-09-20 08:00:00+08', ARRAY['Scolding Staff','Shouting'], ARRAY['Hitting Staff'], ARRAY['On Restrainer Vest'], ARRAY['Angry','Agitated'], 4, NULL, 'Demo Staff'),
    (6, 366, '2026-09-21 08:00:00+08', ARRAY['Quiet'], ARRAY['Calm'], ARRAY['Not on any restrain'], ARRAY['Sleepy','Relaxed'], 1, NULL, 'Demo Staff')
  RETURNING id, resident_id, (entry_timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS obs_date
)
INSERT INTO tmp_demo_chart_ids (id, resident, obs_date)
SELECT id, resident_id, obs_date FROM inserted;

-- ----------------------------------------------------------------
-- 2. Insert timed episodes referencing those charts
-- ----------------------------------------------------------------
-- Helper: map resident + obs_date → chart_id

INSERT INTO tbl_behaviour_episodes
  (chart_id, branch_id, resident_id, category, behaviour, started_at, ended_at, note)
SELECT c.id, 6, c.resident, ep.category, ep.behaviour, ep.started_at, ep.ended_at, ep.note
FROM tmp_demo_chart_ids c
JOIN (VALUES
  -- ── Resident 365, 2026-09-15 ──────────────────────────────────
  (365::bigint, '2026-09-15'::date, 'Verbal',   'Shouting',         '2026-09-15 10:00:00+08'::timestamptz, '2026-09-15 12:30:00+08'::timestamptz, NULL),
  (365, '2026-09-15', 'Verbal',   'Scolding Staff',   '2026-09-15 11:00:00+08', '2026-09-15 11:45:00+08', 'Refused morning medications'),
  (365, '2026-09-15', 'Physical', 'Restless',         '2026-09-15 10:00:00+08', '2026-09-15 14:00:00+08', NULL),
  (365, '2026-09-15', 'Physical', 'Walking Around',   '2026-09-15 13:00:00+08', '2026-09-15 15:00:00+08', NULL),
  (365, '2026-09-15', 'Mood',     'Agitated',         '2026-09-15 10:00:00+08', '2026-09-15 13:30:00+08', NULL),
  (365, '2026-09-15', 'Mood',     'Relaxed',          '2026-09-15 19:00:00+08', '2026-09-15 21:30:00+08', 'After dinner'),
  (365, '2026-09-15', 'Restraint','On Mitten Gloves', '2026-09-15 09:00:00+08', '2026-09-15 12:00:00+08', NULL),
  -- ── Resident 365, 2026-09-16 ──────────────────────────────────
  (365, '2026-09-16', 'Verbal',   'Shouting',         '2026-09-16 09:30:00+08', '2026-09-16 11:00:00+08', NULL),
  (365, '2026-09-16', 'Physical', 'Restless',         '2026-09-16 09:00:00+08', '2026-09-16 12:00:00+08', NULL),
  (365, '2026-09-16', 'Mood',     'Agitated',         '2026-09-16 09:30:00+08', '2026-09-16 11:30:00+08', NULL),
  (365, '2026-09-16', 'Mood',     'Sleepy',           '2026-09-16 14:00:00+08', '2026-09-16 17:00:00+08', 'Post-lunch nap'),
  (365, '2026-09-16', 'Restraint','On Mitten Gloves', '2026-09-16 09:00:00+08', '2026-09-16 11:30:00+08', NULL),
  -- ── Resident 365, 2026-09-17 ──────────────────────────────────
  (365, '2026-09-17', 'Verbal',   'Quiet',            '2026-09-17 08:00:00+08', '2026-09-17 12:00:00+08', 'Good morning'),
  (365, '2026-09-17', 'Verbal',   'Incoherent Speech','2026-09-17 14:00:00+08', '2026-09-17 15:00:00+08', NULL),
  (365, '2026-09-17', 'Physical', 'Calm',             '2026-09-17 08:00:00+08', '2026-09-17 13:00:00+08', NULL),
  (365, '2026-09-17', 'Physical', 'Walking Around',   '2026-09-17 16:00:00+08', '2026-09-17 17:30:00+08', 'Afternoon exercise'),
  (365, '2026-09-17', 'Mood',     'Sleepy',           '2026-09-17 08:00:00+08', '2026-09-17 10:00:00+08', NULL),
  (365, '2026-09-17', 'Mood',     'Relaxed',          '2026-09-17 10:00:00+08', '2026-09-17 18:00:00+08', NULL),
  -- ── Resident 365, 2026-09-18 (worst day) ─────────────────────
  (365, '2026-09-18', 'Verbal',   'Shouting',         '2026-09-18 07:00:00+08', '2026-09-18 09:00:00+08', NULL),
  (365, '2026-09-18', 'Verbal',   'Scolding Staff',   '2026-09-18 08:30:00+08', '2026-09-18 09:30:00+08', 'Refused breakfast'),
  (365, '2026-09-18', 'Verbal',   'Shouting',         '2026-09-18 14:00:00+08', '2026-09-18 16:00:00+08', NULL),
  (365, '2026-09-18', 'Physical', 'Hitting Staff',    '2026-09-18 08:30:00+08', '2026-09-18 09:00:00+08', 'Struck nurse during personal care'),
  (365, '2026-09-18', 'Physical', 'Restless',         '2026-09-18 07:00:00+08', '2026-09-18 10:00:00+08', NULL),
  (365, '2026-09-18', 'Mood',     'Angry',            '2026-09-18 07:00:00+08', '2026-09-18 10:00:00+08', NULL),
  (365, '2026-09-18', 'Mood',     'Agitated',         '2026-09-18 13:00:00+08', '2026-09-18 17:00:00+08', NULL),
  (365, '2026-09-18', 'Restraint','On Restrainer Vest','2026-09-18 08:30:00+08','2026-09-18 12:00:00+08', 'Applied after hitting incident'),
  -- ── Resident 365, 2026-09-19 ──────────────────────────────────
  (365, '2026-09-19', 'Verbal',   'Shouting',         '2026-09-19 10:00:00+08', '2026-09-19 11:30:00+08', NULL),
  (365, '2026-09-19', 'Physical', 'Restless',         '2026-09-19 09:00:00+08', '2026-09-19 13:00:00+08', NULL),
  (365, '2026-09-19', 'Mood',     'Agitated',         '2026-09-19 10:00:00+08', '2026-09-19 12:00:00+08', NULL),
  (365, '2026-09-19', 'Mood',     'Anxious',          '2026-09-19 15:00:00+08', '2026-09-19 18:00:00+08', NULL),
  (365, '2026-09-19', 'Restraint','On Mitten Gloves', '2026-09-19 09:30:00+08', '2026-09-19 12:00:00+08', NULL),
  -- ── Resident 365, 2026-09-20 (quiet day) ──────────────────────
  (365, '2026-09-20', 'Verbal',   'Quiet',            '2026-09-20 07:00:00+08', '2026-09-20 22:00:00+08', NULL),
  (365, '2026-09-20', 'Physical', 'Calm',             '2026-09-20 07:00:00+08', '2026-09-20 22:00:00+08', NULL),
  (365, '2026-09-20', 'Mood',     'Relaxed',          '2026-09-20 08:00:00+08', '2026-09-20 12:00:00+08', NULL),
  (365, '2026-09-20', 'Mood',     'Sleepy',           '2026-09-20 14:00:00+08', '2026-09-20 16:00:00+08', 'Post-lunch nap'),
  -- ── Resident 365, 2026-09-21 ──────────────────────────────────
  (365, '2026-09-21', 'Verbal',   'Quiet',            '2026-09-21 07:00:00+08', '2026-09-21 20:00:00+08', NULL),
  (365, '2026-09-21', 'Physical', 'Calm',             '2026-09-21 07:00:00+08', '2026-09-21 20:00:00+08', NULL),
  (365, '2026-09-21', 'Mood',     'Relaxed',          '2026-09-21 10:00:00+08', '2026-09-21 20:00:00+08', NULL),

  -- ── Resident 366, 2026-09-15 ──────────────────────────────────
  (366::bigint, '2026-09-15'::date, 'Verbal',   'Incoherent Speech','2026-09-15 08:00:00+08', '2026-09-15 10:00:00+08', NULL),
  (366, '2026-09-15', 'Physical', 'Walking Around',   '2026-09-15 09:00:00+08', '2026-09-15 11:00:00+08', NULL),
  (366, '2026-09-15', 'Mood',     'Sleepy',           '2026-09-15 14:00:00+08', '2026-09-15 17:00:00+08', NULL),
  (366, '2026-09-15', 'Mood',     'Anxious',          '2026-09-15 19:00:00+08', '2026-09-15 21:00:00+08', NULL),
  -- ── Resident 366, 2026-09-16 ──────────────────────────────────
  (366, '2026-09-16', 'Verbal',   'Quiet',            '2026-09-16 07:00:00+08', '2026-09-16 22:00:00+08', NULL),
  (366, '2026-09-16', 'Physical', 'Calm',             '2026-09-16 07:00:00+08', '2026-09-16 22:00:00+08', NULL),
  (366, '2026-09-16', 'Mood',     'Relaxed',          '2026-09-16 09:00:00+08', '2026-09-16 21:00:00+08', NULL),
  -- ── Resident 366, 2026-09-17 ──────────────────────────────────
  (366, '2026-09-17', 'Verbal',   'Shouting',         '2026-09-17 10:00:00+08', '2026-09-17 12:00:00+08', NULL),
  (366, '2026-09-17', 'Verbal',   'Incoherent Speech','2026-09-17 15:00:00+08', '2026-09-17 16:30:00+08', NULL),
  (366, '2026-09-17', 'Physical', 'Restless',         '2026-09-17 10:00:00+08', '2026-09-17 13:00:00+08', NULL),
  (366, '2026-09-17', 'Physical', 'Walking Around',   '2026-09-17 11:00:00+08', '2026-09-17 12:00:00+08', 'Wandering in corridor'),
  (366, '2026-09-17', 'Mood',     'Anxious',          '2026-09-17 10:00:00+08', '2026-09-17 12:30:00+08', NULL),
  (366, '2026-09-17', 'Mood',     'Crying',           '2026-09-17 11:30:00+08', '2026-09-17 12:30:00+08', 'Distressed after phone call'),
  (366, '2026-09-17', 'Restraint','On Mitten Gloves', '2026-09-17 10:30:00+08', '2026-09-17 12:00:00+08', NULL),
  -- ── Resident 366, 2026-09-18 ──────────────────────────────────
  (366, '2026-09-18', 'Verbal',   'Quiet',            '2026-09-18 07:00:00+08', '2026-09-18 22:00:00+08', NULL),
  (366, '2026-09-18', 'Physical', 'Calm',             '2026-09-18 07:00:00+08', '2026-09-18 22:00:00+08', NULL),
  (366, '2026-09-18', 'Mood',     'Relaxed',          '2026-09-18 08:00:00+08', '2026-09-18 20:00:00+08', NULL),
  (366, '2026-09-18', 'Mood',     'Sleepy',           '2026-09-18 13:00:00+08', '2026-09-18 15:00:00+08', 'Post-lunch nap'),
  -- ── Resident 366, 2026-09-19 ──────────────────────────────────
  (366, '2026-09-19', 'Verbal',   'Shouting',         '2026-09-19 11:00:00+08', '2026-09-19 13:00:00+08', NULL),
  (366, '2026-09-19', 'Physical', 'Restless',         '2026-09-19 10:30:00+08', '2026-09-19 13:30:00+08', NULL),
  (366, '2026-09-19', 'Mood',     'Agitated',         '2026-09-19 11:00:00+08', '2026-09-19 13:00:00+08', NULL),
  (366, '2026-09-19', 'Restraint','On Mitten Gloves', '2026-09-19 11:00:00+08', '2026-09-19 13:00:00+08', NULL),
  -- ── Resident 366, 2026-09-20 (very bad day) ───────────────────
  (366, '2026-09-20', 'Verbal',   'Scolding Staff',   '2026-09-20 08:00:00+08', '2026-09-20 09:30:00+08', NULL),
  (366, '2026-09-20', 'Verbal',   'Shouting',         '2026-09-20 08:00:00+08', '2026-09-20 10:00:00+08', NULL),
  (366, '2026-09-20', 'Verbal',   'Shouting',         '2026-09-20 14:00:00+08', '2026-09-20 16:00:00+08', NULL),
  (366, '2026-09-20', 'Physical', 'Hitting Staff',    '2026-09-20 08:30:00+08', '2026-09-20 09:00:00+08', 'Slapped nurse'),
  (366, '2026-09-20', 'Physical', 'Restless',         '2026-09-20 07:00:00+08', '2026-09-20 11:00:00+08', NULL),
  (366, '2026-09-20', 'Mood',     'Angry',            '2026-09-20 07:00:00+08', '2026-09-20 11:00:00+08', NULL),
  (366, '2026-09-20', 'Mood',     'Agitated',         '2026-09-20 13:00:00+08', '2026-09-20 17:00:00+08', NULL),
  (366, '2026-09-20', 'Restraint','On Restrainer Vest','2026-09-20 08:30:00+08','2026-09-20 12:00:00+08', 'Applied for safety'),
  -- ── Resident 366, 2026-09-21 ──────────────────────────────────
  (366, '2026-09-21', 'Verbal',   'Quiet',            '2026-09-21 07:00:00+08', '2026-09-21 20:00:00+08', NULL),
  (366, '2026-09-21', 'Physical', 'Calm',             '2026-09-21 07:00:00+08', '2026-09-21 20:00:00+08', NULL),
  (366, '2026-09-21', 'Mood',     'Sleepy',           '2026-09-21 13:00:00+08', '2026-09-21 16:00:00+08', NULL),
  (366, '2026-09-21', 'Mood',     'Relaxed',          '2026-09-21 16:00:00+08', '2026-09-21 20:00:00+08', NULL)
) AS ep(resident, obs_date, category, behaviour, started_at, ended_at, note)
  ON c.resident = ep.resident AND c.obs_date = ep.obs_date;

COMMIT;
