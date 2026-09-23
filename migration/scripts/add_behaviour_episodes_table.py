import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

try:
    cur.execute("""
        create table if not exists tbl_behaviour_episodes (
          id          bigint generated always as identity primary key,
          chart_id    bigint not null references tbl_behaviour_charts (id) on delete cascade,
          branch_id   bigint not null references tbl_branches ("BranchID"),
          resident_id bigint not null references tbl_residents (id),
          category    text not null check (category in ('Verbal','Physical','Mood','Restraint')),
          behaviour   text not null,
          started_at  timestamptz not null,
          ended_at    timestamptz not null,
          note        text,
          created_at  timestamptz not null default now(),
          check (ended_at > started_at)
        );
    """)
    print("Created (or already had) tbl_behaviour_episodes")

    cur.execute("""
        create index if not exists idx_behaviour_episodes_resident_time
          on tbl_behaviour_episodes (resident_id, started_at);
    """)
    cur.execute("""
        create index if not exists idx_behaviour_episodes_chart
          on tbl_behaviour_episodes (chart_id);
    """)
    print("Created indexes")

    cur.execute("alter table tbl_behaviour_episodes enable row level security;")
    cur.execute("drop policy if exists branch_scope_tbl_behaviour_episodes on tbl_behaviour_episodes;")
    cur.execute("""
        create policy branch_scope_tbl_behaviour_episodes on tbl_behaviour_episodes
          using (auth_role() in ('ADMIN','MODERATOR') or branch_id = auth_branch_id())
          with check (auth_role() in ('ADMIN','MODERATOR') or branch_id = auth_branch_id());
    """)
    print("RLS enabled: branch-scoped")

    conn.commit()
    print("Done.")
except Exception as e:
    conn.rollback()
    print(f"Error: {e}")
    raise
finally:
    cur.close()
    conn.close()
