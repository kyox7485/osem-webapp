import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()
try:
    cur.execute('delete from tbl_staff where "StaffID" = %s returning "StaffID"', ("AMN-40",))
    print("Deleted:", cur.fetchall())
    cur.execute('update tbl_branches set staff_seq = staff_seq - 1 where "BranchID" = 1;')
    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
