"""tbl_ProgressNote -> tbl_progress_notes.

Supersedes transforms/progress_notes.py, which is left in place untouched but
is dead code: it writes past_med_condition, current_medication_regime and
tca_notes, none of which exist on tbl_progress_notes. It was never wired into
run_migration.TRANSFORM_MODULES, so it has never run. Per owner decision,
PastMedCondition and CurrMedRegime are DROPPED here rather than relocated --
there is no target column, and stuffing clinical medication text into an
unrelated column (as the resident migration did for PastMedList) would put
per-note medication data in the wrong place.

Idempotent via etl.id_map keyed on (source_table, source_id, branch_code).
"""
from __future__ import annotations

from access_reader import fetch_all
from context import MigrationContext
from etl_id_map import IdMap
from multiselect import clean_scalar

TARGET = "tbl_progress_notes"

# Access column -> target column. PastMedCondition and CurrMedRegime are
# deliberately absent (dropped by decision).
FIELD_MAP = {
    "ProgressNote": "progress_note",
    "PhysicalExamination": "physical_examination",
    "MedicalPlan": "medical_plan",
    "MonitoringPlan": "monitoring_plan",
    "FeedingPlan": "feeding_plan",
    "DressingPlan": "dressing_plan",
    "NursingPlan": "nursing_plan",
    "PhysioPlan": "physio_plan",
}

# Every Access column that holds actual clinical content. TCA is included even
# though it has no target column: a row whose only content is a TCA is still a
# real clinical entry, just one we cannot represent -- skipping it would lose
# data silently, so it is imported with its other fields. PastMedCondition and
# CurrMedRegime likewise: they are dropped on the way out, but a row that has
# ONLY those still represents a genuine encounter.
CONTENT_COLUMNS = (
    list(FIELD_MAP) + ["TCA", "PastMedCondition", "CurrMedRegime"]
)


def run(ctx: MigrationContext) -> None:
    rows = fetch_all(ctx.access_conn, "tbl_ProgressNote")
    ctx.report.inc("tbl_ProgressNote.source_rows", len(rows))

    idmap = None if ctx.dry_run else IdMap(ctx.pg_conn, ctx.branch_code, "tbl_ProgressNote")
    cur = ctx.pg_conn.cursor()

    for row in rows:
        source_id = row["RID"]

        # Rows that carry an identity and a timestamp but no clinical content
        # at all are artefacts of how Access captured the entry (a name was
        # selected in the form, the note was never typed). Importing them
        # produces empty rows on the resident's chart, so they are skipped --
        # per owner decision. Checked BEFORE identity resolution: a
        # contentless row has nothing to attribute, so resolving it would only
        # risk landing an empty note on the wrong resident.
        if not any(clean_scalar(row.get(col)) for col in CONTENT_COLUMNS):
            ctx.report.skip_row(
                "tbl_ProgressNote", source_id,
                "no clinical content (only name/timestamp populated)",
            )
            continue

        # Access ResidentID is NULL in every row -- the master list resolves it.
        resident_id, reason = ctx.residents.resolve(row.get("Residents"), row.get("IC"))
        if resident_id is None:
            ctx.report.skip_row("tbl_ProgressNote", source_id, reason)
            continue

        values: dict[str, object] = dict(
            branch_id=ctx.branch_id,
            resident_id=resident_id,
            entry_timestamp=row.get("Timestamp"),
        )
        for src_col, dst_col in FIELD_MAP.items():
            values[dst_col] = clean_scalar(row.get(src_col))
        values["reviewed_by"] = ctx.staff.resolve(row.get("ReviewBy"), "tbl_ProgressNote")

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
