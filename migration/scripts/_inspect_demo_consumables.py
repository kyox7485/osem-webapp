"""Read-only inspection of the DEMO branch + consumables tables."""
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(HERE, "..", ".env"))
import psycopg2  # noqa: E402

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=20)
cur = conn.cursor()

def q(label, sql, args=None):
    print(f"\n=== {label} ===")
    cur.execute(sql, args)
    cols = [d[0] for d in cur.description]
    print("  " + " | ".join(cols))
    for row in cur.fetchall():
        print("  " + " | ".join("NULL" if v is None else str(v) for v in row))

q("branches columns", """
    select column_name from information_schema.columns
    where table_name = 'tbl_branches' order by ordinal_position
""")

q("branches (demo/hq)", """
    select * from tbl_branches
    where is_demo or "Function" = 'HQ' order by "BranchID"
""")

q("resident name columns", """
    select column_name from information_schema.columns
    where table_name = 'tbl_residents' and column_name ilike '%name%'
    order by ordinal_position
""")

q("DEMO residents", """
    select id, "ResidentID", status from tbl_residents
    where branch_id = 6
    order by "ResidentID"
""")

q("DEMO staff", """
    select "StaffID", staff_name, status, branch_id from tbl_staff
    where branch_id in (5, 6) order by branch_id, "StaffID"
""")

q("consumable master", """
    select consumable_id, consumable, unit, max_stock, restock_required
    from tbl_consumable_master order by consumable_id
""")

q("consumable record count", """
    select count(*) from tbl_resident_consumables
""")

q("medication stock rows for demo (precedent)", """
    select count(*) from tbl_medication_stock
    where branch_id = (select "BranchID" from tbl_branches where is_demo order by "BranchID" limit 1)
""")

cur.close()
conn.close()
