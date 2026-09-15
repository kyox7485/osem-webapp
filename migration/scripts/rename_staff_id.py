import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

# All 16 FK columns across the schema that reference tbl_staff(id).
# Confirmed via check_staff_fk_impact.py that only tbl_residents.reviewed_by
# carries live data (144/145 rows) -- the rest are empty tables, so their
# column can just be retyped with no data to migrate.
FK_COLUMNS = [
    ("tbl_charging_summary", "registered_by"),
    ("tbl_fall_incidents", "reported_by"),
    ("tbl_hospital_referrals", "reviewed_by"),
    ("tbl_nursing_chart_entries", "created_by"),
    ("tbl_nursing_chart_entries", "reviewed_by"),
    ("tbl_physio_op_patients", "reviewed_by"),
    ("tbl_physio_progress_notes", "therapist_id"),
    ("tbl_products", "registered_by"),
    ("tbl_progress_notes", "created_by"),
    ("tbl_progress_notes", "reviewed_by"),
    ("tbl_residents", "reviewed_by"),  # the only one with live data
    ("tbl_stock_movements", "registered_by"),
    ("tbl_stock_request_details", "ordered_by"),
    ("tbl_stock_requests", "requested_by"),
    ("tbl_stock_transfers", "confirmed_by"),
    ("tbl_stock_transfers", "dispatched_by"),
]

VIEW_DEFS = {
    "v_latest_progress_note": """
        SELECT DISTINCT ON (resident_id) id, branch_id, resident_id, entry_timestamp,
            past_med_condition, progress_note, physical_examination, medical_plan,
            monitoring_plan, feeding_plan, dressing_plan, nursing_plan, physio_plan,
            current_medication_regime, tca_notes, reviewed_by, created_by, created_at
        FROM tbl_progress_notes
        ORDER BY resident_id, entry_timestamp DESC;
    """,
    "v_pending_transfers": """
        SELECT id, from_branch_id, to_branch_id, product_id, quantity,
            from_storage_location_id, to_storage_location_id, status,
            dispatched_by, dispatched_at, confirmed_by, confirmed_at, notes, created_at
        FROM tbl_stock_transfers
        WHERE status = 'in_transit'::stock_transfer_status;
    """,
}

try:
    # 0. Drop views that depend on columns we're about to retype (bigint ->
    #    text) -- Postgres refuses ALTER COLUMN TYPE otherwise. Recreated
    #    verbatim at the end, from pg_get_viewdef captured beforehand.
    for view in VIEW_DEFS:
        cur.execute(f'drop view if exists {view};')

    # 1. Per-branch running counter, used by the insert trigger below.
    cur.execute('alter table tbl_branches add column if not exists staff_seq bigint not null default 0;')

    # 2. New PK column, backfilled as "<BranchCode>-<running number within branch>"
    #    ordered by the existing bigint id (i.e. creation order).
    cur.execute('alter table tbl_staff add column "StaffID" text;')
    cur.execute("""
        with numbered as (
          select id, branch_id, row_number() over (partition by branch_id order by id) as rn
          from tbl_staff
        )
        update tbl_staff s
        set "StaffID" = b."BranchCode" || '-' || n.rn
        from numbered n
        join tbl_branches b on b."BranchID" = n.branch_id
        where s.id = n.id;
    """)
    cur.execute("""
        update tbl_branches b
        set staff_seq = coalesce((select count(*) from tbl_staff s where s.branch_id = b."BranchID"), 0);
    """)
    cur.execute('alter table tbl_staff alter column "StaffID" set not null;')
    cur.execute('alter table tbl_staff add constraint tbl_staff_staffid_unique unique ("StaffID");')

    cur.execute('select id, "StaffID" from tbl_staff order by id limit 5')
    print("Sample StaffID backfill:", cur.fetchall())

    # 3. Retype every FK column from bigint -> text, preserving data where it
    #    exists (tbl_residents.reviewed_by), trivial elsewhere (all null).
    for table, col in FK_COLUMNS:
        # there may be more than one FK from this table to tbl_staff (e.g. tbl_stock_transfers) -- filter by column
        cur.execute("""
            select con.conname
            from pg_constraint con
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
            where con.conrelid = %s::regclass and con.confrelid = 'tbl_staff'::regclass and a.attname = %s
        """, (table, col))
        (conname,) = cur.fetchone()
        cur.execute(f'alter table {table} drop constraint "{conname}";')
        if table == "tbl_residents" and col == "reviewed_by":
            # The one column with live data -- ALTER ... TYPE USING can't
            # contain a subquery, so go via a temp column + UPDATE instead.
            cur.execute(f'alter table {table} add column {col}_new text;')
            cur.execute(f"""
                update {table} t set {col}_new = s."StaffID"
                from tbl_staff s where s.id = t.{col};
            """)
            cur.execute(f'alter table {table} drop column {col};')
            cur.execute(f'alter table {table} rename column {col}_new to {col};')
        else:
            # No data (all null) -- trivial retype.
            cur.execute(f'alter table {table} alter column {col} type text using {col}::text;')
        print(f"Retyped {table}.{col} (dropped {conname})")

    # 4. Drop the old bigint PK, promote StaffID to the real PK.
    cur.execute('alter table tbl_staff drop constraint tbl_staff_pkey;')
    cur.execute('alter table tbl_staff drop column id;')
    cur.execute('alter table tbl_staff drop constraint tbl_staff_staffid_unique;')
    cur.execute('alter table tbl_staff add constraint tbl_staff_pkey primary key ("StaffID");')

    # 5. Recreate all 16 FK constraints against the new PK.
    for table, col in FK_COLUMNS:
        cur.execute(f'''
            alter table {table}
            add constraint {table}_{col}_fkey foreign key ({col}) references tbl_staff ("StaffID");
        ''')
    print(f"Recreated {len(FK_COLUMNS)} FK constraints")

    # 6. Auto-generate StaffID on insert going forward: "<BranchCode>-<next
    #    running number for that branch>", atomically via the counter added
    #    in step 1 (UPDATE ... RETURNING row-locks the branch row).
    cur.execute("""
        create or replace function fn_generate_staff_id() returns trigger
        language plpgsql as $$
        declare
          v_code text;
          v_next bigint;
        begin
          if new."StaffID" is not null then
            return new;
          end if;
          update tbl_branches set staff_seq = staff_seq + 1
            where "BranchID" = new.branch_id
            returning staff_seq, "BranchCode" into v_next, v_code;
          new."StaffID" := v_code || '-' || v_next;
          return new;
        end;
        $$;
    """)
    cur.execute("""
        create trigger trg_generate_staff_id
        before insert on tbl_staff
        for each row execute function fn_generate_staff_id();
    """)

    # 7. Recreate the views dropped in step 0, unchanged.
    for view, definition in VIEW_DEFS.items():
        cur.execute(f'create view {view} as {definition}')
    print(f"Recreated {len(VIEW_DEFS)} views")

    cur.execute('select "StaffID", staff_name from tbl_staff order by "StaffID" limit 5')
    print("Final sample:", cur.fetchall())
    cur.execute('select count(*) from tbl_residents where reviewed_by is not null')
    print("tbl_residents.reviewed_by non-null count (should still be 144):", cur.fetchone())

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
