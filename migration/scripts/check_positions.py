import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select id, name from tbl_positions order by id")
print("positions:", cur.fetchall())
cur.execute("select id, code from tbl_branches")
print("branches:", cur.fetchall())
cur.execute("select id, staff_name, auth_user_id, role from tbl_staff where auth_user_id is not null")
print("linked staff:", cur.fetchall())
conn.close()
