import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("""
select t.typname, e.enumlabel
from pg_type t
join pg_enum e on t.oid = e.enumtypid
where t.typname like '%right%' or t.typname = 'staff_role'
order by t.typname, e.enumsortorder
""")
for row in cur.fetchall():
    print(row)
cur.execute("select column_name, data_type, udt_name from information_schema.columns where table_name = 'tbl_user_accounts' and column_name='rights'")
print(cur.fetchall())
conn.close()
