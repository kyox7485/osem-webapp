"""tbl_ResidentList -> tbl_residents."""
from __future__ import annotations

import datetime as dt

from access_reader import fetch_all
from context import MigrationContext
from enum_match import resolve_checked_enum
from etl_id_map import IdMap
from multiselect import clean_scalar, normalize_for_match, split_multiselect
from staff_match import resolve_staff_name

GENDER = ["M", "F"]
MARITAL_STATUS = ["Single", "Married", "Windowed", "Divorced"]
STATUS = ["ACTIVE", "DISCHARGED", "DECEASED", "TRANSFERRED OUT"]
CARE_TYPE = ["24-Hour Care", "Daycare"]
TRANSFER_FROM = ["Home", "Hospital", "Nursing Home", "Others"]
ACCOMPANIED_BY = ["Self", "Family", "Friends", "Social Worker", "Paramedic", "Others"]
MOBILITY = ["Walking Independent", "Walking Aid", "Wheelchair", "Bedbound"]
HYGIENE = ["Self Toileting", "Urinal", "Bedpan", "Commode Chair", "Pampers"]
CARE_GOAL = ["Nursing/ADL care", "Rehabilitation", "Wound Care", "Paliative Care", "Others"]


def _as_date(value) -> dt.date | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    return None


def run(ctx: MigrationContext) -> None:
    rows = fetch_all(ctx.access_conn, "tbl_ResidentList")
    ctx.report.inc("tbl_ResidentList.source_rows", len(rows))

    idmap = None if ctx.dry_run else IdMap(ctx.pg_conn, ctx.branch_code, "tbl_ResidentList")
    cur = ctx.pg_conn.cursor()

    for row in rows:
        source_id = row["ResidentID"]
        branch_text = clean_scalar(row.get("Branch"))
        if branch_text != ctx.branch_code:
            continue

        name = clean_scalar(row.get("Residents"))
        if not name:
            ctx.report.skip_row("tbl_ResidentList", source_id, "missing Residents (name)")
            continue

        past_med_list = clean_scalar(row.get("PastMedList"))
        med_reconciliation = None
        if past_med_list:
            med_reconciliation = f"[Past Medication List, migrated from Access]: {past_med_list}"
            ctx.report.note(
                f"tbl_ResidentList#{source_id}: PastMedList has no clean target column "
                "(medication_reconciliation_log means something more specific per schema notes) "
                "-- placed verbatim in medication_reconciliation_log, prefixed. Review."
            )

        physio_status = clean_scalar(row.get("PhysioStatus"))
        if physio_status:
            ctx.report.note(
                f"tbl_ResidentList#{source_id}: PhysioStatus={physio_status!r} has no target "
                "column in tbl_residents -- dropped (logged here only)."
            )

        care_goal_ids = [
            resolve_checked_enum(ctx.report, "care_goal", tok, CARE_GOAL)
            for tok in split_multiselect(row.get("CareGoal"))
        ]
        care_goal_ids = [c for c in care_goal_ids if c is not None]

        values = dict(
            branch_id=ctx.branch_id,
            resident_name=name,
            ic_number=clean_scalar(row.get("IC")),
            age=row.get("Age"),
            nationality_id=ctx.resolver.resolve("nationality", clean_scalar(row.get("Nationality"))),
            gender=resolve_checked_enum(ctx.report, "gender", row.get("Gender"), GENDER),
            marital_status=resolve_checked_enum(ctx.report, "marital_status", row.get("MaritalStatus"), MARITAL_STATUS),
            status=resolve_checked_enum(ctx.report, "resident_status", row.get("Status"), STATUS) or "ACTIVE",
            category=clean_scalar(row.get("Category")),
            care_type=resolve_checked_enum(ctx.report, "care_type", row.get("CareType"), CARE_TYPE),
            admission_date=_as_date(row.get("AdmissionDate")),
            discharge_date=_as_date(row.get("DischargeDate")),
            transfer_from=resolve_checked_enum(ctx.report, "transfer_from", row.get("TransferFrom"), TRANSFER_FROM),
            accompanied_by=resolve_checked_enum(ctx.report, "accompanied_by", row.get("AccompaniedBy"), ACCOMPANIED_BY),
            emergency_contact=clean_scalar(row.get("EmergencyContact")),
            allergy=clean_scalar(row.get("Allergy")),
            past_medical_condition=clean_scalar(row.get("PastMedicalCondition")),
            medication_reconciliation_log=med_reconciliation,
            current_medication_list=clean_scalar(row.get("CurrentMedList")),
            mobility=resolve_checked_enum(ctx.report, "mobility", row.get("Mobility"), MOBILITY),
            feeding_type_id=ctx.resolver.resolve("feeding_type", clean_scalar(row.get("Feeding"))),
            hygiene=resolve_checked_enum(ctx.report, "hygiene", row.get("Hygiene"), HYGIENE),
            diet_type_id=ctx.resolver.resolve("diet_type", clean_scalar(row.get("Diet"))),
            care_goal=care_goal_ids or None,
            tca_notes=clean_scalar(row.get("TCA")),
            assessment_and_summary=clean_scalar(row.get("AssessmentAndSummary")),
            reviewed_by=resolve_staff_name(ctx, "resident_reviewed_by", row.get("ReviewBy")),
        )

        if ctx.dry_run:
            if ctx.report.counts.get("tbl_residents.would_insert", 0) < ctx.sample:
                ctx.report.note(f"[dry-run sample] tbl_residents: {values}")
            ctx.report.inc("tbl_residents.would_insert")
            # Placeholder id (source_id, not a real tbl_residents.id) so
            # downstream dry-run previews (progress notes, nursing chart) can
            # resolve resident links for report purposes.
            ctx.resident_id_by_source_id[str(source_id)] = source_id
            ctx.resident_id_by_name[normalize_for_match(name)] = source_id
            continue

        cols = list(values.keys())
        existing_id = idmap.get(source_id)
        if existing_id:
            set_clause = ", ".join(f"{c} = %s" for c in cols)
            cur.execute(
                f"update tbl_residents set {set_clause}, updated_at = now() where id = %s",
                [*values.values(), existing_id],
            )
            target_id = existing_id
        else:
            col_sql = ", ".join(cols)
            placeholders = ", ".join(["%s"] * len(cols))
            cur.execute(
                f"insert into tbl_residents ({col_sql}) values ({placeholders}) returning id",
                list(values.values()),
            )
            target_id = cur.fetchone()[0]
            idmap.put(source_id, "tbl_residents", target_id)

        ctx.resident_id_by_source_id[str(source_id)] = target_id
        ctx.resident_id_by_name[normalize_for_match(name)] = target_id
        ctx.report.inc("tbl_residents.upserted")

    ctx.commit()
