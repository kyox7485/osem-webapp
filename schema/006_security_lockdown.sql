-- Security lockdown: close anon/authenticated access that RLS was not covering.
--
-- Found during the Inventory Phase 0 review (docs/inventory-design-audit.md §C):
--   1. tbl_audit_log (full row snapshots incl. resident data) had RLS disabled
--      and anon + authenticated held SELECT/INSERT/UPDATE/DELETE/TRUNCATE —
--      anyone with the public anon key could read or wipe it.
--   2. tbl_nursing_chart_elimination_episodes had the same exposure.
--   3. tbl_resident_consumables still used the legacy "any ADMIN/MODERATOR sees
--      every branch" policy instead of the branch-Function scope rule
--      (auth_is_all_branch_account(): ADMIN, or HQ/PHY branch).
--   4. The SECURITY DEFINER auth_* helpers had no pinned search_path.
--
-- The webapp never reads tbl_audit_log; only fn_audit_trigger writes it. The
-- trigger now runs as its owner, so clients need no grant on the table at all.
--
-- Applied via Supabase MCP on 2026-09-29.

-- 1. Audit log: trigger writes as owner; clients get nothing.
CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record_id text;
BEGIN
  IF tg_table_name = 'tbl_staff' THEN
    v_record_id := coalesce(new."StaffID", old."StaffID");
  ELSE
    v_record_id := coalesce(new.id, old.id)::text;
  END IF;
  INSERT INTO public.tbl_audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  VALUES (
    tg_table_name,
    v_record_id,
    tg_op,
    auth.uid(),
    CASE WHEN tg_op IN ('UPDATE','DELETE') THEN to_jsonb(old) ELSE NULL END,
    CASE WHEN tg_op IN ('UPDATE','INSERT') THEN to_jsonb(new) ELSE NULL END
  );
  RETURN coalesce(new, old);
END;
$$;

REVOKE ALL ON FUNCTION fn_audit_trigger() FROM PUBLIC, anon, authenticated;

ALTER TABLE tbl_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE tbl_audit_log FROM anon, authenticated;
REVOKE ALL ON SEQUENCE tbl_audit_log_id_seq FROM anon, authenticated;
-- No policies on purpose: only the table owner / service_role can read it.

-- 2. Elimination episodes: same branch-scope policy as its sibling
--    tbl_nursing_chart_hygiene_episodes / tbl_nursing_chart_meals.
ALTER TABLE tbl_nursing_chart_elimination_episodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE tbl_nursing_chart_elimination_episodes FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE tbl_nursing_chart_elimination_episodes FROM authenticated;

DROP POLICY IF EXISTS branch_scope_tbl_nursing_chart_elimination_episodes
  ON tbl_nursing_chart_elimination_episodes;
CREATE POLICY branch_scope_tbl_nursing_chart_elimination_episodes
  ON tbl_nursing_chart_elimination_episodes
  FOR ALL
  USING (
    branch_id = auth_branch_id()
    OR (
      auth_is_all_branch_account()
      AND NOT auth_is_demo_account()
      AND NOT EXISTS (
        SELECT 1 FROM tbl_branches b
         WHERE b."BranchID" = tbl_nursing_chart_elimination_episodes.branch_id
           AND b.is_demo
      )
    )
  )
  WITH CHECK (
    branch_id = auth_branch_id()
    OR (
      auth_is_all_branch_account()
      AND NOT auth_is_demo_account()
      AND NOT EXISTS (
        SELECT 1 FROM tbl_branches b
         WHERE b."BranchID" = tbl_nursing_chart_elimination_episodes.branch_id
           AND b.is_demo
      )
    )
  );

-- 3. Resident consumables: branch-Function scope, not rights tier
--    (same rule as tbl_medication_stock; see migration/scripts/scope_moderator_to_branch.sql).
DROP POLICY IF EXISTS branch_scope_tbl_resident_consumables ON tbl_resident_consumables;
CREATE POLICY branch_scope_tbl_resident_consumables
  ON tbl_resident_consumables
  FOR ALL
  USING (
    branch_id = auth_branch_id()
    OR (
      auth_is_all_branch_account()
      AND NOT auth_is_demo_account()
      AND NOT EXISTS (
        SELECT 1 FROM tbl_branches b
         WHERE b."BranchID" = tbl_resident_consumables.branch_id
           AND b.is_demo
      )
    )
  )
  WITH CHECK (
    branch_id = auth_branch_id()
    OR (
      auth_is_all_branch_account()
      AND NOT auth_is_demo_account()
      AND NOT EXISTS (
        SELECT 1 FROM tbl_branches b
         WHERE b."BranchID" = tbl_resident_consumables.branch_id
           AND b.is_demo
      )
    )
  );

-- 4. Pin search_path on the SECURITY DEFINER auth helpers.
ALTER FUNCTION auth_account_id()            SET search_path = public, pg_temp;
ALTER FUNCTION auth_branch_id()             SET search_path = public, pg_temp;
ALTER FUNCTION auth_role()                  SET search_path = public, pg_temp;
ALTER FUNCTION auth_is_demo_account()       SET search_path = public, pg_temp;
ALTER FUNCTION auth_is_all_branch_account() SET search_path = public, pg_temp;
