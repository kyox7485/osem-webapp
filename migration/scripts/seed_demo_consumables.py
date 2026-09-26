"""
Seed DEMO (BranchID 6) consumables count log via the Apps Script Web App -- the ONLY path.

3 DEMO residents (DEMO-0001/2/3) each get 5 items (15 rows total):
  - 1 countable item (MaxStock > 0, RestockRequired = Yes)
  - 1 uncountable item (No MaxStock, RestockRequired = No)
  - 1 "Other" free-text item
  - 1 countable item with Family supplier
  - 1 countable item with OSEM supplier

Rows land first in the Sheet (source of truth), then sync to Supabase via consumableCountCreate.

Run:  python migration/scripts/seed_demo_consumables.py
See seed_demo_consumables_cleanup.py to remove the test data.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(__file__)

SCRIPT_URL = os.environ.get(
    "MEDICATION_ORDER_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbx7o8az8IZok4H-C1fVQaT727ihgmQFeqimL0eic_"
    "ADKrjW_1jZfeM2CVtwqg5zDDkc/exec",
)

# DEMO residents (BranchID 6) ACTIVE from live Supabase
RESIDENTS = ["DEMO-0001", "DEMO-0002", "DEMO-0003"]

# ACTIVE DEMO staff for CountedBy
STAFF = ["DEMO-0001", "DEMO-0002", "DEMO-0003", "DEMO-0005", "DEMO-0006"]

# Catalogue items (from live tbl_consumable_master after testConsumableSync())
CATALOGUE = {
    "C001": {"name": "Adult Diaper", "unit": "Pack", "max_stock": 5, "restock_required": True},
    "C002": {"name": "Underpad", "unit": "Pack", "max_stock": 3, "restock_required": True},
    "C003": {"name": "Wet Tissue", "unit": "Pack", "max_stock": 3, "restock_required": True},
    "C004": {"name": "Gloves", "unit": "Box", "max_stock": 2, "restock_required": True},
    "C005": {"name": "Nappy Cream", "unit": "Bottle", "max_stock": 1, "restock_required": True},
    "C006": {"name": "Lotion", "unit": "Bottle", "max_stock": None, "restock_required": False},
    "C007": {"name": "Milk Powder", "unit": "Tin", "max_stock": None, "restock_required": False},
    "C008": {"name": "Other", "unit": "Unit", "max_stock": None, "restock_required": False},
}

KL = timezone(timedelta(hours=8))  # Asia/Kuala_Lumpur
TODAY = datetime.now(KL).date()


def load_secret():
    """Shared secret from env or Apps Script source."""
    env = os.environ.get("MEDICATION_ORDER_SCRIPT_SECRET")
    if env:
        return env
    src = os.path.join(HERE, "..", "..", "google-apps-script", "Sync to Supabase", "medication-orders.gs")
    m = re.search(r'SHARED_SECRET\s*=\s*"([^"]+)"', open(src, encoding="utf-8").read())
    if not m:
        sys.exit("Set MEDICATION_ORDER_SCRIPT_SECRET in the environment.")
    return m.group(1)


SECRET = load_secret()


def new_record_id():
    return os.urandom(4).hex()


def sheet_stock_date(days_ago=0, hour=9, minute=15):
    d = TODAY - timedelta(days=days_ago)
    return f"{d.day:02d}/{d.month:02d}/{d.year} {hour:02d}:{minute:02d}:00"


def call(payload, retries=3):
    body = json.dumps({**payload, "secret": SECRET}).encode()
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                SCRIPT_URL, data=body, headers={"Content-Type": "application/json"}, method="POST"
            )
            with urllib.request.urlopen(req, timeout=90) as r:
                j = json.loads(r.read().decode())
            if not j.get("success"):
                raise RuntimeError(j.get("error") or "Apps Script request failed")
            sync = j.get("supabaseSync")
            if sync and sync.get("success") is False:
                print(f"    !! Supabase sync FAILED: {sync.get('error')}")
            return j
        except Exception as e:
            last = e
            if attempt < retries:
                time.sleep(0.5 * attempt)
    raise RuntimeError(f"Apps Script call failed after {retries} attempts: {last}")


def main():
    log = {"rows": [], "skipped": []}

    print(f"=== Seeding DEMO consumables (Sheet-first) ===\n")

    # Build seed rows: 5 per resident
    entries = []
    for ri, resident in enumerate(RESIDENTS):
        print(f"--- {resident} ({ri+1}/{len(RESIDENTS)}) ---")

        # Countable item (MaxStock > 0) — distribute across residents
        countable_key = f"C00{ri+1}"
        countable = CATALOGUE[countable_key]
        qty_full = countable["max_stock"]
        entries.append({
            "RecordID": new_record_id(), "ResidentID": resident, "ConsumableID": countable_key,
            "OtherConsumable": "", "OtherUnit": "", "Supplier": "OSEM",
            "CurrentStock": qty_full, "LastCount": sheet_stock_date(ri * 2),
            "CountedBy": STAFF[ri],
        })
        print(f"  {countable_key} ({countable['name']}) {qty_full} {countable['unit']} — Supplier: OSEM")

        # Uncountable item (no MaxStock) — Family supplier
        uncountable_key = "C006"
        uncountable = CATALOGUE[uncountable_key]
        entries.append({
            "RecordID": new_record_id(), "ResidentID": resident, "ConsumableID": uncountable_key,
            "OtherConsumable": "", "OtherUnit": "", "Supplier": "Family",
            "CurrentStock": 2, "LastCount": sheet_stock_date(ri * 2 + 1),
            "CountedBy": STAFF[(ri + 1) % len(STAFF)],
        })
        print(f"  {uncountable_key} ({uncountable['name']}) 2 {uncountable['unit']} — Supplier: Family")

        # "Other" free-text item — OSEM supplier
        other_name = f"Other Item {ri+1}"
        entries.append({
            "RecordID": new_record_id(), "ResidentID": resident, "ConsumableID": "C008",
            "OtherConsumable": other_name, "OtherUnit": "Unit", "Supplier": "OSEM",
            "CurrentStock": 1, "LastCount": sheet_stock_date(ri * 2 + 2),
            "CountedBy": STAFF[(ri + 2) % len(STAFF)],
        })
        print(f"  C008 (Other: {other_name}) 1 Unit — Supplier: OSEM")

        # Countable item — Family supplier (partial stock)
        qty_partial = max(0, qty_full - 2)
        entries.append({
            "RecordID": new_record_id(), "ResidentID": resident, "ConsumableID": countable_key,
            "OtherConsumable": "", "OtherUnit": "", "Supplier": "Family",
            "CurrentStock": qty_partial, "LastCount": sheet_stock_date(ri * 2 + 3),
            "CountedBy": STAFF[(ri + 3) % len(STAFF)],
        })
        print(f"  {countable_key} ({countable['name']}) {qty_partial} {countable['unit']} — Supplier: Family")

        # Countable item — OSEM supplier (low stock)
        entries.append({
            "RecordID": new_record_id(), "ResidentID": resident, "ConsumableID": countable_key,
            "OtherConsumable": "", "OtherUnit": "", "Supplier": "OSEM",
            "CurrentStock": 1, "LastCount": sheet_stock_date(ri * 2 + 4),
            "CountedBy": STAFF[(ri + 4) % len(STAFF)],
        })
        print(f"  {countable_key} ({countable['name']}) 1 {countable['unit']} — Supplier: OSEM")

    # Post to Apps Script
    print(f"\n--- Posting {len(entries)} rows to Apps Script ---")
    try:
        result = call({"action": "consumableCountCreate", "entries": entries})
        for e in entries:
            log["rows"].append({
                "recordId": e["RecordID"], "resident": e["ResidentID"],
                "item": e["ConsumableID"], "qty": e["CurrentStock"],
                "supplier": e["Supplier"], "countedBy": e["CountedBy"],
            })
        print(f"  OK  posted {len(entries)} rows")
        print(f"  appended: {result.get('appended', '?')}")
        print(f"  supabaseSync: {result.get('supabaseSync', {})}")
    except Exception as e:
        print(f"  ERR {e}")
        log["skipped"] = [{"recordId": e["RecordID"], "resident": e["ResidentID"], "error": str(e)} for e in entries]

    with open(os.path.join(HERE, "_seed_log.json"), "w") as f:
        json.dump(log, f, indent=2)

    print(f"\n=== {len(log['rows'])} rows seeded ===")
    print("Log: migration/scripts/_seed_log.json")


if __name__ == "__main__":
    sys.exit(main())