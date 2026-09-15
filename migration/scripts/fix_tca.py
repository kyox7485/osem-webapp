import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("drop view if exists v_latest_progress_note;")
cur.execute("alter table tbl_residents rename column tca_date to tca_notes;")
cur.execute("alter table tbl_residents alter column tca_notes type text using tca_notes::text;")
cur.execute("alter table tbl_progress_notes rename column tca_date to tca_notes;")
cur.execute("alter table tbl_progress_notes alter column tca_notes type text using tca_notes::text;")
cur.execute("""
create view v_latest_progress_note with (security_invoker = true) as
select distinct on (resident_id) *
from tbl_progress_notes
order by resident_id, entry_timestamp desc;
""")
conn.commit()
print("OK")
cur.execute("select table_name, column_name, data_type from information_schema.columns where table_name in ('tbl_residents','tbl_progress_notes') and column_name like 'tca%'")
print(cur.fetchall())
conn.close()
