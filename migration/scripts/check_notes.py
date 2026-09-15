import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select id, resident_id, progress_note, created_by from tbl_progress_notes order by id desc limit 5")
print(cur.fetchall())
conn.close()
