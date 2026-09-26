"""Detailed inspection of DEMO branch consumables to understand current state."""
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

# Current consumables records in DEMO branch
q("Current DEMO consumable records", """
    select r.id, r.external_ref_id, r.resident_id, r.resident_name, 
           r.consumable_id, r.name, r.current_stock, r.last_count,
           r.supplier, r.counted_by_name
    from tbl_resident_consumables r
    join tbl_residents res on r.resident_id = res.id
    where res.branch_id = 6
    order by r.last_count desc
""")

# DEMO staff for CountedBy validation
q("DEMO active staff (for CountedBy)", """
    select StaffID, staff_name, branch_id
    from tbl_staff
    where status = 'ACTIVE' and branch_id = 6
    order by StaffID
""")

# DEMO staff from HQ (allowed for counting)
q("HQ staff (allowed for counting)", """
    select StaffID, staff_name, branch_id
    from tbl_staff
    where status = 'ACTIVE' and branch_id = 5
    order by StaffID
""")

cur.close()
conn.close()