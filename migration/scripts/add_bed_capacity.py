"""
Add bed_capacity column to tbl_branches.

This column is used by the Admission Analytics dashboard (residents/admission-analytics)
to display occupancy as "X / Y beds" and calculate an occupancy percentage.

After running this script, populate the values in Supabase:
  UPDATE tbl_branches SET bed_capacity = <n> WHERE "BranchID" = <id>;

Known nursing branches (Function = 'NUR'):
  BranchID 1  (AMN)  OSEM ELDERCARE CENTRE (AM)  — set actual bed count
  BranchID 3  (BMN)  OSEM ELDERCARE CENTRE (BM)  — set actual bed count
  BranchID 4  (BGN)  OSEM REHAB HUB              — set actual bed count
  BranchID 6  (DEMO) DEMO branch                 — can remain NULL

Run with: python migration/scripts/add_bed_capacity.py
"""

import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

cur.execute("""
    ALTER TABLE tbl_branches
    ADD COLUMN IF NOT EXISTS bed_capacity integer;
""")
conn.commit()

cur.execute("SELECT \"BranchID\", \"BranchCode\", \"BranchLocale\", bed_capacity FROM tbl_branches ORDER BY \"BranchID\"")
print("tbl_branches after migration:")
for row in cur.fetchall():
    print(f"  BranchID={row[0]}  code={row[1]}  locale={row[2]}  bed_capacity={row[3]}")

conn.close()
print("\nDone. Populate bed_capacity values in Supabase for the dashboard to show occupancy %.")
