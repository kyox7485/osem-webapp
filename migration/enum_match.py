"""Matching against fixed CHECK-constraint enums (not FK lookup tables) --
e.g. tbl_residents.transfer_from. Exact/case-insensitive match only; no
fuzzy guessing for these, since a wrong guess writes directly into a
clinical/administrative field with no lookup id to audit later. Anything
that doesn't match exactly is logged and left null.
"""
from __future__ import annotations

from report import Report


def resolve_checked_enum(
    report: Report, list_name: str, raw: str | None, allowed: list[str]
) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text.lower() == "none":
        return None
    if text in allowed:
        return text
    for a in allowed:
        if a.lower() == text.lower():
            report.fuzzy(list_name, text, a)
            return a
    report.unresolved(list_name, text)
    return None
