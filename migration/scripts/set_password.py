import os, json
from dotenv import load_dotenv
import requests

load_dotenv(r"C:\Users\NGF\dev\osem-webapp\webapp\.env.local")
url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

with open("new_auth_user.json") as f:
    user_id = json.load(f)["user_id"]

new_password = "harbor-lantern-92-fix"

resp = requests.put(
    f"{url}/auth/v1/admin/users/{user_id}",
    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    json={"password": new_password},
)
print(resp.status_code)
print("OK" if resp.status_code < 300 else resp.text)
