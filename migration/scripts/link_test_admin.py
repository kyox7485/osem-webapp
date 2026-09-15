import os, json
from dotenv import load_dotenv
load_dotenv()
import psycopg2
with open("new_auth_user.json") as f:
    data = json.load(f)
conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("update tbl_staff set auth_user_id = %s where id = 2", (data["user_id"],))
conn.commit()
print("linked. password:", data["password"])
conn.close()
