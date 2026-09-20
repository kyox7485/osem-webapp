import os, json
from dotenv import load_dotenv
import requests

load_dotenv(r"C:\Users\NGF\dev\osem-webapp\webapp\.env.local")
url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

with open("new_auth_user.json") as f:
    data = json.load(f)

resp = requests.put(
    f"{url}/auth/v1/admin/users/{data['user_id']}",
    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    json={"password": "harbor-lantern-92-fix"},
)
print(resp.status_code, "OK" if resp.status_code < 300 else resp.text)
