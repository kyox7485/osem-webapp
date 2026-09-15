import os
import re
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

CMD_MAP = {"ALL": "all", "SELECT": "select", "INSERT": "insert", "UPDATE": "update", "DELETE": "delete"}


def fix(expr):
    if expr is None:
        return None
    e = expr
    e = e.replace("'ADMIN'::staff_role", "'ADMIN'::id_rights")
    e = e.replace("'MODERATOR'::staff_role", "'MODERATOR'::id_rights")
    e = re.sub(r",\s*'pharmacist'::staff_role", "", e)
    e = e.replace("'pharmacist'::staff_role, ", "")
    return e


try:
    # 1. Capture full policy definitions BEFORE anything changes.
    cur.execute(r"""
        select tablename, policyname, cmd, qual, with_check
        from pg_policies
        where qual ~ 'auth_role\(\)' or with_check ~ 'auth_role\(\)'
        order by tablename, policyname
    """)
    policies = cur.fetchall()
    print(f"Captured {len(policies)} policies")

    # 2. Repoint tbl_user_accounts.rights to the new id_rights enum.
    cur.execute("""
        alter table tbl_user_accounts
        alter column rights type id_rights using (rights::text::id_rights);
    """)

    # 3. Drop auth_role() -- cascades to drop all 46 dependent policies too.
    cur.execute("drop function auth_role() cascade;")

    # 4. Recreate it returning id_rights.
    cur.execute("""
        create function auth_role() returns id_rights
        language sql stable security definer as $$
          select rights from tbl_user_accounts where auth_user_id = auth.uid();
        $$;
    """)

    # 5. Recreate every dropped policy, with staff_role literals swapped for id_rights.
    for tablename, policyname, cmd, qual, with_check in policies:
        new_qual = fix(qual)
        new_check = fix(with_check)
        cmd_kw = CMD_MAP[cmd]
        parts = [f'create policy "{policyname}" on {tablename} for {cmd_kw}']
        if new_qual is not None:
            parts.append(f"using {new_qual}")
        if new_check is not None:
            parts.append(f"with check {new_check}")
        stmt = " ".join(parts) + ";"
        cur.execute(stmt)
    print(f"Recreated {len(policies)} policies")

    # 6. Set osemnursing@gmail.com to STAFF rights as intended.
    cur.execute(
        "update tbl_user_accounts set rights = 'STAFF' where email = 'osemnursing@gmail.com' returning id, email, rights;"
    )
    print("osemnursing updated:", cur.fetchall())

    # 7. Restore tbl_staff.role's original job-title labels -- safe now,
    #    since tbl_user_accounts no longer uses staff_role at all.
    cur.execute("alter type staff_role rename value 'ADMIN' to 'admin';")
    cur.execute("alter type staff_role rename value 'MODERATOR' to 'management';")
    cur.execute("alter type staff_role rename value 'STAFF' to 'doctor';")

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
