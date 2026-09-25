"""
Seed DEMO (BranchID 6) medication orders + stock by driving the live Apps
Script Web App -- the ONLY Sheet-first path. Never write tbl_medication_orders
/ tbl_medication_stock directly; the next Sheet->Supabase sync would revert it
(docs/medication.md, docs/medication-stock.md).

Run:  python migration/scripts/seed_demo_medication.py
Logs every response to _seed_log.json. See seed_demo_medication_cleanup.py to
remove the test data.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

SCRIPT_URL = os.environ.get(
    "MEDICATION_ORDER_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbx7o8az8IZok4H-C1fVQaT727ihgmQFeqimL0eic_"
    "ADKrjW_1jZfeM2CVtwqg5zDDkc/exec",
)


def load_secret():
    """The shared secret is never inlined here.

    Prefer MEDICATION_ORDER_SCRIPT_SECRET (same var Vercel uses). Otherwise
    parse it out of the Apps Script source we already mirror in this repo, so
    this script doesn't add another plaintext copy of a live credential.
    """
    env = os.environ.get("MEDICATION_ORDER_SCRIPT_SECRET")
    if env:
        return env
    src = os.path.join(
        os.path.dirname(__file__), "..", "..", "google-apps-script",
        "Sync to Supabase", "medication-orders.gs",
    )
    m = re.search(r'SHARED_SECRET\s*=\s*"([^"]+)"', open(src, encoding="utf-8").read())
    if not m:
        sys.exit(
            "Could not find SHARED_SECRET. Set MEDICATION_ORDER_SCRIPT_SECRET "
            "in the environment and re-run."
        )
    return m.group(1)


SECRET = load_secret()
KL = timezone(timedelta(hours=8))  # Asia/Kuala_Lumpur

# Real tbl_staff.StaffID, branch 6 (DEMO), all ACTIVE.
NURSES = ["DEMO-0001", "DEMO-0002", "DEMO-0003", "DEMO-0005", "DEMO-0006"]
DOCTOR = "DEMO-0002"  # Dr. Faizal Rahman

TODAY = datetime.now(KL).date()


def sheet_stock_date(days_ago=0, hour=9, minute=15):
    """StockDate is DD/MM/YYYY HH:mm:ss in Asia/Kuala_Lumpur."""
    d = TODAY - timedelta(days=days_ago)
    return f"{d.day:02d}/{d.month:02d}/{d.year} {hour:02d}:{minute:02d}:00"


def new_id():
    return random_bytes_hex()


def random_bytes_hex():
    return os.urandom(4).hex()


def call(payload, retries=3):
    """Same shape as callScript() in webapp/src/lib/medication-orders-script.ts."""
    body = json.dumps({**payload, "secret": SECRET}).encode()
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                SCRIPT_URL,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=90) as r:
                j = json.loads(r.read().decode())
            if not j.get("success"):
                raise RuntimeError(j.get("error") or "Apps Script request failed")
            sync = j.get("supabaseSync")
            if sync and sync.get("success") is False:
                print("    !! saved to Sheet but Supabase sync FAILED:", sync.get("error"))
            return j
        except Exception as e:  # noqa: BLE001 - retry, then give up loudly
            last = e
            if attempt < retries:
                time.sleep(0.5 * attempt)
    raise RuntimeError(f"Apps Script call failed after {retries} attempts: {last}")


# ── Order definitions ─────────────────────────────────────────────────────────
# 4 orders per resident, deliberately varied: OD/BD/TDS/ON/EOD/PRN/Selected Days,
# one Short Term with an end date, OSEM- and family-supplied.
ORDERS = [
    # TAN MEI LING (DEMO-0002)
    {
        "resident": "DEMO-0002",
        "drug": [
            ("Tablet", "Norvasc", "amlodipine 5mg", "1", "Tablet", "OD", "0800AM",
             "Everyday", "Hypertension", "Take in the morning with water", "Long Term", "", "OSEM"),
            ("Tablet", "Glucophage", "metformin 500mg", "1", "Tablet", "BD", "0800AM,0600PM",
             "Everyday", "Type 2 Diabetes Mellitus", "Take after meals", "Long Term", "", "OSEM"),
            ("Tablet", "Lipitor", "atorvastatin 20mg", "1", "Tablet", "ON", "1000PM",
             "Everyday", "Hyperlipidaemia", "Take at bedtime", "Long Term", "", "Family"),
            ("Tablet", "Panadol", "paracetamol 500mg", "1", "Tablet", "PRN", "",
             "Everyday", "Pain / fever", "Only when pain or fever, max 4/day", "Long Term", "", "OSEM"),
        ],
    },
    # AHMAD BIN ISMAIL (DEMO-0001)
    {
        "resident": "DEMO-0001",
        "drug": [
            ("Tablet", "Glucophage", "metformin 500mg", "1", "Tablet", "TDS",
             "0800AM,1200PM,0600PM", "Everyday", "Type 2 Diabetes Mellitus",
             "Take after each meal", "Long Term", "", "OSEM"),
            ("Tablet", "Zocor", "simvastatin 10mg", "1", "Tablet", "EOD", "1000PM",
             "Everyday", "Hyperlipidaemia", "Take at bedtime", "Long Term", "", "Family"),
            ("Tablet", "Aricept", "donepezil 5mg", "1", "Tablet", "ON", "1000PM",
             "Monday,Wednesday,Friday", "Alzheimer's dementia", "Take at bedtime",
             "Long Term", "", "OSEM"),
            ("Inhaler", "Ventolin", "salbutamol 100mcg", "2", "Puff", "BD", "0800AM,0600PM",
             "Everyday", "Asthma", "2 puffs via spacer, rinse mouth after", "Long Term", "", "OSEM"),
        ],
    },
    # RAJA A/L MUTHU (DEMO-0003)
    {
        "resident": "DEMO-0003",
        "drug": [
            ("Tablet", "Norvasc", "amlodipine 5mg", "1", "Tablet", "OD", "0800AM",
             "Everyday", "Hypertension", "Short course for BP review", "Short Term",
             str(TODAY + timedelta(days=21)), "OSEM"),
            ("Tablet", "Brufen", "ibuprofen 400mg", "1", "Tablet", "TDS",
             "0800AM,1200PM,0600PM", "Everyday", "Arthritis pain",
             "Take after meals, with food", "Long Term", "", "OSEM"),
            ("Tablet", "Motilium", "domperidone 10mg", "1", "Tablet", "PRN", "",
             "Everyday", "Nausea", "30 mins before food, max 3/day", "Long Term", "", "Family"),
            ("Tablet", "Calcium + D", "vitamin D3 1000 IU", "1", "Tablet", "OD", "0800AM",
             "Everyday", "Bone health", "Take in the morning", "Long Term", "", "OSEM"),
        ],
    },
]

# Stock events: (resident, drug-ingredient match, EntryType, balance, unit,
#                 days_ago, nurses-index)
# Count units (Tablet/Puff/mL) so the forecast actually computes; one Estimate
# unit (Bottle) to exercise the "never auto-reduced" path.
STOCK = [
    ("DEMO-0002", "amlodipine 5mg", "Stock Count", 60, "Tablet", 10, 0),
    ("DEMO-0002", "metformin 500mg", "Stock Count", 100, "Tablet", 8, 1),
    ("DEMO-0002", "atorvastatin 20mg", "Stock Received", 30, "Tablet", 5, 2),
    # PRN -> never forecasted, so daily usage / days remaining = 0.
    ("DEMO-0002", "paracetamol 500mg", "Stock Count", 120, "Tablet", 3, 3),
    ("DEMO-0001", "metformin 500mg", "Stock Count", 150, "Tablet", 12, 1),
    ("DEMO-0001", "simvastatin 10mg", "Stock Count", 12, "Tablet", 6, 2),
    ("DEMO-0001", "donepezil 5mg", "Stock Received", 20, "Tablet", 2, 0),
    # Estimate unit: balance is whatever was counted/received, never reduced.
    ("DEMO-0001", "salbutamol 100mcg", "Stock Count", 1, "Bottle", 4, 3),
    ("DEMO-0003", "amlodipine 5mg", "Stock Count", 45, "Tablet", 7, 4),
    ("DEMO-0003", "ibuprofen 400mg", "Stock Count", 90, "Tablet", 9, 0),
    ("DEMO-0003", "domperidone 10mg", "Stock Count", 40, "Tablet", 1, 2),
    ("DEMO-0003", "vitamin D3 1000 IU", "Stock Count", 2, "Bottle", 0, 1),
]


def main():
    log = {"orders": [], "stock": [], "skipped_stock": []}
    created = {}  # (resident, ingredient) -> rxOrderId

    print(f"=== Seeding DEMO medication via Apps Script (Sheet-first) ===\n")
    print(f"URL: {SCRIPT_URL}\n")

    # ── 1. Orders ───────────────────────────────────────────────────────────
    print("--- Creating 12 orders ---")
    for group in ORDERS:
        resident = group["resident"]
        for i, d in enumerate(group["drug"]):
            (form, brand, ingredient, dose, unit, freq, times, days, indication,
             instruction, duration, end_date, supplied) = d
            rx = new_id()
            order = {
                "RxOrderID": rx,
                "ResidentID": resident,
                "Dosage Form": form,
                "Brand Name": brand,
                "Active Ingredient": ingredient,
                "Dose": dose,
                "Unit": unit,
                "Frequency": freq,
                "Administration Times": times,
                "Dosing Days": days,
                "Indication": indication,
                "Instruction": instruction,
                "Duration Type": duration,
                "Start Date": str(TODAY - timedelta(days=30)),
                "End Date": end_date,
                "Noted By": DOCTOR if "Dr" in DOCTOR else NURSES[i % len(NURSES)],
                "Ordered By": "Family" if supplied == "Family" else "OSEM Medical Team",
                "Supplied By": supplied,
                "Status": "Active",
                "PreviousRxOrderID": "",
            }
            try:
                res = call({"action": "create", "order": order})
                created[(resident, ingredient)] = rx
                log["orders"].append(
                    {"rx": rx, "resident": resident, "ingredient": ingredient}
                )
                print(f"  OK  {resident}  {ingredient:22s}  {freq:5s}  {rx}")
            except Exception as e:  # noqa: BLE001
                print(f"  ERR {resident}  {ingredient}: {e}")
                log["skipped_stock"].append(
                    {"resident": resident, "ingredient": ingredient, "error": str(e)}
                )

    # ── 2. Stock ────────────────────────────────────────────────────────────
    print("\n--- Creating stock events ---")
    for resident, ingredient, entry_type, balance, unit, days_ago, ni in STOCK:
        rx = created.get((resident, ingredient))
        if not rx:
            print(f"  SKIP {resident} {ingredient} - order not created")
            log["skipped_stock"].append(
                {"resident": resident, "ingredient": ingredient, "error": "no order"}
            )
            continue
        entry = {
            "StockID": new_id(),
            "ResidentID": resident,
            "RxOrderID": rx,
            "Balance": balance,
            "Unit": unit,
            # Snapshot at event time; 0 = not applicable (PRN / Estimate).
            "Daily Usage": 0,
            "Days Remaining": 0,
            "StockDate": sheet_stock_date(days_ago),
            "RegisteredBy": NURSES[ni % len(NURSES)],
            "EntryType": entry_type,
        }
        try:
            call({"action": "stockCreate", "entry": entry})
            log["stock"].append(
                {"stock": entry["StockID"], "rx": rx, "resident": resident,
                 "ingredient": ingredient, "entry_type": entry_type}
            )
            print(f"  OK  {resident}  {ingredient:22s}  {entry_type:14s}  "
                  f"{balance} {unit}  {entry['StockID']}")
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {resident} {ingredient}: {e}")
            log["skipped_stock"].append(
                {"resident": resident, "ingredient": ingredient, "error": str(e)}
            )

    with open(os.path.join(os.path.dirname(__file__), "_seed_log.json"), "w") as f:
        json.dump(log, f, indent=2)

    print(f"\n=== {len(log['orders'])} orders, {len(log['stock'])} stock events "
          f"({len(log['skipped_stock'])} skipped) ===")
    print("Log written to migration/scripts/_seed_log.json")


if __name__ == "__main__":
    sys.exit(main())
