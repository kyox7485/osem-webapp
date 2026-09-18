import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

# Pressure-injury / wound documentation sites (Braden/Norton-scale bony
# prominences plus general catch-alls). Sort order roughly follows a
# head-to-toe exam pass. "Other" is last and always has id available for the
# free-text fallback path when a wound is somewhere not on the diagram.
SEED_BODY_PARTS = [
    ("Back of Head", 0),
    ("Right Ear", 1),
    ("Left Ear", 2),
    ("Right Shoulder Blade", 3),
    ("Left Shoulder Blade", 4),
    ("Spine / Upper Back", 5),
    ("Right Elbow", 6),
    ("Left Elbow", 7),
    ("Sacrum", 8),
    ("Coccyx", 9),
    ("Right Hip", 10),
    ("Left Hip", 11),
    ("Right Ischial Tuberosity", 12),
    ("Left Ischial Tuberosity", 13),
    ("Right Buttock", 14),
    ("Left Buttock", 15),
    ("Right Knee", 16),
    ("Left Knee", 17),
    ("Right Ankle", 18),
    ("Left Ankle", 19),
    ("Right Heel", 20),
    ("Left Heel", 21),
    ("Abdomen", 22),
    ("Chest", 23),
    ("Groin", 24),
    ("Other", 25),
]

try:
    cur.execute("""
        create table if not exists tbl_wound_body_parts (
          id          bigint generated always as identity primary key,
          label       text not null unique,
          sort_order  int not null default 0,
          active      boolean not null default true,
          created_at  timestamptz not null default now()
        );
    """)
    print("Created (or already had) tbl_wound_body_parts")

    cur.execute("""
        create table if not exists tbl_wound_sessions (
          id                  bigint generated always as identity primary key,
          resident_id         bigint not null references tbl_residents (id),
          branch_id           bigint not null references tbl_branches ("BranchID"),
          uploaded_by         text references tbl_staff ("StaffID"),
          session_started_at  timestamptz not null default now(),
          completed_at        timestamptz,
          created_at          timestamptz not null default now()
        );
    """)
    print("Created (or already had) tbl_wound_sessions")

    cur.execute("create index if not exists idx_wound_sessions_resident on tbl_wound_sessions (resident_id, session_started_at desc);")
    cur.execute("create index if not exists idx_wound_sessions_branch on tbl_wound_sessions (branch_id);")

    cur.execute("""
        create table if not exists tbl_wound_photos (
          id                bigint generated always as identity primary key,
          session_id        bigint not null references tbl_wound_sessions (id) on delete cascade,
          resident_id       bigint not null,
          branch_id         bigint not null,
          body_part_id      bigint references tbl_wound_body_parts (id),
          -- Frozen label as picked at save time. Deliberately NOT re-derived
          -- from body_part_id on read: this is a permanent clinical record,
          -- so it must keep showing what was true the day it was
          -- documented, even if the lookup label is later renamed --
          -- the opposite concern from a form's live default value.
          body_part_label   text not null,
          description       text,
          drive_file_id     text not null,
          drive_folder_id   text not null,
          file_name         text not null,
          mime_type         text not null default 'image/jpeg',
          file_size_bytes   bigint,
          uploaded_by       text references tbl_staff ("StaffID"),
          uploaded_at       timestamptz not null default now()
        );
    """)
    print("Created (or already had) tbl_wound_photos")

    cur.execute("create index if not exists idx_wound_photos_session on tbl_wound_photos (session_id);")
    cur.execute("create index if not exists idx_wound_photos_resident on tbl_wound_photos (resident_id, uploaded_at desc);")
    cur.execute("create index if not exists idx_wound_photos_branch on tbl_wound_photos (branch_id);")

    # Same "auto-fill branch_id/resident_id from the parent" pattern as
    # fn_fill_physio_child_branch.
    cur.execute("""
        create or replace function fn_fill_wound_photo_parent() returns trigger
        language plpgsql as $$
        begin
          if new.branch_id is null or new.resident_id is null then
            select branch_id, resident_id into new.branch_id, new.resident_id
            from tbl_wound_sessions where id = new.session_id;
          end if;
          return new;
        end;
        $$;
    """)
    cur.execute("drop trigger if exists trg_fill_wound_photo_parent on tbl_wound_photos;")
    cur.execute("""
        create trigger trg_fill_wound_photo_parent
        before insert on tbl_wound_photos
        for each row execute function fn_fill_wound_photo_parent();
    """)
    print("Created branch_id/resident_id auto-fill trigger on tbl_wound_photos")

    # RLS: body parts lookup is a shared catalog (read-all, write admin/moderator).
    cur.execute("alter table tbl_wound_body_parts enable row level security;")
    cur.execute("drop policy if exists wound_body_parts_read on tbl_wound_body_parts;")
    cur.execute("create policy wound_body_parts_read on tbl_wound_body_parts for select using (auth.role() = 'authenticated');")
    cur.execute("drop policy if exists wound_body_parts_write on tbl_wound_body_parts;")
    cur.execute("""
        create policy wound_body_parts_write on tbl_wound_body_parts
          for all using (auth_role() in ('ADMIN','MODERATOR')) with check (auth_role() in ('ADMIN','MODERATOR'));
    """)

    # RLS: sessions/photos are standard single-branch-scoped clinical tables,
    # same pattern as physio_assessments etc.
    for t in ("tbl_wound_sessions", "tbl_wound_photos"):
        cur.execute(f"alter table {t} enable row level security;")
        cur.execute(f"drop policy if exists branch_scope_{t} on {t};")
        cur.execute(f"""
            create policy branch_scope_{t} on {t}
              using (auth_role() in ('ADMIN','MODERATOR') or branch_id = auth_branch_id())
              with check (auth_role() in ('ADMIN','MODERATOR') or branch_id = auth_branch_id());
        """)
    print("RLS enabled: body parts read-all/write-admin-moderator, sessions/photos branch-scoped")

    for label, sort_order in SEED_BODY_PARTS:
        cur.execute(
            "insert into tbl_wound_body_parts (label, sort_order) values (%s, %s) on conflict (label) do nothing;",
            (label, sort_order),
        )
    print(f"Seeded {len(SEED_BODY_PARTS)} body part rows (skipping any that already exist)")

    cur.execute("select count(*) from tbl_wound_body_parts;")
    (count,) = cur.fetchone()
    print(f"tbl_wound_body_parts now has {count} row(s)")

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
