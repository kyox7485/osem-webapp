-- Fix: fn_generate_resident_id must be SECURITY DEFINER so the UPDATE on
-- tbl_branches (incrementing resident_seq) succeeds regardless of the calling
-- user's RLS permissions. Without this, STAFF-rights accounts got a silent
-- 0-row update, leaving ResidentID NULL and hitting the NOT NULL constraint.
--
-- Applied via Supabase MCP on 2026-09-25.

CREATE OR REPLACE FUNCTION fn_generate_resident_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_next bigint;
BEGIN
  IF new."ResidentID" IS NOT NULL THEN
    RETURN new;
  END IF;
  UPDATE tbl_branches
    SET resident_seq = resident_seq + 1
    WHERE "BranchID" = new.branch_id
    RETURNING resident_seq, "BranchCode" INTO v_next, v_code;
  new."ResidentID" := v_code || '-' || lpad(v_next::text, 4, '0');
  RETURN new;
END;
$$;
