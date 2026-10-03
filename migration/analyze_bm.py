"""Read-only analysis of the BM clinical xlsx exports.

Answers the planning questions for the BMN migration:
  1. Exact row counts per skip reason (identity, contentless, ...)
  2. How many rows are affected by the dashed-IC blind spot
  3. How many rows each asserted override would capture
  4. BO/PU format era breakdown
No writes anywhere.
"""
from __future__ import annotations

import os
import sys
from collections import Counter, defaultdict

import openpyxl
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clinical_match import (ResidentIndex, StaffIndex, clean_ic, clean_scalar,
                            resident_match_keys, _norm)

BASE = r"C:\Users\NGF\dev\osem-webapp\access\bm"
DSN = ("postgresql://postgres:weareosem2020@"
       "db.kopmxzdzbvjcqaejviyh.supabase.co:5432/postgres")


class FakeReport:
    def __init__(self):
        self.fuzzy_log = []

    def inc(self, *a, **k):
        pass

    def fuzzy(self, kind, raw, detail):
        self.fuzzy_log.append((kind, str(raw), detail))

    def skip_row(self, *a, **k):
        pass

    def note(self, *a, **k):
        pass


def load(fname):
    p = os.path.join(BASE, fname)
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    out = [dict(zip(header, r)) for r in rows]
    wb.close()
    return out


def main():
    conn = psycopg2.connect(DSN, connect_timeout=15)
    cur = conn.cursor()
    cur.execute("set time zone 'Asia/Kuala_Lumpur'")

    # --- resident master index, with a normalized-IC shadow index ----
    rep = FakeReport()
    ridx = ResidentIndex(conn, 3, rep)
    norm_ic = {}
    cur.execute("select id, ic_number from tbl_residents where branch_id=3")
    for rid, ic in cur.fetchall():
        if ic:
            norm_ic.setdefault(clean_ic(ic), rid)

    # --- 1. progress notes -------------------------------------------
    pn = load("tbl_ProgressNote - bm.xlsx")
    CONTENT = ("ProgressNote", "PhysicalExamination", "MedicalPlan",
               "MonitoringPlan", "FeedingPlan", "DressingPlan",
               "NursingPlan", "PhysioPlan", "TCA",
               "PastMedCondition", "CurrMedRegime")
    pn_stats = Counter()
    pn_ic_benefit = 0
    for row in pn:
        if not any(clean_scalar(row.get(c)) for c in CONTENT):
            pn_stats["contentless"] += 1
            continue
        rid, reason = ridx.resolve(row.get("Residents"), row.get("IC"))
        if rid is not None:
            pn_stats["resolved"] += 1
            continue
        if "IC" in reason and "not in master list" in reason:
            # would a normalized IC match?
            ic = clean_ic(row.get("IC"))
            if ic and ic in norm_ic:
                pn_ic_benefit += 1
        pn_stats["skipped"] += 1
    print(f"tbl_ProgressNote: {len(pn)} rows")
    print(f"  resolved={pn_stats['resolved']} contentless={pn_stats['contentless']} "
          f"skipped={pn_stats['skipped']} (of which IC-fixed-by-normalization={pn_ic_benefit})")

    # --- 2. referrals ------------------------------------------------
    hr = load("tbl_HospReferral - bm.xlsx")
    HR_CONTENT = ("ChiefComplaints", "VitalSigns", "Mobility", "Feeding",
                  "Hygiene", "PastMedicalCondition", "CurrentMedList", "Allergy")
    hr_stats = Counter()
    for row in hr:
        if not any(clean_scalar(row.get(c)) for c in HR_CONTENT):
            hr_stats["contentless"] += 1
            continue
        rid, reason = ridx.resolve(row.get("Residents"), row.get("IC"))
        if rid is not None:
            hr_stats["resolved"] += 1
        else:
            hr_stats["skipped"] += 1
    print(f"tbl_HospReferral: {len(hr)} rows")
    print(f"  resolved={hr_stats['resolved']} contentless={hr_stats['contentless']} "
          f"skipped={hr_stats['skipped']}")

    # --- 3. nursing chart --------------------------------------------
    nc = load("tbl_NursingChart - bm.xlsx")
    # name index shadow: pre-'@' primary only (for the alias question)
    by_primary = defaultdict(set)
    cur.execute("select id, resident_name from tbl_residents where branch_id=3")
    for rid, name in cur.fetchall():
        if not name:
            continue
        text = clean_scalar(name)
        primary, _ = (text.partition("@")[0].strip(), None)
        by_primary[_norm(primary)].add(rid)
        by_primary[_norm(text)].add(rid)

    nc_stats = Counter()
    ambig = Counter()
    lim_poh = Counter()
    tan_ct = Counter()
    lim_cy = Counter()
    for row in nc:
        name = row.get("ResidentName")
        ts = row.get("Timestamp")
        if not name:
            nc_stats["no-name"] += 1
            continue
        rid, reason = ridx.resolve(name, None, when=ts)
        if rid is not None:
            nc_stats["resolved"] += 1
            continue
        if "ambiguous" in reason:
            nc_stats["ambiguous"] += 1
            u = str(name).strip().upper()
            ambig[u] += 1
            day = ts.date() if ts else None
            if "LIM POH CHENG" in u:
                lim_poh[day] += 1
            elif "TAN CHUNG TIAN" in u:
                tan_ct[day] += 1
            elif "LIM CHOON YAM" in u:
                lim_cy[day] += 1
        else:
            nc_stats["unmatched"] += 1
    print(f"tbl_NursingChart: {len(nc)} rows")
    print(f"  resolved={nc_stats['resolved']} ambiguous={nc_stats['ambiguous']} "
          f"unmatched={nc_stats['unmatched']} no-name={nc_stats['no-name']}")
    print(f"  ambiguous names: {dict(ambig)}")

    def window(name, byday, candidates):
        days = sorted(byday)
        lo, hi = days[0], days[-1]
        print(f"  {name}: {sum(byday.values())} rows, {len(days)} distinct days, "
              f"{lo} .. {hi}")
        for cid, adm, dis in candidates:
            inside = sum(n for d, n in byday.items()
                         if d and adm <= d <= (dis or __import__('datetime').date(9999, 1, 1)))
            print(f"      resident {cid} adm {adm} dis {dis}: {inside} rows inside window")

    window("LIM POH CHENG", lim_poh,
           [(315, __import__('datetime').date(2025, 1, 21), __import__('datetime').date(2025, 2, 23)),
            (343, __import__('datetime').date(2026, 2, 12), None)])
    window("TAN CHUNG TIAN", tan_ct,
           [(339, __import__('datetime').date(2025, 12, 18), __import__('datetime').date(2026, 1, 31)),
            (357, __import__('datetime').date(2026, 7, 6), __import__('datetime').date(2026, 9, 10))])
    window("LIM CHOON YAM", lim_cy,
           [(293, __import__('datetime').date(2024, 7, 14), __import__('datetime').date(2024, 7, 18)),
            (347, __import__('datetime').date(2026, 3, 12), __import__('datetime').date(2026, 3, 16))])

    # --- 4. staff ----------------------------------------------------
    srep = FakeReport()
    sidx = StaffIndex(conn, srep, branch_code="BMN", branch_id=3, dry_run=True)
    for fname, col in (("tbl_NursingChart - bm.xlsx", "Review by"),
                       ("tbl_ProgressNote - bm.xlsx", "ReviewBy"),
                       ("tbl_HospReferral - bm.xlsx", "ReviewBy")):
        rows = load(fname)
        r = Counter()
        unattr = Counter()
        for row in rows:
            nm = row.get(col)
            if not nm:
                continue
            sid = sidx.resolve(nm, fname)
            if sid:
                r["resolved"] += 1
            else:
                r["unattributed"] += 1
                unattr[str(nm).strip()] += 1
        print(f"{fname} [{col}]: resolved={r['resolved']} unattributed={r['unattributed']}")
        for nm, n in unattr.most_common(12):
            print(f"      {n:5d}  {nm!r}")

    # --- 5. BO/PU format eras ----------------------------------------
    eras = Counter()
    for row in nc:
        bo, pu = str(row.get("BO") or ""), str(row.get("PU") or "")
        if not bo and not pu:
            continue
        combined = "BO - " in bo or "PU - " in bo or "BO - " in pu
        if combined:
            eras["combined 'BO - x, PU - y'"] += 1
        else:
            eras["separate"] += 1
    print(f"BO/PU format eras: {dict(eras)}")

    conn.close()


if __name__ == "__main__":
    main()
