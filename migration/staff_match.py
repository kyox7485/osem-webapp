"""Resolves free-text staff names (Access 'ReviewBy'/'RegisteredBy' columns)
against the staff migrated earlier in the same run.

Real data showed two recurring patterns beyond a plain name:
  - a ' - <Position>' suffix appended, e.g. 'Merawati - Head Nurse'
  - an inconsistently-applied title, e.g. 'Dr Irene' / 'Dr. Irene' / 'Irene'

Handled here: strip a ' - ...' suffix, then try an exact normalized match,
then (only if exactly one candidate fits, to avoid misattributing a clinical
entry to the wrong person) a whole-word suffix match for a dropped/added
title. Anything still ambiguous or unmatched is logged and left null -- no
fuzzy/typo matching on names, that's too risky for who-reviewed-what.
"""
from __future__ import annotations

from context import MigrationContext
from multiselect import clean_scalar, normalize_for_match


def resolve_staff_name(ctx: MigrationContext, list_name: str, raw_name: str | None) -> int | None:
    name = clean_scalar(raw_name)
    if name is None:
        return None

    candidate = name.split(" - ", 1)[0].strip()
    norm = normalize_for_match(candidate)
    if not norm:
        return None

    staff_id = ctx.staff_by_name.get(norm)
    if staff_id is not None:
        return staff_id

    matches = {
        sid
        for staff_norm, sid in ctx.staff_by_name.items()
        if staff_norm.endswith(" " + norm) or staff_norm.startswith(norm + " ")
    }
    if len(matches) == 1:
        (staff_id,) = matches
        ctx.report.fuzzy(list_name, name, f"staff_id={staff_id}")
        return staff_id

    reason = name if len(matches) == 0 else f"{name} (ambiguous: {len(matches)} candidates)"
    ctx.report.unresolved(list_name, reason)
    return None
