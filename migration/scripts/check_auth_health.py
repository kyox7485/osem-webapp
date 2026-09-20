import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select id, email, username, auth_user_id, rights, status from tbl_user_accounts order by id")
print("accounts:", cur.fetchall())
cur.execute("select proname, prorettype::regtype from pg_proc where proname = 'auth_role'")
print("auth_role fn:", cur.fetchall())
try:
    cur.execute("select auth_role()")
    print("auth_role() call result:", cur.fetchall())
except Exception as e:
    print("auth_role() call failed:", e)
conn.close()
