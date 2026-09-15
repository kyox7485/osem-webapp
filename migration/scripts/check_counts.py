import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
for t in ["tbl_branches","tbl_staff","tbl_residents","tbl_progress_notes"]:
    cur.execute(f"select count(*) from {t}")
    print(t, cur.fetchone()[0])
conn.close()
