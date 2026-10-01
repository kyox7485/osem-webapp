-- =============================================================
-- 022_callbell.sql  –  OSEM Call Bell management tables
-- =============================================================

-- ── Branch flag ───────────────────────────────────────────────
ALTER TABLE tbl_branches
    ADD COLUMN IF NOT EXISTS callbell_enabled boolean NOT NULL DEFAULT false;

-- ── Receivers ─────────────────────────────────────────────────
-- One row per physical Wenze L5070 receiver unit.
-- device_token is a UUID shared with the APK at setup time.
CREATE TABLE IF NOT EXISTS cb_receivers (
    id              bigserial        PRIMARY KEY,
    branch_id       bigint           NOT NULL REFERENCES tbl_branches("BranchID"),
    receiver_label  text             NOT NULL,
    android_id      text,
    device_token    text             NOT NULL UNIQUE,
    last_seen_at    timestamptz,
    apk_version     text,
    created_at      timestamptz      NOT NULL DEFAULT now(),
    updated_at      timestamptz      NOT NULL DEFAULT now()
);

-- ── Assignments ───────────────────────────────────────────────
-- Maps a Wenze DEVICE_NUM (hex string) to an OSEM resident.
-- resident_id NULL means the bell position is unassigned.
CREATE TABLE IF NOT EXISTS cb_assignments (
    id              bigserial        PRIMARY KEY,
    receiver_id     bigint           NOT NULL REFERENCES cb_receivers(id) ON DELETE CASCADE,
    device_num      text             NOT NULL,
    resident_id     bigint           REFERENCES tbl_residents(id) ON DELETE SET NULL,
    room_label      text,
    created_at      timestamptz      NOT NULL DEFAULT now(),
    updated_at      timestamptz      NOT NULL DEFAULT now(),
    UNIQUE (receiver_id, device_num)
);

-- ── Call logs ─────────────────────────────────────────────────
-- Ingested rows from CALL_RECORDING_BEAN on the Wenze SQLite DB.
-- Composite unique key prevents double-ingestion.
-- resident_name_snapshot captures the name at call time (frozen).
CREATE TABLE IF NOT EXISTS cb_call_logs (
    id                      bigserial    PRIMARY KEY,
    receiver_id             bigint       NOT NULL REFERENCES cb_receivers(id) ON DELETE CASCADE,
    local_id                bigint       NOT NULL,
    device_num              text         NOT NULL,
    resident_name_snapshot  text,
    call_type               text,
    is_cancel_call          text,
    is_call                 text,
    call_time               bigint,
    response_time           bigint,
    duration                text,
    sex                     text,
    level                   text,
    remark                  text,
    contact_number          text,
    ingested_at             timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (receiver_id, local_id, call_time)
);

CREATE INDEX IF NOT EXISTS cb_call_logs_receiver_call_time
    ON cb_call_logs (receiver_id, call_time DESC);

-- ── Disarm events ─────────────────────────────────────────────
-- A disarm silences a specific bell device for a time window.
-- The APK enforces this locally even after internet loss.
CREATE TABLE IF NOT EXISTS cb_disarm_events (
    id              bigserial        PRIMARY KEY,
    receiver_id     bigint           NOT NULL REFERENCES cb_receivers(id) ON DELETE CASCADE,
    device_num      text             NOT NULL,
    disarm_start    timestamptz      NOT NULL,
    disarm_end      timestamptz      NOT NULL,
    reason          text,
    authorized_by   text,
    created_at      timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cb_disarm_events_active
    ON cb_disarm_events (receiver_id, device_num, disarm_end);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE cb_receivers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_call_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_disarm_events ENABLE ROW LEVEL SECURITY;

-- Authenticated web users may read rows for their own branch.
-- All writes go through the service-role API routes only.
DROP POLICY IF EXISTS "cb_receivers_select" ON cb_receivers;
CREATE POLICY "cb_receivers_select" ON cb_receivers
    FOR SELECT USING (
        branch_id = (
            SELECT u.branch_id
            FROM tbl_user_accounts u
            WHERE u.auth_user_id = auth.uid()
            LIMIT 1
        )
    );

DROP POLICY IF EXISTS "cb_assignments_select" ON cb_assignments;
CREATE POLICY "cb_assignments_select" ON cb_assignments
    FOR SELECT USING (
        receiver_id IN (
            SELECT r.id FROM cb_receivers r
            JOIN tbl_user_accounts u ON u.branch_id = r.branch_id
            WHERE u.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "cb_call_logs_select" ON cb_call_logs;
CREATE POLICY "cb_call_logs_select" ON cb_call_logs
    FOR SELECT USING (
        receiver_id IN (
            SELECT r.id FROM cb_receivers r
            JOIN tbl_user_accounts u ON u.branch_id = r.branch_id
            WHERE u.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "cb_disarm_events_select" ON cb_disarm_events;
CREATE POLICY "cb_disarm_events_select" ON cb_disarm_events
    FOR SELECT USING (
        receiver_id IN (
            SELECT r.id FROM cb_receivers r
            JOIN tbl_user_accounts u ON u.branch_id = r.branch_id
            WHERE u.auth_user_id = auth.uid()
        )
    );
