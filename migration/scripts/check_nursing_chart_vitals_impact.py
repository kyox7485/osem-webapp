import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

cur.execute("select count(*) from tbl_nursing_chart_entries")
print("tbl_nursing_chart_entries row count:", cur.fetchone())

cur.execute("select column_name, data_type from information_schema.columns where table_name = 'tbl_nursing_chart_entries' order by ordinal_position")
print("columns:", cur.fetchall())

cur.execute("""
    select distinct dependent_ns.nspname, dependent_view.relname
    from pg_depend
    join pg_rewrite on pg_depend.objid = pg_rewrite.oid
    join pg_class as dependent_view on pg_rewrite.ev_class = dependent_view.oid
    join pg_class as source_table on pg_depend.refobjid = source_table.oid
    join pg_namespace dependent_ns on dependent_ns.oid = dependent_view.relnamespace
    where source_table.relname = 'tbl_nursing_chart_entries'
    and dependent_view.relkind = 'v'
""")
print("dependent views:", cur.fetchall())

cur.execute("""
    select conname, conrelid::regclass, confrelid::regclass
    from pg_constraint
    where confrelid = 'tbl_nursing_chart_entries'::regclass
""")
print("FKs pointing at tbl_nursing_chart_entries:", cur.fetchall())

conn.close()
