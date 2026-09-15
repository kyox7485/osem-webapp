"""Parsing helpers for the delimited free-text fields Access stores multi-select
data in (confirmed by inspecting real data — these are NOT true Access
multi-valued columns, just ';'-joined text, often prefixed with a stray
'\\r\\n' and sometimes carrying a 'With Assistance | ' style prefix before the
activity list).
"""
from __future__ import annotations

import re

_NULL_TOKENS = {"", "none", "n/a", "na", "-"}


def split_multiselect(raw: str | None) -> list[str]:
    """'\\r\\nWith Assistance | BO @ Commode; Change Diapers' -> ['BO @ Commode', 'Change Diapers']

    Strips a leading assistance-level tag (text before the last '|'), splits
    the remainder on ';', trims whitespace, and drops empty/'None' tokens.
    Order and duplicates are preserved (dedup happens at the resolver level).
    """
    if raw is None:
        return []
    text = str(raw).replace("\r\n", "\n").strip()
    if "|" in text:
        text = text.rsplit("|", 1)[-1]
    tokens = [t.strip() for t in text.split(";")]
    return [t for t in tokens if t.lower() not in _NULL_TOKENS]


def extract_assistance_level(raw: str | None) -> str | None:
    """Pulls 'By Self' / 'With Assistance' off the front of a hygiene field, if present."""
    if raw is None:
        return None
    text = str(raw).replace("\r\n", "\n").strip()
    if "|" not in text:
        return None
    prefix = text.split("|", 1)[0].strip()
    if prefix in ("By Self", "With Assistance"):
        return prefix
    return None


def clean_scalar(raw: str | None) -> str | None:
    """Trims a plain text field and normalizes 'None'-as-string to real None."""
    if raw is None:
        return None
    text = str(raw).strip()
    return text if text and text.lower() not in _NULL_TOKENS else None


_WS_RE = re.compile(r"\s+")


def normalize_for_match(text: str) -> str:
    """Lowercase + strip periods + collapse whitespace, for fuzzy/loose lookup
    matching (periods stripped because real data is inconsistent about them
    in titles, e.g. 'Dr Irene' vs 'Dr. Irene')."""
    return _WS_RE.sub(" ", text.replace(".", " ")).strip().lower()
