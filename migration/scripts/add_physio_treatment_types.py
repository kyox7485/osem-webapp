import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

# (dept, treatment_type, credit_hours, sort_order) -- the exact values that
# were previously hardcoded as PHYSIO_TREATMENT_TYPES in
# webapp/src/lib/physio-scoring.ts. Moving them here lets credit-hour
# bindings be edited directly in Supabase instead of via a code change.
SEED_ROWS = [
    ("IP", "Assessment", 0, 0),
    ("IP", "Basic Physio", 0.25, 1),
    ("IP", "Full Physio (1hr)", 1, 2),
    ("IP", "Full Physio (30m)", 0.5, 3),
    ("IP", "SilverFit (Group)", 0.25, 4),
    ("IP", "SilverFit (Individual)", 1, 5),
    ("IP", "Patient Refused", 0, 6),
    ("IP", "Patient Not Available", 0, 7),
    ("OP", "Neuro Rehabilitation", 1, 0),
    ("OP", "Sport Rehabilitation", 1, 1),
    ("OP", "Shoulder Rehabilitation", 1, 2),
    ("OP", "Back Pain", 1, 3),
    ("OP", "Pain Management", 1, 4),
    ("OP", "Chest Physio", 1, 5),
    ("OP", "SilverFit (Individual)", 1, 6),
    ("OP", "SilverFit (Group)", 0.25, 7),
    ("OP", "Housecall", 1, 8),
    ("OP", "Other Physio (1hr)", 1, 9),
    ("OP", "Other Physio (30m)", 0.5, 10),
]

try:
    cur.execute("""
        create table if not exists tbl_physio_treatment_types (
          id            bigint generated always as identity primary key,
          dept          text not null check (dept in ('IP','OP')),
          treatment_type text not null,
          credit_hours  numeric not null default 0,
          sort_order    int not null default 0,
          created_at    timestamptz not null default now(),
          updated_at    timestamptz not null default now(),
          unique (dept, treatment_type)
        );
    """)
    print("Created (or already had) tbl_physio_treatment_types")

    cur.execute("""
        create index if not exists idx_physio_treatment_types_dept
          on tbl_physio_treatment_types (dept, sort_order);
    """)

    cur.execute("alter table tbl_physio_treatment_types enable row level security;")

    cur.execute("drop policy if exists physio_treatment_types_read on tbl_physio_treatment_types;")
    cur.execute("""
        create policy physio_treatment_types_read on tbl_physio_treatment_types
          for select using (auth.role() = 'authenticated');
    """)

    cur.execute("drop policy if exists physio_treatment_types_write on tbl_physio_treatment_types;")
    cur.execute("""
        create policy physio_treatment_types_write on tbl_physio_treatment_types
          for all
          using (auth_role() in ('ADMIN','MODERATOR'))
          with check (auth_role() in ('ADMIN','MODERATOR'));
    """)
    print("RLS enabled: read for any authenticated user, write for ADMIN/MODERATOR")

    for dept, treatment_type, credit_hours, sort_order in SEED_ROWS:
        cur.execute(
            """
            insert into tbl_physio_treatment_types (dept, treatment_type, credit_hours, sort_order)
            values (%s, %s, %s, %s)
            on conflict (dept, treatment_type) do nothing;
            """,
            (dept, treatment_type, credit_hours, sort_order),
        )
    print(f"Seeded {len(SEED_ROWS)} treatment type rows (skipping any that already exist)")

    cur.execute("select count(*) from tbl_physio_treatment_types;")
    (count,) = cur.fetchone()
    print(f"tbl_physio_treatment_types now has {count} row(s)")

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
