"""Read-only access to the source .accdb file, or to the .xlsx
exports used when only the exports are available (e.g. a branch
whose .accdb was never handed over).

The xlsx exports carry Access's own quirks: a stray duplicate header
row inside the data, and '_x000d_' wherever Access encoded a
carriage return. Both are normalised away here so every consumer
sees the same shape `fetch_all()` gives the .accdb path.
"""
from __future__ import annotations

import os
import re
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


# --- xlsx exports -----------------------------------------------------------

# Access encoded a carriage return in some exported cells as the literal
# '_x000d_' (an ODBC escape that the exporter never unescaped). Stripped
# here so clinical text keeps its newlines and nothing else.
_X000D_RE = re.compile(r"_x000d_")


def _clean_cell(value):
    if isinstance(value, str):
        return _X000D_RE.sub("", value).strip() or None
    return value


def fetch_all_xlsx(path: str, sheet: str | None = None) -> list[dict]:
    """Fetch every row from an xlsx export as a list of dicts.

    Same shape as fetch_all(): dicts keyed by column name. openpyxl
    already returns datetimes as datetime objects and numbers as
    numbers, so timestamps flow through untouched.

    Handles the two artefacts the exports carry: a duplicate header
    row embedded in the data (every cell equals the column name), and
    '_x000d_' carriage-return escapes.
    """
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb[sheet] if sheet else wb.worksheets[0]
        rows = ws.iter_rows(values_only=True)
        header = [str(c).strip() if c is not None else "" for c in next(rows)]
        out: list[dict] = []
        for row in rows:
            values = [_clean_cell(v) for v in row]
            if all(v is None for v in values):
                continue
            # A repeated header row: every cell equals its column name.
            if all(
                v is not None and str(v).strip().upper() == h.upper()
                for v, h in zip(values, header) if h
            ):
                continue
            out.append(dict(zip(header, values)))
        return out
    finally:
        wb.close()


def fetch_table_xlsx(xlsx_dir: str, table: str) -> list[dict]:
    """Fetch `table` from the xlsx export that holds it.

    File names are '<table> - <branch>.xlsx' (e.g. 'tbl_ProgressNote -
    bm.xlsx'); the branch suffix is not part of the table name, so the
    export is located by prefix match.
    """
    prefix = table + " - "
    for name in sorted(os.listdir(xlsx_dir)):
        if name.lower().startswith(prefix.lower()) and name.lower().endswith(".xlsx"):
            return fetch_all_xlsx(os.path.join(xlsx_dir, name))
    raise FileNotFoundError(f"no xlsx export for {table!r} in {xlsx_dir!r}")

