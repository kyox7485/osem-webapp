import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select relname, reloptions from pg_class where relname = 'v_latest_progress_note'")
print(cur.fetchall())
conn.close()
