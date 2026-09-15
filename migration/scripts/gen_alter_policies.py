import os, re
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()

cur.execute(r"""
select tablename, policyname, cmd, qual, with_check
from pg_policies
where qual ~ 'auth_role\(\)' or with_check ~ 'auth_role\(\)'
order by tablename, policyname
""")
rows = cur.fetchall()
print(f"Matched {len(rows)} policies")

def fix(expr):
    if expr is None:
        return None
    e = expr
    e = e.replace("'ADMIN'::staff_role", "'ADMIN'::id_rights")
    e = e.replace("'MODERATOR'::staff_role", "'MODERATOR'::id_rights")
    e = re.sub(r",\s*'pharmacist'::staff_role", "", e)
    e = e.replace("'pharmacist'::staff_role, ", "")
    return e

statements = []
for tablename, policyname, cmd, qual, with_check in rows:
    new_qual = fix(qual)
    new_check = fix(with_check)
    parts = [f'alter policy "{policyname}" on {tablename}']
    if cmd in ('SELECT', 'DELETE', 'UPDATE', 'ALL') and new_qual is not None:
        parts.append(f'using {new_qual}')
    if cmd in ('INSERT', 'UPDATE', 'ALL') and new_check is not None:
        parts.append(f'with check {new_check}')
    stmt = " ".join(parts) + ";"
    statements.append(stmt)

with open("alter_policies.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(statements))
print(f"Generated {len(statements)} ALTER POLICY statements -> alter_policies.sql")
for s in statements[:6]:
    print(s)
conn.close()
