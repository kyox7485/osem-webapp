from __future__ import annotations

from dataclasses import dataclass, field

import psycopg2
import pyodbc

from lookups import LookupResolver
from report import Report


@dataclass
class MigrationContext:
    access_conn: pyodbc.Connection
    pg_conn: psycopg2.extensions.connection
    resolver: LookupResolver
    report: Report
    branch_code: str
    branch_id: int | None
    dry_run: bool
    sample: int
    # staff_name (as it appears in Access free-text fields) -> tbl_staff.id.
    # Populated by transforms/staff.py; consumed by every transform that has
    # a "ReviewBy"/"RegisteredBy"/"CreatedBy"-style free-text staff name.
    staff_by_name: dict[str, int] = field(default_factory=dict)
    # ResidentID (Access) -> tbl_residents.id, and resident_name -> id, for
    # transforms keyed by name only (tbl_NursingChart, tbl_ProgressNote have
    # ResidentID; some others only have the name text).
    resident_id_by_source_id: dict[str, int] = field(default_factory=dict)
    resident_id_by_name: dict[str, int] = field(default_factory=dict)
    # Clinical-table migration: tbl_residents as the master list, tbl_staff
    # across all branches, and the part-time candidate registry. Populated by
    # run_migration from the live DB rather than by an earlier transform,
    # because the master list already exists -- these tables are imported
    # against the residents/staff migrated on 2026-09-15, not re-derived.
    residents: object = None   # clinical_match.ResidentIndex
    staff: object = None       # clinical_match.StaffIndex
    # part-time staff name -> StaffID, populated late in the run by
    # transforms/part_time_staff.py so already-written clinical rows can have
    # reviewed_by back-filled. Kept on the context rather than returned.
    _backfilled_staff: dict[str, str] = field(default_factory=dict)

    def commit(self) -> None:
        if not self.dry_run:
            self.pg_conn.commit()
