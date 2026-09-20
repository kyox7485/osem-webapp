import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()
try:
    cur.execute("""
        insert into tbl_vital (branch_id, resident_id, systolic_bp, diastolic_bp, heart_rate, temperature, spo2, spo2_condition, reviewed_by)
        values (1, 129, 120, 80, 72, 36.8, 98, 'under RA', 'AMN-1')
        returning id;
    """)
    print("Inserted:", cur.fetchone())
    conn.commit()
    print("COMMITTED OK (left in place for browser check)")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
