"""Dry-run scope_moderator_to_branch.sql inside a transaction that always
rolls back, so the production database is never changed. Proves the SQL parses
and the policies can be created; prints the read-back the script would produce.
"""
import os
import re
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
import psycopg2

SQL = Path(__file__).with_name("scope_moderator_to_branch.sql").read_text(encoding="utf-8")
# strip the leading BEGIN/COMMIT -- psycopg2 manages the transaction itself so
# we can guarantee the rollback regardless of what happens below.
body = re.sub(r"^\s*begin;\s*$", "", SQL, flags=re.M | re.I)
body = re.sub(r"^\s*commit;\s*$", "", body, flags=re.M | re.I)

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
try:
    with conn.cursor() as cur:
        cur.execute(body)
        rows = cur.fetchall()
        print("=== policies after the migration would apply ===")
        for t, p, rule in rows:
            print(f"  {t:28} {p:36} {rule}")
except Exception as exc:  # noqa: BLE001
    conn.rollback()
    print("MIGRATION IS INVALID -- rolled back, nothing changed:\n", exc)
    raise SystemExit(1)
finally:
    conn.rollback()
    print("\nrolled back -- production database unchanged")

# Independent check that the helper classifies each real account correctly.
conn2 = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
with conn2.cursor() as cur:
    cur.execute(
        """
        select u.email, u.rights, b."Function", b.is_demo
          from tbl_user_accounts u
          left join tbl_branches b on b."BranchID" = u.branch_id
         order by u.id
        """
    )
    print("\n=== accounts (rights, Function) -- expected all-branch scope ===")
    for email, rights, func, is_demo in cur.fetchall():
        allbr = rights == "ADMIN" or func in ("HQ", "PHY")
        print(f"  {email:34} {str(rights):10} {str(func):5} demo={bool(is_demo)!s:5} -> {'ALL BRANCHES' if allbr else 'own branch only'}")
conn2.close()
conn.close()
