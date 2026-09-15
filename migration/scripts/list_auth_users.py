import os, json
from dotenv import load_dotenv
import requests

load_dotenv(r"C:\Users\NGF\dev\osem-webapp\webapp\.env.local")
url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

resp = requests.get(
    f"{url}/auth/v1/admin/users",
    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    params={"per_page": 200},
)
users = resp.json().get("users", [])
for u in users:
    print(u["id"], u["email"])
