import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select id, resident_name, branch_id, reviewed_by from tbl_residents where resident_name = %s", ("TEST RESIDENT DELETE ME 2",))
print(cur.fetchall())
cur.execute("delete from tbl_residents where resident_name = %s", ("TEST RESIDENT DELETE ME 2",))
conn.commit()
print("deleted", cur.rowcount)
conn.close()
