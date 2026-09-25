"""Read-only: what state did the failed scope_moderator_to_branch.sql leave?

The migration wrapped itself in BEGIN/COMMIT, so a failure partway through
should have rolled the whole thing back. This verifies that rather than
assuming it -- a half-applied migration would be worse than none.
"""
import os

from dotenv import load_dotenv

load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

print("=== does auth_is_all_branch_account() exist? ===")
cur.execute(
    """
    select count(*) from pg_proc
     where proname = 'auth_is_all_branch_account'
       and pronamespace = 'public'::regnamespace
    """
)
n = cur.fetchone()[0]
print(f"  count = {n}  ->  {'APPLIED (rolled back did NOT happen)' if n else 'absent -> migration rolled back cleanly'}")

print()
print("=== how many policies still use the OLD role test? ===")
cur.execute(
    """
    select count(*) from pg_policies
     where schemaname = 'public'
       and (qual like '%auth_is_all_branch_account%' or with_check like '%auth_is_all_branch_account%')
    """
)
print(f"  policies using the new helper: {cur.fetchone()[0]}  (0 = nothing applied)")

cur.execute(
    """
    select count(*) from pg_policies
     where schemaname = 'public'
       and (qual like '%auth_role%' or with_check like '%auth_role%')
       and qual not like '%auth_is_all_branch_account%'
    """
)
print(f"  policies still on the old auth_role() test: {cur.fetchone()[0]}")

print()
print("=== tbl_observation_status policies (the ones that errored) ===")
cur.execute(
    """
    select policyname, cmd,
           length(coalesce(qual::text,'')) as qlen,
           length(coalesce(with_check::text,'')) as clen
      from pg_policies
     where schemaname = 'public' and tablename = 'tbl_observation_status'
     order by policyname
    """
)
rows = cur.fetchall()
if not rows:
    print("  NONE EXIST -- the drop policy ran but the create failed; table has no RLS policies!")
for p, cmd, qlen, clen in rows:
    print(f"  {p:22} {cmd:8} using_len={qlen:<5} check_len={clen}")

print()
print("=== is RLS still enabled on tbl_observation_status? ===")
cur.execute("select relrowsecurity from pg_class where relname = 'tbl_observation_status'")
print("  relrowsecurity =", cur.fetchone()[0], "(True = enabled)")

conn.close()
