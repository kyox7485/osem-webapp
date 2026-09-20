import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

cur.execute("select prosrc from pg_proc where proname = 'fn_audit_trigger'")
print("fn_audit_trigger source:")
print(cur.fetchone()[0])

cur.execute("select column_name, data_type from information_schema.columns where table_name = 'tbl_audit_log' order by ordinal_position")
print()
print("tbl_audit_log columns:", cur.fetchall())

cur.execute("""
    select event_object_table, trigger_name
    from information_schema.triggers
    where action_statement ilike '%fn_audit_trigger%'
    order by 1
""")
print()
print("Tables with fn_audit_trigger attached:", cur.fetchall())
conn.close()
