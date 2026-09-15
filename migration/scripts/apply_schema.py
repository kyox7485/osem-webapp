import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
dsn = os.environ["PG_DSN"]
with open(r"C:\Users\NGF\dev\osem-webapp\schema\001_init.sql", "r", encoding="utf-8") as f:
    sql = f.read()
conn = psycopg2.connect(dsn, connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()
try:
    cur.execute(sql)
    conn.commit()
    print("SCHEMA APPLIED OK")
except Exception as e:
    conn.rollback()
    print("ERROR:", e)
conn.close()
