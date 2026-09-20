import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

cur.execute('select count(*) from tbl_branches')
print("tbl_branches row count:", cur.fetchone())

cur.execute("""
    select conname, conrelid::regclass, confrelid::regclass
    from pg_constraint
    where confrelid = 'tbl_branches'::regclass
    order by conrelid::regclass::text
""")
print("FKs pointing at tbl_branches:", cur.fetchall())

cur.execute("select distinct branch_id from tbl_staff order by branch_id")
print("tbl_staff.branch_id distinct:", cur.fetchall())
cur.execute("select distinct branch_id from tbl_user_accounts order by branch_id")
print("tbl_user_accounts.branch_id distinct:", cur.fetchall())
cur.execute("select distinct branch_id from tbl_residents order by branch_id")
print("tbl_residents.branch_id distinct:", cur.fetchall())

conn.close()
