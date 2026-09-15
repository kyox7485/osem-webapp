import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("""
    insert into tbl_staff (auth_user_id, branch_id, staff_name, position_id, role, status)
    values (%s, %s, %s, %s, %s, %s)
    returning id
""", ("8942c337-e3e3-4090-a161-ab99a801030b", 1, "OSEM Medicare", 17, "admin", "ACTIVE"))
new_id = cur.fetchone()[0]
conn.commit()
print("created tbl_staff.id =", new_id)
conn.close()
