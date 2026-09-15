import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select role, count(*) from tbl_staff group by role order by role")
print("tbl_staff.role distinct values:", cur.fetchall())
cur.execute("select id, username, rights from tbl_user_accounts order by id")
print("tbl_user_accounts rows:", cur.fetchall())
conn.close()
