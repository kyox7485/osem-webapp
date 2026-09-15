import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

try:
    # Sanity check: nothing may be using the labels we're about to drop.
    cur.execute("select role, count(*) from tbl_staff group by role")
    counts = dict(cur.fetchall())
    doomed = ["nurse", "caregiver", "physio", "pharmacist"]
    still_used = [r for r in doomed if counts.get(r)]
    if still_used:
        raise RuntimeError(f"Refusing to proceed, still in use: {still_used}")
    print("Pre-check OK, current role counts:", counts)

    # Rename the live "Department" column to lowercase, matching the rest of
    # the schema's snake_case convention (everything else in tbl_staff is
    # lowercase; this column was added directly in the Supabase dashboard).
    cur.execute('alter table tbl_staff rename column "Department" to department;')

    # Postgres enums can't drop labels in place -- recreate with only the
    # 3 labels actually in use, swap the column over, drop the old type.
    cur.execute("create type staff_role_new as enum ('ADMIN', 'MODERATOR', 'STAFF');")
    cur.execute("alter table tbl_staff alter column role type staff_role_new using role::text::staff_role_new;")
    cur.execute("drop type staff_role;")
    cur.execute("alter type staff_role_new rename to staff_role;")

    cur.execute("select role, count(*) from tbl_staff group by role order by role")
    print("Post-migration role counts:", cur.fetchall())
    cur.execute("select department, count(*) from tbl_staff group by department order by department")
    print("Post-migration department counts:", cur.fetchall())

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
