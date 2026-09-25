"""Read-only: does RLS itself hide the DEMO branch (id 6) from a MODERATOR?

The webapp hides demo data in application code (excludedBranchIds), but that
only protects the UI -- a MODERATOR hitting the API directly gets whatever
RLS allows. This lists every policy that mentions auth_is_demo_account() so
we can see which tables are protected at the database level.
"""
import os

from dotenv import load_dotenv

load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

print("=== demo branch ===")
cur.execute('select "BranchID", "BranchCode", "BranchName", is_demo, "Function" from tbl_branches order by "BranchID"')
for r in cur.fetchall():
    print(r)

print()
print("=== policies WITH a database-level demo guard ===")
cur.execute(
    """
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and (qual like '%auth_is_demo_account%' or with_check like '%auth_is_demo_account%')
     order by tablename
    """
)
guarded = {r[0] for r in cur.fetchall()}
cur.execute(
    """
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and (qual like '%auth_is_demo_account%' or with_check like '%auth_is_demo_account%')
     order by tablename
    """
)
for t, p in cur.fetchall():
    print(f"  {t:34} {p}")

print()
print("=== branch-scoped policies WITHOUT any demo guard ===")
cur.execute(
    """
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and (qual like '%auth_role%' or with_check like '%auth_role%')
       and qual not like '%auth_is_demo_account%'
       and with_check not like '%auth_is_demo_account%'
       and tablename not in ('tbl_user_accounts','tbl_positions','tbl_lookup_values')
     order by tablename, policyname
    """
)
unguarded = cur.fetchall()
for t, p in unguarded:
    flag = "  <-- branch 6 rows reachable" if t not in guarded else ""
    print(f"  {t:34} {p}{flag}")

print()
print("=== what a MODERATOR would actually see (row counts by branch) ===")
# These are raw counts -- RLS is not applied to this superuser/table-owner
# connection, so this is the ceiling, not what the moderator gets.
for table in ("tbl_residents", "tbl_progress_notes", "tbl_vital", "tbl_medication_orders", "tbl_wound_sessions"):
    cur.execute(f"select branch_id, count(*) from {table} group by branch_id order by branch_id")
    counts = {r[0]: r[1] for r in cur.fetchall()}
    demo = counts.get(6, 0)
    print(f"  {table:24} branch 6 (DEMO) = {demo:5}   all = {sum(counts.values()):5}")

conn.close()
