import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

NEW_TREATMENT_TYPES = [
    "Assessment", "Basic Physio", "Full Physio (1hr)", "Full Physio (30m)",
    "SilverFit (Group)", "SilverFit (Individual)", "Patient Refused", "Patient Not Available",
    "Neuro Rehabilitation", "Sport Rehabilitation", "Shoulder Rehabilitation", "Back Pain",
    "Pain Management", "Chest Physio", "Housecall", "Other Physio (1hr)", "Other Physio (30m)",
]

try:
    # Old data (if any) used the placeholder set ('Basic','Full','Assessment',
    # 'Housecall','Neuro','Backpain') -- confirm there's nothing that would
    # violate the new check before swapping it.
    cur.execute("select count(*) from physio_assessments")
    (count,) = cur.fetchone()
    print(f"physio_assessments has {count} row(s)")

    cur.execute("alter table physio_assessments add column if not exists care_setting text;")
    cur.execute("update physio_assessments set care_setting = 'IP' where care_setting is null;")
    cur.execute("alter table physio_assessments alter column care_setting set not null;")
    cur.execute("alter table physio_assessments alter column care_setting set default 'IP';")
    cur.execute("alter table physio_assessments drop constraint if exists physio_assessments_care_setting_check;")
    cur.execute("alter table physio_assessments add constraint physio_assessments_care_setting_check check (care_setting in ('IP','OP'));")
    print("Added/backfilled care_setting")

    cur.execute("alter table physio_assessments drop constraint if exists physio_assessments_treatment_type_check;")
    print("Dropped old treatment_type check constraint")

    # Existing test rows used the old placeholder set -- map to the closest
    # real label before the new, stricter constraint goes on.
    cur.execute("update physio_assessments set treatment_type = 'Full Physio (1hr)' where treatment_type = 'Full';")
    print("Remapped legacy 'Full' rows:", cur.rowcount)

    values_sql = ",".join(f"'{v}'" for v in NEW_TREATMENT_TYPES)
    cur.execute(f"alter table physio_assessments add constraint physio_assessments_treatment_type_check check (treatment_type in ({values_sql}));")
    print("Replaced treatment_type check constraint with full IP/OP reference list")

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
