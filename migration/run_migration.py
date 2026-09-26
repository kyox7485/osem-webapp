"""CLI entrypoint for the Access -> Supabase migration.

Examples:
  python run_migration.py --dry-run --sample 20
  python run_migration.py --dry-run --tables branches,staff,residents
  python run_migration.py --commit --tables branches,staff,residents
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys

import psycopg2

from access_reader import open_access
from clinical_match import ResidentIndex, StaffIndex
from config import Config
from context import MigrationContext
from etl_id_map import ensure_schema
from lookups import LookupResolver
from report import Report

ALL_TABLES = ["branches", "staff", "residents"]

TRANSFORM_MODULES = {
    "branches": "transforms.branches",
    "staff": "transforms.staff",
    "residents": "transforms.residents",
}

# Clinical tables: imported against the residents/staff already migrated on
# 2026-09-15, so they run without the "branches"/"staff"/"residents" prefix and
# resolve identity from the live master list instead of re-deriving it.
#
# progress_notes_v2 supersedes the old transforms/progress_notes.py, which was
# deleted on 2026-09-26: it wrote past_med_condition, current_medication_regime
# and tca_notes, none of which exist on tbl_progress_notes, and it resolved
# residents through the older by-name index rather than the IC-first clinical
# matcher. It stayed in TRANSFORM_MODULES, so `--tables progress_notes` was
# still accepted and would have failed. tbl_ProgressNote is migrated by
# progress_notes_v2, below.
CLINICAL_TABLES = ["hospital_referrals", "progress_notes_v2", "physio_assessments", "nursing_chart"]

CLINICAL_MODULES = {
    "hospital_referrals": "transforms.hospital_referrals",
    "progress_notes_v2": "transforms.progress_notes_v2",
    "physio_assessments": "transforms.physio_assessments",
    "nursing_chart": "transforms.nursing_chart",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--commit", action="store_true")
    parser.add_argument("--sample", type=int, default=20, help="rows to preview per table in dry-run mode")
    parser.add_argument("--tables", type=str, default=",".join(ALL_TABLES))
    args = parser.parse_args()

    dry_run = args.dry_run
    requested_tables = [t.strip() for t in args.tables.split(",") if t.strip()]
    clinical_tables = [t for t in requested_tables if t in CLINICAL_MODULES]
    base_tables = [t for t in requested_tables if t in TRANSFORM_MODULES]
    unknown = [t for t in requested_tables if t not in TRANSFORM_MODULES and t not in CLINICAL_MODULES]
    if unknown:
        known = ", ".join(TRANSFORM_MODULES) + " | clinical: " + ", ".join(CLINICAL_MODULES)
        print(f"Unknown table(s): {', '.join(unknown)}. Known: {known}", file=sys.stderr)
        return 2

    cfg = Config.from_env()
    report = Report(branch_code=cfg.branch_code, dry_run=dry_run)
    ctx_staff = None  # StaffIndex, for the part-time section of the report

    with open_access(cfg.access_db_path) as access_conn:
        pg_conn = psycopg2.connect(cfg.pg_dsn, connect_timeout=15)
        pg_conn.autocommit = False
        try:
            # Pin the session timezone to Malaysia.
            #
            # Access hands back naive datetimes ("2023-08-23 23:41:54" -- it has
            # no timezone concept), and every target timestamp column is
            # `timestamptz`. Postgres therefore has to guess what zone those
            # wall-clock values are in, and it uses the SESSION TimeZone. That
            # was UTC, so every imported clinical timestamp landed 8 hours
            # early: a note Access recorded at 23:41 local was stored as
            # 15:41+00 and re-rendered in Malaysia as 23:41 -- but on
            # cross-day entries it displayed as the previous evening.
            #
            # Malaysia has no DST and has been UTC+8 since 1981, well before
            # any record in these tables, so a fixed offset is exact here.
            # `SET TIME ZONE` (rather than an offset) also makes the session
            # agree with how the app renders these values.
            with pg_conn.cursor() as cur:
                cur.execute("set time zone 'Asia/Kuala_Lumpur'")
            pg_conn.commit()

            # ensure_schema() runs `create schema/table if not exists` and
            # commits -- a real write to production. A dry run must not do that:
            # etl.id_map is only touched by the commit path, so dry runs have no
            # need for it. Only the commit run sets it up.
            if not dry_run:
                ensure_schema(pg_conn)
                pg_conn.commit()

            resolver = LookupResolver.load(pg_conn, report)
            branch_id = resolver.resolve_branch(cfg.branch_code)
            if branch_id is None and "branches" not in requested_tables:
                report.note(
                    f"branch code {cfg.branch_code!r} not found in tbl_branches yet -- "
                    "run with --tables branches first (or include it in --tables)."
                )
                return 3

            ctx = MigrationContext(
                access_conn=access_conn,
                pg_conn=pg_conn,
                resolver=resolver,
                report=report,
                branch_code=cfg.branch_code,
                branch_id=branch_id,
                dry_run=dry_run,
                sample=args.sample,
            )

            for table in base_tables:
                print(f"--- {table} ---")
                module_path = TRANSFORM_MODULES[table]
                module = __import__(module_path, fromlist=["run"])
                module.run(ctx)
                if table == "branches" and ctx.branch_id is None:
                    # the branch row may have just been created (or, in
                    # dry-run mode, would have been) -- reload the resolver's
                    # cache from the DB before re-resolving.
                    resolver.reload_branches(pg_conn)
                    ctx.branch_id = resolver.resolve_branch(cfg.branch_code)

            if clinical_tables:
                # Identity is resolved against the live master list, not
                # re-derived from Access: tbl_residents and tbl_staff were
                # migrated earlier and are authoritative from here on.
                print("--- clinical: resolving master lists ---")
                ctx.residents = ResidentIndex(pg_conn, branch_id, report)
                ctx.staff = StaffIndex(pg_conn, report)
                ctx_staff = ctx.staff

                for table in clinical_tables:
                    print(f"--- {table} ---")
                    module = __import__(CLINICAL_MODULES[table], fromlist=["run"])
                    module.run(ctx)

                print("--- part_time_staff ---")
                from transforms.part_time_staff import run as run_pt
                run_pt(ctx)

        except Exception:
            pg_conn.rollback()
            raise
        finally:
            pg_conn.close()

    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = f"migration_report_{cfg.branch_code}_{timestamp}.md"
    body = report.render_markdown()
    if ctx_staff is not None:
        extra = ctx_staff.part_time.render()
        if extra:
            body += "\n" + extra
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"\nReport written to {report_path}")
    print(f"Mode: {'DRY RUN' if dry_run else 'COMMIT'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
