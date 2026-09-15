"""Bookkeeping for idempotent re-runs: maps (source_table, source_id, branch_code)
-> the Postgres row it produced. Lives in its own `etl` schema, entirely separate
from the app schema in OSEM_schema.sql -- purely a migration-tool concern.
"""
from __future__ import annotations

import psycopg2

DDL = """
create schema if not exists etl;

create table if not exists etl.id_map (
  source_table   text not null,
  source_id      text not null,
  branch_code    text not null,
  target_table   text not null,
  target_id      bigint not null,
  created_at     timestamptz not null default now(),
  primary key (source_table, source_id, branch_code)
);
"""


def ensure_schema(conn: psycopg2.extensions.connection) -> None:
    cur = conn.cursor()
    cur.execute(DDL)


class IdMap:
    """In-memory cache backed by etl.id_map, loaded once per run per source table."""

    def __init__(self, conn: psycopg2.extensions.connection, branch_code: str, source_table: str):
        self.conn = conn
        self.branch_code = branch_code
        self.source_table = source_table
        cur = conn.cursor()
        cur.execute(
            "select source_id, target_id from etl.id_map where source_table = %s and branch_code = %s",
            (source_table, branch_code),
        )
        self._cache: dict[str, int] = {str(sid): tid for sid, tid in cur.fetchall()}

    def get(self, source_id: object) -> int | None:
        return self._cache.get(str(source_id))

    def put(self, source_id: object, target_table: str, target_id: int) -> None:
        cur = self.conn.cursor()
        cur.execute(
            """
            insert into etl.id_map (source_table, source_id, branch_code, target_table, target_id)
            values (%s, %s, %s, %s, %s)
            on conflict (source_table, source_id, branch_code)
            do update set target_table = excluded.target_table, target_id = excluded.target_id
            """,
            (self.source_table, str(source_id), self.branch_code, target_table, target_id),
        )
        self._cache[str(source_id)] = target_id
