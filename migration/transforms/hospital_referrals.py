"""tbl_HospReferral -> tbl_hospital_referrals.

Near 1:1. The demographic columns (Age, Nationality, Gender, MaritalStatus,
AdmissionDate, EmergencyContact, Allergy) are snapshots of tbl_residents and
have no home on the referral row -- the referral points at resident_id and the
current demographics are read from tbl_residents. The referral-specific
narrative fields (ChiefComplaints, VitalSigns, Mobility, Feeding, Hygiene)
map straight across.

Idempotent via etl.id_map keyed on (source_table, source_id, branch_code).
"""
from __future__ import annotations

from access_reader import fetch_all
from context import MigrationContext
from etl_id_map import IdMap
from multiselect import clean_scalar

TARGET = "tbl_hospital_referrals"

# The referral-specific narrative. A row with none of these is an artefact of
# Access capturing the form, not a referral -- same rule as tbl_ProgressNote.
# Verified: zero rows in tbl_HospReferral currently match, but the guard keeps
# the two tables consistent if bad data is entered later.
CONTENT_COLUMNS = [
    "ChiefComplaints", "VitalSigns", "Mobility", "Feeding", "Hygiene",
    "PastMedicalCondition", "CurrentMedList", "Allergy",
]


def run(ctx: MigrationContext) -> None:
    rows = fetch_all(ctx.access_conn, "tbl_HospReferral")
    ctx.report.inc("tbl_HospReferral.source_rows", len(rows))

    idmap = None if ctx.dry_run else IdMap(ctx.pg_conn, ctx.branch_code, "tbl_HospReferral")
    cur = ctx.pg_conn.cursor()

    for row in rows:
        source_id = row["RID"]

        if not any(clean_scalar(row.get(col)) for col in CONTENT_COLUMNS):
            ctx.report.skip_row(
                "tbl_HospReferral", source_id,
                "no clinical content (only name/timestamp populated)",
            )
            continue

        resident_id, reason = ctx.residents.resolve(row.get("Residents"), row.get("IC"))
        if resident_id is None:
            ctx.report.skip_row("tbl_HospReferral", source_id, reason)
            continue

        reviewed_by = ctx.staff.resolve(row.get("ReviewBy"), "tbl_HospReferral")

        values = dict(
            branch_id=ctx.branch_id,
            resident_id=resident_id,
            referral_datetime=row.get("DateAndTime"),
            chief_complaints=clean_scalar(row.get("ChiefComplaints")),
            vital_signs=clean_scalar(row.get("VitalSigns")),
            mobility=clean_scalar(row.get("Mobility")),
            feeding=clean_scalar(row.get("Feeding")),
            hygiene=clean_scalar(row.get("Hygiene")),
            reviewed_by=reviewed_by,
        )

        if not ctx.dry_run:
            existing = idmap.get(source_id)
            if existing is not None:
                cur.execute(
                    f"update {TARGET} set " + ", ".join(f"{k} = %s" for k in values)
                    + " where id = %s",
                    (*values.values(), existing),
                )
                idmap.put(source_id, TARGET, existing)
            else:
                cols = ", ".join(values)
                marks = ", ".join(["%s"] * len(values))
                cur.execute(
                    f"insert into {TARGET} ({cols}) values ({marks}) returning id",
                    tuple(values.values()),
                )
                (target_id,) = cur.fetchone()
                idmap.put(source_id, TARGET, target_id)

        ctx.report.inc(f"{TARGET}.imported")

    ctx.commit()
