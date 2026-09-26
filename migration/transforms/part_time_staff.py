"""Creates tbl_staff rows for staff names that appear on clinical records but
match no roster entry -- part-time, non-registered staff (owner decision).

Must run LAST, after the clinical transforms have registered every candidate
(so a name created here is available to them on the next run) and after the
clinical rows are written, so their reviewed_by can be back-filled in the same
transaction. Idempotent via etl.id_map: a candidate already created is skipped.
"""
from __future__ import annotations

from etl_id_map import IdMap
from clinical_match import PART_TIME_DEPARTMENT, PART_TIME_POSITION, PART_TIME_ROLE, PART_TIME_STATUS

IDMAP_SOURCE = "part_time_staff"


def run(ctx: MigrationContext) -> None:
    candidates = ctx.staff.part_time.candidates()
    if not candidates:
        return

    if ctx.dry_run:
        ctx.report.inc("part_time_staff.candidates_pending_approval", len(candidates))
        ctx.report.note(
            f"{len(candidates)} part-time staff candidate(s) found. Nothing created in a "
            "dry run -- see the 'Part-time staff to be created' section. Re-run with "
            "--commit to create them."
        )
        return

    idmap = IdMap(ctx.pg_conn, ctx.branch_code, IDMAP_SOURCE)
    cur = ctx.pg_conn.cursor()

    for c in candidates:
        source_key = c.staff_name
        existing = idmap.get(source_key)
        if existing is not None:
            ctx.report.inc("part_time_staff.already_exists")
            ctx._backfilled_staff.setdefault(source_key, existing)
            continue

        cur.execute("select id from tbl_positions where name = %s", (c.position,))
        pos = cur.fetchone()
        if pos is None:
            ctx.report.skip_row(IDMAP_SOURCE, source_key, f"position {c.position!r} not in tbl_positions")
            continue

        cur.execute(
            """
            insert into tbl_staff (branch_id, staff_name, position_id, role, department, status)
            values (%s, %s, %s, %s, %s, %s)
            returning "StaffID"
            """,
            (ctx.branch_id, c.staff_name, pos[0], PART_TIME_ROLE, PART_TIME_DEPARTMENT, PART_TIME_STATUS),
        )
        (staff_id,) = cur.fetchone()
        idmap.put(source_key, "tbl_staff", staff_id)
        ctx._backfilled_staff[source_key] = staff_id
        ctx.report.inc("part_time_staff.created")
        ctx.report.note(
            f"created part-time staff {staff_id} for {c.staff_name!r} "
            f"({c.occurrences} clinical rows: {', '.join(sorted(c.tables))})"
        )

    ctx.commit()
    backfill_reviewed_by(ctx)


def backfill_reviewed_by(ctx: MigrationContext) -> None:
    """Point already-written clinical rows at the staff rows just created.

    The clinical transforms ran first and left the attribution column NULL for
    these names, so re-resolve just those rows against the now-populated index
    and update them in place. Idempotent: the second run resolves to the same
    StaffIDs before any update is issued.

    The attribution column is named per table -- reviewed_by on the nursing
    tables, documented_by on physio_assessments.
    """
    if not ctx._backfilled_staff or ctx.dry_run:
        return

    cur = ctx.pg_conn.cursor()
    for target, attr_col, pk_col, idmap_source in (
        ("tbl_progress_notes", "reviewed_by", "RID", "tbl_ProgressNote"),
        ("tbl_hospital_referrals", "reviewed_by", "RID", "tbl_HospReferral"),
        ("physio_assessments", "documented_by", "ID", "tbl_PhyIPProgressNote"),
    ):
        idmap = IdMap(ctx.pg_conn, ctx.branch_code, idmap_source)
        for name, staff_id in ctx._backfilled_staff.items():
            cur.execute(f"select {pk_col} from {target} where {attr_col} is null")
            # Re-walk the source rows so we update by the Access PK, not by
            # whatever the clinical table's own id happens to be.
            for (source_id,) in cur.fetchall():
                target_id = idmap.get(source_id)
                if target_id is None:
                    continue
                cur.execute(
                    f"update {target} set {attr_col} = %s where id = %s and {attr_col} is null",
                    (staff_id, target_id),
                )
                if cur.rowcount:
                    ctx.report.inc(f"{target}.{attr_col}_backfilled")
    ctx.commit()
