import os, json, secrets, string
import requests
from dotenv import load_dotenv

load_dotenv(r"C:\Users\NGF\dev\osem-webapp\webapp\.env.local")

url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

alphabet = string.ascii_letters + string.digits
temp_password = "".join(secrets.choice(alphabet) for _ in range(16))

resp = requests.post(
    f"{url}/auth/v1/admin/users",
    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    json={"email": "chaos7485@gmail.com", "password": temp_password, "email_confirm": True},
)
print(resp.status_code)
print(resp.text)
if resp.status_code < 300:
    user_id = resp.json()["id"]
    with open("new_auth_user.json", "w") as f:
        json.dump({"user_id": user_id, "password": temp_password}, f)
