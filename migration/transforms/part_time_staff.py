"""Reports staff names that appear on clinical records but matched nothing.

Runs LAST, after the clinical transforms have registered every unmatched name.

It used to CREATE a tbl_staff row for every such name in a commit run and then
back-fill reviewed_by. Both are gone (2026-09-26):

  * Blind creation turned typos and two-person entries ('mera', 'Zulaikha,
    dewi', 'm,ard') into fake staff records. Creation now happens only for
    names the owner approved one by one (clinical_match.APPROVED_PART_TIME),
    inline in StaffIndex, so the clinical row gets its StaffID as it is written
    and no back-fill is needed.
  * The back-fill updated EVERY row with an empty attribution column to each
    new StaffID in turn -- not just that person's rows -- and selected a
    RID/ID column the target tables do not have. It never ran only because no
    part-time staff had been created yet.

Every remaining candidate is listed in the report ("Unmatched staff names
awaiting review") and left unattributed in both modes.
"""
from __future__ import annotations

from context import MigrationContext


def run(ctx: MigrationContext) -> None:
    candidates = ctx.staff.part_time.candidates()
    if not candidates:
        return
    ctx.report.inc("part_time_staff.unmatched_pending_review", len(candidates))
    ctx.report.note(
        f"{len(candidates)} unmatched staff name(s) left unattributed -- see "
        "'Unmatched staff names awaiting review'. Nothing is created for them."
    )
