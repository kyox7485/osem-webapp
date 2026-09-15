import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("alter table tbl_user_accounts drop column staff_id;")
conn.commit()
print("OK")
conn.close()
