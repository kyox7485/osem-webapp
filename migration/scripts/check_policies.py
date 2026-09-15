import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("""
select schemaname, tablename, policyname, qual, with_check
from pg_policies
where qual ilike '%auth_role%' or with_check ilike '%auth_role%'
order by tablename, policyname
""")
for row in cur.fetchall():
    print(row)
conn.close()
