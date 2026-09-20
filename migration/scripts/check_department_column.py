import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("""
    select udt_name from information_schema.columns
    where table_name = 'tbl_staff' and column_name = 'Department'
""")
print("Department udt_name:", cur.fetchall())
cur.execute("""
    select e.enumlabel
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = (
      select udt_name from information_schema.columns
      where table_name = 'tbl_staff' and column_name = 'Department'
    )
    order by e.enumsortorder
""")
print("Department enum labels:", cur.fetchall())
cur.execute('select "Department", count(*) from tbl_staff group by "Department" order by 1')
print("Department distinct values in use:", cur.fetchall())
conn.close()
