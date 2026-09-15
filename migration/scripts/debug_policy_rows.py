import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("""
select tablename, policyname, cmd, qual, with_check
from pg_policies
where qual ~ 'auth_role\(\)' or with_check ~ 'auth_role\(\)'
order by tablename, policyname
limit 3
""")
for row in cur.fetchall():
    print(repr(row))
conn.close()
