import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("""
    select e.enumlabel, e.enumsortorder
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'staff_role'
    order by e.enumsortorder
""")
print("staff_role enum labels:", cur.fetchall())
cur.execute("select column_name, data_type from information_schema.columns where table_name = 'tbl_staff' order by ordinal_position")
print("tbl_staff columns:", cur.fetchall())
conn.close()
