import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()
try:
    cur.execute("alter view v_latest_progress_note set (security_invoker = true);")
    cur.execute("select relname, reloptions from pg_class where relname = 'v_latest_progress_note'")
    print(cur.fetchall())
    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
