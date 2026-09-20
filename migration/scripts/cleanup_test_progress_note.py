import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()
try:
    cur.execute("delete from tbl_progress_notes where progress_note = %s returning id", ("Test dashboard progress note",))
    print("Deleted:", cur.fetchall())
    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
