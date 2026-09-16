import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

CHILD_TABLES = [
    "physio_examinations",
    "physio_body_chart_findings",
    "physio_functional_assessments",
    "physio_balance_assessments",
    "physio_coordination_assessments",
]
ALL_TABLES = ["physio_assessments"] + CHILD_TABLES

try:
    cur.execute("""
        create table physio_assessments (
          id                   bigint generated always as identity primary key,
          branch_id            bigint not null references tbl_branches ("BranchID"),
          resident_id          bigint not null references tbl_residents (id),
          entry_timestamp      timestamptz not null default now(),
          treatment_type       text check (treatment_type in ('Basic','Full','Assessment','Housecall','Neuro','Backpain')),
          credit_hours         numeric,
          chief_complaint      text,
          current_history      text,
          past_medical_history text,
          social_history       text,
          impression           text,
          plan_intervention    text,
          evaluation           text,
          treatment_compliance text check (treatment_compliance in ('100%','75%','50%','25%')),
          total_score          numeric,
          documented_by        text not null references tbl_staff ("StaffID"),
          created_at           timestamptz not null default now()
        );
    """)
    cur.execute("create index idx_physio_assess_resident on physio_assessments (resident_id, entry_timestamp desc);")
    cur.execute("create index idx_physio_assess_branch on physio_assessments (branch_id, entry_timestamp desc);")
    print("Created physio_assessments")

    cur.execute("""
        create table physio_examinations (
          id             bigint generated always as identity primary key,
          branch_id      bigint not null references tbl_branches ("BranchID"),
          assessment_id  bigint not null references physio_assessments (id) on delete cascade,
          limb           text not null check (limb in ('lower','upper')),
          region         text not null,
          movement       text not null,
          side           text not null check (side in ('R','L')),
          power          int check (power between 0 and 5),
          tone           int check (tone between 0 and 4),
          rom            int check (rom between 0 and 4),
          reflexes       int check (reflexes between 0 and 4),
          created_at     timestamptz not null default now(),
          unique (assessment_id, limb, region, movement, side)
        );
    """)
    cur.execute("create index idx_physio_exam_assessment on physio_examinations (assessment_id);")
    print("Created physio_examinations")

    cur.execute("""
        create table physio_body_chart_findings (
          id             bigint generated always as identity primary key,
          branch_id      bigint not null references tbl_branches ("BranchID"),
          assessment_id  bigint not null references physio_assessments (id) on delete cascade,
          region         text not null,
          side           text check (side in ('R','L')),
          comment        text not null,
          created_at     timestamptz not null default now()
        );
    """)
    cur.execute("create index idx_physio_body_chart_assessment on physio_body_chart_findings (assessment_id);")
    print("Created physio_body_chart_findings")

    cur.execute("""
        create table physio_functional_assessments (
          id                    bigint generated always as identity primary key,
          branch_id             bigint not null references tbl_branches ("BranchID"),
          assessment_id         bigint not null unique references physio_assessments (id) on delete cascade,
          supine_to_side_lying  int check (supine_to_side_lying between 0 and 4),
          side_lying_to_sitting int check (side_lying_to_sitting between 0 and 4),
          sitting_to_standing   int check (sitting_to_standing between 0 and 4),
          sit_at_edge_of_bed    int check (sit_at_edge_of_bed between 0 and 4),
          ambulation            int check (ambulation between 0 and 4)
        );
    """)
    print("Created physio_functional_assessments")

    cur.execute("""
        create table physio_balance_assessments (
          id               bigint generated always as identity primary key,
          branch_id        bigint not null references tbl_branches ("BranchID"),
          assessment_id    bigint not null unique references physio_assessments (id) on delete cascade,
          sitting_static   int check (sitting_static between 0 and 3),
          sitting_dynamic  int check (sitting_dynamic between 0 and 3),
          standing_static  int check (standing_static between 0 and 3),
          standing_dynamic int check (standing_dynamic between 0 and 3)
        );
    """)
    print("Created physio_balance_assessments")

    cur.execute("""
        create table physio_coordination_assessments (
          id                bigint generated always as identity primary key,
          branch_id         bigint not null references tbl_branches ("BranchID"),
          assessment_id     bigint not null unique references physio_assessments (id) on delete cascade,
          upper_limb_right  int check (upper_limb_right between 0 and 4),
          upper_limb_left   int check (upper_limb_left between 0 and 4),
          lower_limb_right  int check (lower_limb_right between 0 and 4),
          lower_limb_left   int check (lower_limb_left between 0 and 4)
        );
    """)
    print("Created physio_coordination_assessments")

    # Same "auto-fill branch_id from parent" pattern as fn_fill_chart_meal_branch.
    cur.execute("""
        create or replace function fn_fill_physio_child_branch() returns trigger
        language plpgsql as $$
        begin
          if new.branch_id is null then
            select branch_id into new.branch_id from physio_assessments where id = new.assessment_id;
          end if;
          return new;
        end;
        $$;
    """)
    for t in CHILD_TABLES:
        cur.execute(f"""
            create trigger trg_fill_{t}_branch
            before insert on {t}
            for each row execute function fn_fill_physio_child_branch();
        """)
    print("Created fn_fill_physio_child_branch and attached to all child tables")

    # RLS: same single-branch scoping as every other clinical table.
    for t in ALL_TABLES:
        cur.execute(f"alter table {t} enable row level security;")
        cur.execute(f"""
            create policy branch_scope_{t} on {t}
            using (
              auth_role() in ('ADMIN','MODERATOR')
              or branch_id = auth_branch_id()
            )
            with check (
              auth_role() in ('ADMIN','MODERATOR')
              or branch_id = auth_branch_id()
            );
        """)
    print("RLS enabled on all 6 physio tables")

    # Generic audit trigger, same as every other clinical entry table.
    for t in ALL_TABLES:
        cur.execute(f"""
            create trigger trg_audit_{t} after insert or update or delete on {t}
            for each row execute function fn_audit_trigger();
        """)
    print("Audit trigger attached to all 6 physio tables")

    for t in ALL_TABLES:
        cur.execute(
            "select column_name from information_schema.columns where table_name = %s order by ordinal_position",
            (t,),
        )
        print(f"{t} columns:", [r[0] for r in cur.fetchall()])

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
