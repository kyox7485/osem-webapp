import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()
try:
    cur.execute("""
        insert into tbl_staff (branch_id, staff_name, position_id, role, status, department)
        values (1, 'TEST TRIGGER STAFF', (select id from tbl_positions limit 1), 'STAFF', 'ACTIVE', 'Nursing')
        returning "StaffID";
    """)
    print("New StaffID generated:", cur.fetchone())
    conn.rollback()  # don't actually keep the test row
    print("Rolled back test insert (not kept)")

    cur.execute("select column_name, is_nullable from information_schema.columns where table_name = 'tbl_staff' order by ordinal_position")
    print("tbl_staff nullability:", cur.fetchall())
except Exception as e:
    conn.rollback()
    print("FAILED:", e)
    raise
finally:
    conn.close()
