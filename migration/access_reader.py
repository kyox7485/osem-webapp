"""Read-only access to the source .accdb file."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import pyodbc


@contextmanager
def open_access(path: str) -> Iterator[pyodbc.Connection]:
    """Opens the Access file strictly read-only. Never writes to it."""
    conn_str = r"Driver={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=" + path + ";"
    conn = pyodbc.connect(conn_str, readonly=True, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


def fetch_all(conn: pyodbc.Connection, table: str, columns: list[str] | None = None) -> list[dict]:
    """Fetch every row from `table` as a list of dicts keyed by column name.

    Access column names may contain spaces (e.g. "Fluid Input") so they're
    always bracket-quoted.
    """
    col_sql = ", ".join(f"[{c}]" for c in columns) if columns else "*"
    cur = conn.cursor()
    cur.execute(f"select {col_sql} from [{table}]")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def row_count(conn: pyodbc.Connection, table: str) -> int:
    cur = conn.cursor()
    cur.execute(f"select count(*) from [{table}]")
    return cur.fetchone()[0]


def distinct_values(conn: pyodbc.Connection, table: str, column: str) -> list[str]:
    cur = conn.cursor()
    cur.execute(f"select distinct [{column}] from [{table}]")
    return sorted({str(r[0]) for r in cur.fetchall() if r[0] is not None})
