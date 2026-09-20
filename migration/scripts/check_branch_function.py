import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute('select "BranchID", "BranchLocale", "BranchCode", "Function", "Active" from tbl_branches order by "BranchID"')
for row in cur.fetchall():
    print(row)
cur.execute('select distinct branch_id from tbl_residents order by branch_id')
print("resident branch_ids in use:", cur.fetchall())
conn.close()
