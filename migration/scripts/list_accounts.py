import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute('select id, email, username, rights, branch_id, status from tbl_user_accounts order by id')
for row in cur.fetchall():
    print(row)
conn.close()
