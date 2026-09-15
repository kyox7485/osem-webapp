"""StaffList_tbl -> tbl_staff.

Role mapping: Access's Role column is only ADMIN/MANAGEMENT/STAFF/blank --
much coarser than the target 7-way staff_role enum. Per OSEM_Schema_Notes.md
this was explicitly left as "your call", so: ADMIN/MANAGEMENT map directly;
everything else is derived from Position (a real, specific field) via
POSITION_TO_ROLE. Anything that still doesn't resolve is logged and the row
is skipped (role is NOT NULL, can't guess it).
"""
from __future__ import annotations

from access_reader import fetch_all
from context import MigrationContext
from etl_id_map import IdMap
from multiselect import clean_scalar, normalize_for_match

POSITION_TO_ROLE: dict[str, str] = {
    # Keys must already be run through normalize_for_match (periods
    # stripped, lowercased, whitespace-collapsed) since that's what
    # _derive_role looks them up with.
    "medical officer": "doctor",
    "specialist": "doctor",
    "consultant": "doctor",
    "medical assistant": "doctor",
    "pharmacist": "pharmacist",
    "physiotherapist": "physio",
    "assist physiotherapist": "physio",
    "rehab assistance": "physio",
    "occupational therapist": "physio",
    "speech therapist": "physio",
    "staff nurse": "nurse",
    "assist nurse": "nurse",
    "head nurse": "nurse",
    "assist head nurse": "nurse",
    "nursing director": "nurse",
    "caregiver": "caregiver",
    "healthcare worker": "caregiver",
}


def _derive_role(report, access_role: str | None, position_name: str | None) -> str | None:
    r = (access_role or "").strip().upper()
    if r == "ADMIN":
        return "admin"
    if r == "MANAGEMENT":
        return "management"
    if position_name:
        role = POSITION_TO_ROLE.get(normalize_for_match(position_name))
        if role:
            return role
    report.unresolved("staff_role", f"Role={access_role!r} Position={position_name!r}")
    return None


def run(ctx: MigrationContext) -> None:
    rows = fetch_all(ctx.access_conn, "StaffList_tbl")
    ctx.report.inc("StaffList_tbl.source_rows", len(rows))

    idmap = None if ctx.dry_run else IdMap(ctx.pg_conn, ctx.branch_code, "StaffList_tbl")
    cur = ctx.pg_conn.cursor()

    for row in rows:
        source_id = row["StaffID"]
        branch_text = clean_scalar(row.get("Branch"))
        if branch_text != ctx.branch_code:
            continue  # this file may (eventually) hold more than one branch

        staff_name = clean_scalar(row.get("StaffName"))
        position_name = clean_scalar(row.get("Position"))
        status = clean_scalar(row.get("Status")) or "ACTIVE"
        status = "ACTIVE" if status.upper() == "ACTIVE" else "INACTIVE"

        if not staff_name:
            ctx.report.skip_row("StaffList_tbl", source_id, "missing StaffName")
            continue

        position_id = ctx.resolver.resolve("position", position_name)
        if position_id is None:
            ctx.report.skip_row("StaffList_tbl", source_id, f"unresolved position {position_name!r}")
            continue

        role = _derive_role(ctx.report, row.get("Role"), position_name)
        if role is None:
            ctx.report.skip_row("StaffList_tbl", source_id, "could not derive staff_role")
            continue

        if ctx.dry_run:
            ctx.report.note(
                f"[dry-run] tbl_staff insert: name={staff_name!r} position={position_name!r} "
                f"role={role!r} status={status!r}"
            )
            ctx.report.inc("tbl_staff.would_insert")
            # Placeholder id (source_id, not a real tbl_staff.id) so downstream
            # dry-run previews (ReviewBy/RegisteredBy lookups) can resolve names
            # for report purposes even though nothing was actually written.
            ctx.staff_by_name[normalize_for_match(staff_name)] = source_id
            continue

        existing_id = idmap.get(source_id)
        if existing_id:
            cur.execute(
                """
                update tbl_staff set branch_id=%s, staff_name=%s, position_id=%s,
                       role=%s, status=%s, updated_at=now()
                where id = %s
                """,
                (ctx.branch_id, staff_name, position_id, role, status, existing_id),
            )
            target_id = existing_id
        else:
            cur.execute(
                """
                insert into tbl_staff (branch_id, staff_name, position_id, role, status)
                values (%s, %s, %s, %s, %s)
                returning id
                """,
                (ctx.branch_id, staff_name, position_id, role, status),
            )
            target_id = cur.fetchone()[0]
            idmap.put(source_id, "tbl_staff", target_id)

        ctx.staff_by_name[normalize_for_match(staff_name)] = target_id
        ctx.report.inc("tbl_staff.upserted")

    ctx.commit()
