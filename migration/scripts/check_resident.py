import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select id, resident_name, age, gender, marital_status from tbl_residents where id=129")
print(cur.fetchall())
conn.close()
