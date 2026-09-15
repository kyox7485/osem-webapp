"""tbl_Branches -> tbl_branches. Idempotent upsert by unique `code`."""
from __future__ import annotations

from access_reader import fetch_all
from context import MigrationContext
from multiselect import clean_scalar


def run(ctx: MigrationContext) -> None:
    rows = fetch_all(ctx.access_conn, "tbl_Branches")
    ctx.report.inc("tbl_Branches.source_rows", len(rows))

    cur = ctx.pg_conn.cursor()
    for row in rows:
        code = clean_scalar(row.get("BranchCode"))
        name = clean_scalar(row.get("NursingHomeName"))
        if not code or not name:
            ctx.report.skip_row("tbl_Branches", row.get("BranchID"), "missing BranchCode or NursingHomeName")
            continue

        values = (
            name,
            code,
            clean_scalar(row.get("BranchContact")),
            clean_scalar(row.get("Address")),
            clean_scalar(row.get("BranchLocale")),
        )

        if ctx.dry_run:
            ctx.report.note(f"[dry-run] tbl_branches upsert: code={code!r} name={name!r}")
            continue

        cur.execute(
            """
            insert into tbl_branches (name, code, contact, address, locale)
            values (%s, %s, %s, %s, %s)
            on conflict (code) do update set
              name = excluded.name, contact = excluded.contact,
              address = excluded.address, locale = excluded.locale,
              updated_at = now()
            returning id
            """,
            values,
        )
        ctx.report.inc("tbl_branches.upserted")

    ctx.commit()
