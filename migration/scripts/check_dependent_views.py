import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("""
    select distinct dependent_ns.nspname, dependent_view.relname
    from pg_depend
    join pg_rewrite on pg_depend.objid = pg_rewrite.oid
    join pg_class as dependent_view on pg_rewrite.ev_class = dependent_view.oid
    join pg_class as source_table on pg_depend.refobjid = source_table.oid
    join pg_namespace dependent_ns on dependent_ns.oid = dependent_view.relnamespace
    where source_table.relname in ('tbl_staff','tbl_residents','tbl_progress_notes','tbl_nursing_chart_entries',
      'tbl_hospital_referrals','tbl_physio_op_patients','tbl_physio_progress_notes','tbl_products',
      'tbl_stock_movements','tbl_stock_request_details','tbl_stock_requests','tbl_stock_transfers',
      'tbl_fall_incidents','tbl_charging_summary')
    and dependent_view.relkind = 'v'
    order by 1,2
""")
views = cur.fetchall()
print("Dependent views:", views)
for schema, view in views:
    cur.execute(f'select pg_get_viewdef(\'{schema}.{view}\'::regclass, true)')
    print(f"--- {schema}.{view} ---")
    print(cur.fetchone()[0])
conn.close()
