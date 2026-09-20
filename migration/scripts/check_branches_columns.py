import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select column_name, data_type, udt_name from information_schema.columns where table_name = 'tbl_branches' order by ordinal_position")
print("tbl_branches columns:", cur.fetchall())
cur.execute('select * from tbl_branches')
cols = [d[0] for d in cur.description]
print("columns order:", cols)
rows = cur.fetchall()
for r in rows:
    print(r)
conn.close()
