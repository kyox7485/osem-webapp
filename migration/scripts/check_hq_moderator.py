"""Read-only diagnostic: why does the HQ MODERATOR account see no data?

Checks (a) which branch the account points at and whether that branch holds
any residents, and (b) whether MODERATOR actually bypasses the branch_scope
RLS policies on the live database (it should, per schema/001_init.sql).
"""
import os

from dotenv import load_dotenv

load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

EMAIL = "osem.aleif@gmail.com"

print("=== account row ===")
cur.execute(
    """
    select a.id, a.email, a.username, a.rights, a.status,
           a.branch_id, b."BranchName", b."BranchCode", b."Function"
      from tbl_user_accounts a
      left join tbl_branches b on b."BranchID" = a.branch_id
     where lower(a.email) = lower(%s)
""",
    (EMAIL,),
)
rows = cur.fetchall()
for r in rows:
    print(r)
if not rows:
    print("NO ACCOUNT ROW FOUND for", EMAIL)
    raise SystemExit(0)

branch_id = rows[0][5]

print()
print("=== linked auth user ===")
cur.execute(
    """
    select a.auth_user_id, u.email
      from tbl_user_accounts a
      left join auth.users u on u.id = a.auth_user_id
     where a.id = %s
    """,
    (rows[0][0],),
)
print(cur.fetchall())

print()
print("=== residents per branch (top 10) ===")
cur.execute(
    """
    select branch_id, count(*)
      from tbl_residents
     where status = 'ACTIVE'
     group by branch_id
     order by count(*) desc
     limit 10
    """
)
for r in cur.fetchall():
    print(r)

print()
print("=== residents visible to this account (simulated RLS) ===")
cur.execute("select count(*) from tbl_residents where branch_id = %s", (branch_id,))
print("own branch only:", cur.fetchone()[0])
cur.execute("select count(*) from tbl_residents")
print("all branches   :", cur.fetchone()[0])

print()
print("=== actual auth_role()/auth_branch_id() helper definitions ===")
cur.execute("select pg_get_functiondef(oid) from pg_proc where proname in ('auth_role','auth_branch_id')")
for (defn,) in cur.fetchall():
    print(defn)
    print("-" * 40)

print()
print("=== does MODERATOR appear in live RLS policies? ===")
cur.execute(
    """
    select tablename, policyname, cmd, qual
      from pg_policies
     where schemaname = 'public'
       and (qual like '%MODERATOR%' or with_check like '%MODERATOR%')
     order by tablename, policyname
    """
)
for r in cur.fetchall():
    print(f"{r[0]:38} {r[1]:34} {r[2]:8} {' '.join((r[3] or '').split())[:110]}")

print()
print("=== policies governing tbl_residents ===")
cur.execute(
    """
    select policyname, cmd, roles::text, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'tbl_residents'
    """
)
for r in cur.fetchall():
    print(f"{r[0]:30} {r[1]:8} {r[2]}\n    using     : {' '.join((r[3] or '').split())}\n    with check: {' '.join((r[4] or '').split())}")

conn.close()
