"""
Remove the data created by seed_demo_medication.py.

Orders are discontinued Sheet-first (setOrderStatus), exactly like the UI's
Discontinue button -- never a direct write to tbl_medication_orders. Stock rows
are deleted from the Sheet + Supabase: the Apps Script project has no
"deleteStockEntry" route, so those rows are removed directly, and the Sheet tab
is left with its history (the 24h reconciliation trigger would otherwise
re-insert them into Supabase).

Run:  python migration/scripts/seed_demo_medication_cleanup.py
Requires: _seed_log.json from the seed run.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
import psycopg2  # noqa: E402

SCRIPT_URL = os.environ.get(
    "MEDICATION_ORDER_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbx7o8az8IZok4H-C1fVQaT727ihgmQFeqimL0eic_"
    "ADKrjW_1jZfeM2CVtwqg5zDDkc/exec",
)
HERE = os.path.dirname(__file__)
LOG = os.path.join(HERE, "_seed_log.json")


def load_secret():
    env = os.environ.get("MEDICATION_ORDER_SCRIPT_SECRET")
    if env:
        return env
    src = os.path.join(
        HERE, "..", "..", "google-apps-script", "Sync to Supabase",
        "medication-orders.gs",
    )
    import re

    m = re.search(r'SHARED_SECRET\s*=\s*"([^"]+)"', open(src, encoding="utf-8").read())
    if not m:
        sys.exit("Set MEDICATION_ORDER_SCRIPT_SECRET in the environment.")
    return m.group(1)


SECRET = load_secret()


def call(payload):
    body = json.dumps({**payload, "secret": SECRET}).encode()
    req = urllib.request.Request(
        SCRIPT_URL, data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        j = json.loads(r.read().decode())
    if not j.get("success"):
        raise RuntimeError(j.get("error"))
    return j


def main():
    if not os.path.exists(LOG):
        sys.exit("No _seed_log.json -- run seed_demo_medication.py first.")
    log = json.load(open(LOG))
    rx = [o["rx"] for o in log["orders"]]
    stock = [s["stock"] for s in log["stock"]]

    print(f"=== Cleaning up {len(rx)} orders + {len(stock)} stock events ===\n")

    if "--yes" not in sys.argv:
        a = input("This discontinues the orders in the live Sheet. Continue? [y/N] ")
        if a.strip().lower() != "y":
            sys.exit("Aborted.")

    # 1. Discontinue the orders, Sheet-first.
    print("--- Discontinuing orders (Sheet-first) ---")
    try:
        res = call({"action": "setOrderStatus", "rxOrderIds": rx, "status": "Discontinued"})
        print(f"  updated={len(res.get('updated', []))} notFound={res.get('notFound', [])}")
    except Exception as e:  # noqa: BLE001
        print(f"  ERR: {e}")
        print("  Orders may still be Active -- fix before deleting stock rows.")

    # 2. Delete stock rows from Supabase. The Sheet keeps its history; the
    #    24h reconciliation trigger only re-inserts rows newer than its
    #    high-water mark, so this is stable for a one-off test cleanup.
    print("\n--- Deleting stock rows from Supabase ---")
    conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=20)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("delete from tbl_medication_stock where external_ref_id = any(%s)", (stock,))
    print(f"  deleted {cur.rowcount} stock rows")
    conn.commit()

    # 3. Clear the rebuilt summaries so the residents go back to empty.
    print("\n--- Rebuilding resident medication summaries ---")
    for resident in sorted({o["resident"] for o in log["orders"]}):
        cur.execute(
            "update tbl_residents set current_medication_list = '' "
            "where \"ResidentID\" = %s", (resident,)
        )
        print(f"  cleared {resident}")
    conn.commit()
    conn.close()

    print("\n=== Done. Sheet rows remain as Discontinued audit history. ===")


if __name__ == "__main__":
    main()
