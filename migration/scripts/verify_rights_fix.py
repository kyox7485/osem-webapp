import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

cur.execute("""
select t.typname, e.enumlabel from pg_type t join pg_enum e on t.oid=e.enumtypid
where t.typname in ('staff_role','id_rights') order by t.typname, e.enumsortorder
""")
print("Enums:", cur.fetchall())

cur.execute("select id, username, email, branch_id, rights, status from tbl_user_accounts order by id")
print("Accounts:", cur.fetchall())

cur.execute("select role, count(*) from tbl_staff group by role order by role")
print("tbl_staff.role counts:", cur.fetchall())

cur.execute("select count(*) from pg_policies where qual ~ 'staff_role' or with_check ~ 'staff_role'")
print("Remaining policies still referencing staff_role literal:", cur.fetchone())

cur.execute("select proname, prorettype::regtype from pg_proc where proname in ('auth_role','auth_branch_id','auth_account_id')")
print("Functions:", cur.fetchall())
conn.close()
