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
from config import Config
from context import MigrationContext
from etl_id_map import ensure_schema
from lookups import LookupResolver
from report import Report

ALL_TABLES = ["branches", "staff", "residents", "progress_notes"]

TRANSFORM_MODULES = {
    "branches": "transforms.branches",
    "staff": "transforms.staff",
    "residents": "transforms.residents",
    "progress_notes": "transforms.progress_notes",
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
    for t in requested_tables:
        if t not in TRANSFORM_MODULES:
            print(f"Unknown table '{t}'. Known: {', '.join(TRANSFORM_MODULES)}", file=sys.stderr)
            return 2

    cfg = Config.from_env()
    report = Report(branch_code=cfg.branch_code, dry_run=dry_run)

    with open_access(cfg.access_db_path) as access_conn:
        pg_conn = psycopg2.connect(cfg.pg_dsn, connect_timeout=15)
        pg_conn.autocommit = False
        try:
            ensure_schema(pg_conn)
            pg_conn.commit()

            resolver = LookupResolver.load(pg_conn, report)
            branch_id = resolver.resolve_branch(cfg.branch_code)
            if branch_id is None and "branches" not in requested_tables:
                report.note(
                    f"branch code {cfg.branch_code!r} not found in tbl_branches yet -- "
                    "run with --tables branches first (or include it in --tables)."
                )

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

            for table in requested_tables:
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

        except Exception:
            pg_conn.rollback()
            raise
        finally:
            pg_conn.close()

    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = f"migration_report_{cfg.branch_code}_{timestamp}.md"
    report.write(report_path)
    print(f"\nReport written to {report_path}")
    print(f"Mode: {'DRY RUN' if dry_run else 'COMMIT'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
