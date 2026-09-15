"""tbl_ProgressNote -> tbl_progress_notes."""
from __future__ import annotations

import datetime as dt

from access_reader import fetch_all
from context import MigrationContext
from etl_id_map import IdMap
from multiselect import clean_scalar, normalize_for_match
from staff_match import resolve_staff_name


def _resolve_resident(ctx: MigrationContext, source_pk, resident_id_raw, name_raw) -> int | None:
    if resident_id_raw is not None:
        rid = ctx.resident_id_by_source_id.get(str(resident_id_raw))
        if rid is not None:
            return rid
    name = clean_scalar(name_raw)
    if name is not None:
        rid = ctx.resident_id_by_name.get(normalize_for_match(name))
        if rid is not None:
            return rid
    ctx.report.skip_row(
        "tbl_ProgressNote", source_pk,
        f"could not resolve resident (ResidentID={resident_id_raw!r}, name={name_raw!r})",
    )
    return None


def run(ctx: MigrationContext) -> None:
    rows = fetch_all(ctx.access_conn, "tbl_ProgressNote")
    ctx.report.inc("tbl_ProgressNote.source_rows", len(rows))

    idmap = None if ctx.dry_run else IdMap(ctx.pg_conn, ctx.branch_code, "tbl_ProgressNote")
    cur = ctx.pg_conn.cursor()

    for row in rows:
        source_id = row["RID"]
        resident_id = _resolve_resident(ctx, source_id, row.get("ResidentID"), row.get("Residents"))
        if resident_id is None:
            continue

        values = dict(
            branch_id=ctx.branch_id,
            resident_id=resident_id,
            entry_timestamp=row.get("Timestamp") or dt.datetime.now(),
            past_med_condition=clean_scalar(row.get("PastMedCondition")),
            progress_note=clean_scalar(row.get("ProgressNote")),
            physical_examination=clean_scalar(row.get("PhysicalExamination")),
            medical_plan=clean_scalar(row.get("MedicalPlan")),
            monitoring_plan=clean_scalar(row.get("MonitoringPlan")),
            feeding_plan=clean_scalar(row.get("FeedingPlan")),
            dressing_plan=clean_scalar(row.get("DressingPlan")),
            nursing_plan=clean_scalar(row.get("NursingPlan")),
            physio_plan=clean_scalar(row.get("PhysioPlan")),
            current_medication_regime=clean_scalar(row.get("CurrMedRegime")),
            tca_notes=clean_scalar(row.get("TCA")),
            reviewed_by=resolve_staff_name(ctx, "progress_note_reviewed_by", row.get("ReviewBy")),
        )

        if ctx.dry_run:
            if ctx.report.counts.get("tbl_progress_notes.would_insert", 0) < ctx.sample:
                ctx.report.note(f"[dry-run sample] tbl_progress_notes: {values}")
            ctx.report.inc("tbl_progress_notes.would_insert")
            continue

        existing_id = idmap.get(source_id)
        cols = list(values.keys())
        if existing_id:
            set_clause = ", ".join(f"{c} = %s" for c in cols)
            cur.execute(f"update tbl_progress_notes set {set_clause} where id = %s", [*values.values(), existing_id])
        else:
            col_sql = ", ".join(cols)
            placeholders = ", ".join(["%s"] * len(cols))
            cur.execute(
                f"insert into tbl_progress_notes ({col_sql}) values ({placeholders}) returning id",
                list(values.values()),
            )
            idmap.put(source_id, "tbl_progress_notes", cur.fetchone()[0])

        ctx.report.inc("tbl_progress_notes.upserted")

    ctx.commit()
