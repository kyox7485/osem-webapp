import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select id, staff_name, role from tbl_staff where staff_name ilike %s", ("Ng Gao Fu",))
print(cur.fetchall())
conn.close()
