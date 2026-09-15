import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

try:
    cur.execute("select count(*) from tbl_progress_notes")
    (count,) = cur.fetchone()
    if count != 0:
        raise RuntimeError(f"Refusing to proceed, tbl_progress_notes has {count} rows -- not empty")
    print("Pre-check OK: tbl_progress_notes is empty")

    # v_latest_progress_note selects these columns -- drop and recreate
    # without them (CREATE OR REPLACE VIEW can't change the column list).
    cur.execute("drop view v_latest_progress_note;")

    cur.execute("alter table tbl_progress_notes drop column past_med_condition;")
    cur.execute("alter table tbl_progress_notes drop column current_medication_regime;")
    cur.execute("alter table tbl_progress_notes drop column tca_notes;")

    cur.execute("""
        create view v_latest_progress_note as
        SELECT DISTINCT ON (resident_id) id, branch_id, resident_id, entry_timestamp,
            progress_note, physical_examination, medical_plan,
            monitoring_plan, feeding_plan, dressing_plan, nursing_plan, physio_plan,
            reviewed_by, created_by, created_at
        FROM tbl_progress_notes
        ORDER BY resident_id, entry_timestamp DESC;
    """)

    cur.execute("select column_name from information_schema.columns where table_name = 'tbl_progress_notes' order by ordinal_position")
    print("tbl_progress_notes columns now:", [r[0] for r in cur.fetchall()])

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
