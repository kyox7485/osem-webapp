import os
from dotenv import load_dotenv
load_dotenv()
load_dotenv(r"C:\Users\NGF\dev\osem-webapp\webapp\.env.local")
import psycopg2
import requests

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
cur = conn.cursor()
cur.execute("select auth_user_id from tbl_user_accounts where email = 'osemnursing@gmail.com'")
(user_id,) = cur.fetchone()
conn.close()

url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
new_password = "nursing-test-pw-92"

resp = requests.put(
    f"{url}/auth/v1/admin/users/{user_id}",
    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    json={"password": new_password},
)
print(resp.status_code)
print("OK" if resp.status_code < 300 else resp.text)
