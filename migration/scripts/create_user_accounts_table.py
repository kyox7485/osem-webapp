import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

cur.execute("""
create table tbl_user_accounts (
  id            bigint generated always as identity primary key,
  auth_user_id  uuid not null unique references auth.users (id) on delete cascade,
  email         text not null,
  username      text not null,
  branch_id     bigint not null references tbl_branches (id),
  rights        staff_role not null,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  staff_id      bigint references tbl_staff (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
""")
cur.execute("create index idx_user_accounts_branch on tbl_user_accounts (branch_id);")

cur.execute("""
insert into tbl_user_accounts (auth_user_id, email, username, branch_id, rights, status, staff_id)
select s.auth_user_id, u.email, s.staff_name, s.branch_id, s.role, 'ACTIVE', s.id
from tbl_staff s
join auth.users u on u.id = s.auth_user_id
where s.auth_user_id is not null
returning id, email, username, rights;
""")
print("migrated accounts:", cur.fetchall())

cur.execute("drop index if exists idx_staff_auth_user;")
cur.execute("alter table tbl_staff drop column auth_user_id;")
cur.execute("drop function if exists auth_staff_id();")

cur.execute("""
create or replace function auth_account_id() returns bigint
language sql stable security definer as $$
  select id from tbl_user_accounts where auth_user_id = auth.uid();
$$;
""")
cur.execute("""
create or replace function auth_branch_id() returns bigint
language sql stable security definer as $$
  select branch_id from tbl_user_accounts where auth_user_id = auth.uid();
$$;
""")
cur.execute("""
create or replace function auth_role() returns staff_role
language sql stable security definer as $$
  select rights from tbl_user_accounts where auth_user_id = auth.uid();
$$;
""")

cur.execute("alter table tbl_user_accounts enable row level security;")
cur.execute("""
create policy user_accounts_read on tbl_user_accounts for select
  using (auth_user_id = auth.uid() or auth_role() = 'admin');
""")
cur.execute("""
create policy user_accounts_write on tbl_user_accounts for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
""")

conn.commit()
print("OK - committed")
conn.close()
