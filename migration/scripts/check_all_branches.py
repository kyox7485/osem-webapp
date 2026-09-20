import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute('select "BranchID", "BranchName", "BranchCode", "BranchLocale" from tbl_branches order by "BranchID"')
for row in cur.fetchall():
    print(row)
conn.close()
