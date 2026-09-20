import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

print("=== tbl_nursing_chart_entries ===")
cur.execute("select count(*) from tbl_nursing_chart_entries")
print("row count:", cur.fetchone())

print()
print("=== tbl_progress_notes ===")
cur.execute("select count(*) from tbl_progress_notes")
print("row count:", cur.fetchone())
cur.execute("""
    select
      count(*) filter (where medical_plan is not null and medical_plan <> '') as medical_plan,
      count(*) filter (where monitoring_plan is not null and monitoring_plan <> '') as monitoring_plan,
      count(*) filter (where feeding_plan is not null and feeding_plan <> '') as feeding_plan,
      count(*) filter (where dressing_plan is not null and dressing_plan <> '') as dressing_plan,
      count(*) filter (where nursing_plan is not null and nursing_plan <> '') as nursing_plan,
      count(*) filter (where physio_plan is not null and physio_plan <> '') as physio_plan,
      count(*) filter (where current_medication_regime is not null and current_medication_regime <> '') as current_medication_regime,
      count(*) filter (where physical_examination is not null and physical_examination <> '') as physical_examination,
      count(*) filter (where past_med_condition is not null and past_med_condition <> '') as past_med_condition
    from tbl_progress_notes
""")
cols = [d[0] for d in cur.description]
print(dict(zip(cols, cur.fetchone())))

print()
print("sample rows with any plan filled:")
cur.execute("""
    select id, resident_id, entry_timestamp, medical_plan, monitoring_plan, feeding_plan, dressing_plan, nursing_plan, physio_plan
    from tbl_progress_notes
    where medical_plan is not null or monitoring_plan is not null or feeding_plan is not null
       or dressing_plan is not null or nursing_plan is not null or physio_plan is not null
    order by entry_timestamp desc
    limit 10
""")
for row in cur.fetchall():
    print(row)

print()
print("=== tbl_residents: fields relevant to the dashboard ===")
cur.execute("""
    select count(*) filter (where allergy is not null and allergy <> '') as allergy,
           count(*) filter (where past_medical_condition is not null and past_medical_condition <> '') as past_medical_condition,
           count(*) filter (where current_medication_list is not null and current_medication_list <> '') as current_medication_list
    from tbl_residents
""")
cols = [d[0] for d in cur.description]
print(dict(zip(cols, cur.fetchone())))

print()
print("=== any other vitals-shaped tables? ===")
cur.execute("""
    select table_name from information_schema.tables
    where table_schema = 'public' and (table_name ilike '%vital%' or table_name ilike '%dxt%' or table_name ilike '%chart%')
    order by table_name
""")
print(cur.fetchall())

conn.close()
