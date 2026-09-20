import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

cur.execute("""
    select conname, conrelid::regclass::text as child_table, a.attname as fk_column
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.confrelid = 'tbl_staff'::regclass
    order by child_table, fk_column
""")
fks = cur.fetchall()
print("FKs pointing at tbl_staff:")
for row in fks:
    print(" ", row)

print()
for conname, table, col in fks:
    cur.execute(f'select count(*), count({col}) from {table}')
    total, nonnull = cur.fetchone()
    print(f"{table}.{col}: {total} total rows, {nonnull} non-null refs to tbl_staff")

cur.execute("select id, branch_id, staff_name, status from tbl_staff order by branch_id, id")
print()
print("tbl_staff rows (id, branch_id, staff_name, status):")
for row in cur.fetchall():
    print(" ", row)

cur.execute('select "BranchID", "BranchCode" from tbl_branches order by "BranchID"')
print()
print("branches:", cur.fetchall())

conn.close()
