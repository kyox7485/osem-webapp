"""Bookkeeping for idempotent re-runs: maps (source_table, source_id, branch_code)
-> the Postgres row it produced. Lives in its own `etl` schema, entirely separate
from the app schema in OSEM_schema.sql -- purely a migration-tool concern.
"""
from __future__ import annotations

import psycopg2
from psycopg2.extras import execute_values

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

# Rows per statement for the batched id_map write. Matches _flush()'s BATCH in
# transforms/physio_assessments.py -- the two are written together.
BATCH = 500


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
        # Written by flush(), not by put() -- see put_many() for why.
        self._pending: list[tuple[str, str, int]] = []

    def get(self, source_id: object) -> int | None:
        return self._cache.get(str(source_id))

    def put(self, source_id: object, target_table: str, target_id: int) -> None:
        """Record one mapping immediately -- one round trip.

        Deliberately still eager. Seven transforms call this and never
        `flush()`, so deferring the write here would silently stop their
        id_map rows from being persisted at all. `put_many()` is the batched
        path; transforms opt into it explicitly.
        """
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

    def put_many(self, pairs) -> None:
        """Record many (source_id, target_table, target_id) at once.

        `put()` is one round trip per row, which is the whole remaining cost of
        a run once the target table is batched: the committed physio migration
        spent 16m30s on 10,630 rows and all of it but seconds was here. Batched
        the same way, 500 rows per statement.

        The ON CONFLICT clause is the same upsert `put()` used, so this is
        idempotent -- re-running rewrites the mapping in place and inserts
        nothing new, which is what the physio re-run verified. The in-memory
        cache is still updated, because `get()` reads it during the row loop
        that is about to run for the next batch.
        """
        pairs = list(pairs)
        if not pairs:
            return
        for source_id, target_table, target_id in pairs:
            self._cache[str(source_id)] = target_id
        self._pending.extend(
            (str(source_id), target_table, target_id)
            for source_id, target_table, target_id in pairs
        )

    def flush(self) -> int:
        """Write everything queued by put()/put_many(). Returns rows written.

        Called once at the end of a transform. Safe to call when nothing is
        queued, and safe to call more than once -- the queue is cleared as it
        is written.
        """
        if not self._pending:
            return 0
        cur = self.conn.cursor()
        try:
            written = 0
            for start in range(0, len(self._pending), BATCH):
                chunk = self._pending[start:start + BATCH]
                execute_values(
                    cur,
                    """
                    insert into etl.id_map
                        (source_table, source_id, branch_code, target_table, target_id)
                    values %s
                    on conflict (source_table, source_id, branch_code)
                    do update set target_table = excluded.target_table,
                                  target_id = excluded.target_id
                    """,
                    [
                        (self.source_table, source_id, self.branch_code, target_table, target_id)
                        for source_id, target_table, target_id in chunk
                    ],
                    page_size=BATCH,
                )
                written += len(chunk)
            return written
        finally:
            self._pending.clear()

