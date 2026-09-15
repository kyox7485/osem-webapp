import os
from dotenv import load_dotenv
import requests

load_dotenv(r"C:\Users\NGF\dev\osem-webapp\webapp\.env.local")
url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

resp = requests.post(
    f"{url}/auth/v1/recover",
    headers={"apikey": service_key, "Content-Type": "application/json"},
    json={"email": "osemnursing@gmail.com"},
)
print(resp.status_code, resp.text)
