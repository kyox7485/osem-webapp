import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

VITALS_COLUMNS_TO_DROP = [
    "systolic_bp", "diastolic_bp", "heart_rate", "temperature",
    "spo2", "spo2_condition", "dxt", "dxt_remark", "insulin_adjustment",
]

try:
    cur.execute("select count(*) from tbl_nursing_chart_entries")
    (count,) = cur.fetchone()
    if count != 0:
        raise RuntimeError(f"Refusing to proceed, tbl_nursing_chart_entries has {count} rows -- not empty")
    print("Pre-check OK: tbl_nursing_chart_entries is empty")

    cur.execute("""
        create table tbl_vital (
          id                  bigint generated always as identity primary key,
          branch_id           bigint not null references tbl_branches ("BranchID"),
          resident_id         bigint not null references tbl_residents (id),
          entry_timestamp     timestamptz not null default now(),
          systolic_bp         numeric,
          diastolic_bp        numeric,
          heart_rate          numeric,
          temperature         numeric,
          spo2                numeric,
          spo2_condition      text check (spo2_condition in (
                                'under RA','under 1LPM O2','under 2LPM O2','under 3LPM O2','under 4LPM O2',
                                'under 5LPM O2','under 6LPM O2','under 7LPM O2','under 8LPM O2',
                                'under 9LPM O2','under 10LPM O2')),
          dxt                 numeric,
          dxt_remark          text check (dxt_remark in ('Fasting','Post-Meal 1hr','Post-Meal 2hr','Post-Meal >4hr')),
          insulin_adjustment  text,
          reviewed_by         text references tbl_staff ("StaffID"),
          created_at          timestamptz not null default now()
        );
    """)
    cur.execute('create index idx_vital_resident on tbl_vital (resident_id, entry_timestamp desc);')
    cur.execute('create index idx_vital_branch on tbl_vital (branch_id, entry_timestamp desc);')
    print("Created tbl_vital")

    # RLS: same single-branch scoping as every other clinical table.
    cur.execute("alter table tbl_vital enable row level security;")
    cur.execute("""
        create policy branch_scope_tbl_vital on tbl_vital
        using (
          auth_role() in ('ADMIN','MODERATOR')
          or branch_id = auth_branch_id()
        )
        with check (
          auth_role() in ('ADMIN','MODERATOR')
          or branch_id = auth_branch_id()
        );
    """)
    print("RLS enabled on tbl_vital")

    # Generic audit trigger, same as the other clinical entry tables.
    cur.execute("""
        create trigger trg_audit_tbl_vital after insert or update or delete on tbl_vital
        for each row execute function fn_audit_trigger();
    """)
    print("Audit trigger attached to tbl_vital")

    # Drop the now-duplicated vitals columns from tbl_nursing_chart_entries.
    for col in VITALS_COLUMNS_TO_DROP:
        cur.execute(f"alter table tbl_nursing_chart_entries drop column {col};")
    print(f"Dropped {len(VITALS_COLUMNS_TO_DROP)} columns from tbl_nursing_chart_entries")

    cur.execute("select column_name from information_schema.columns where table_name = 'tbl_nursing_chart_entries' order by ordinal_position")
    print("tbl_nursing_chart_entries columns now:", [r[0] for r in cur.fetchall()])
    cur.execute("select column_name from information_schema.columns where table_name = 'tbl_vital' order by ordinal_position")
    print("tbl_vital columns:", [r[0] for r in cur.fetchall()])

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
