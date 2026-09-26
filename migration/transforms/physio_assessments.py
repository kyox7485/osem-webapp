"""tbl_PhyIPProgressNote -> physio_assessments.

The Access table is a flat SOAP note: one row per treatment session, with a
setting (IP/OP), a free-text patient name, the treatment type, the hours
credited, and the therapist. physio_assessments is the table the app will use
going forward, so that is the target -- tbl_physio_progress_notes is left
empty and is NOT written to.

Decisions taken with the owner on 2026-09-26, all recorded in
docs/access-clinical-migration.md:

  * Out-of-branch rows (Dept = BAGAN / KOTA PERMAI / BM) are skipped. Case and
    spacing vary -- 'bagan', 'KOTAPERMAI', 'PERMAI' -- so the test is an
    explicit allow-list of {IP, OP} rather than a denylist.
  * care_setting follows Access's Dept column verbatim. 156 OP rows also match
    an AMN resident by name, but that is expected: a resident discharged from
    OSEM returns for physio as an outpatient. Access recorded them as OP and so
    do we; reclassifying them as IP on a name match would be a guess.
  * The outpatient list already exists and lives under branch AMP, not AMN.
    1,638 of 1,650 OP rows match a tbl_physio_op_patients record on IC. The
    cross-branch op_patient_id reference is the established pattern -- 2,845
    live rows already point at AMP's list -- so the migrated rows do the same.
  * Contentless rows (SOAP + Evaluation all empty, only name/timestamp present)
    are skipped, the same rule as tbl_ProgressNote. This is ~25% of the table.
  * treatment_compliance: Completion is 0/25/50/100 and is stored as '0%'/'25%'
    /'50%'/'100%'. The check constraint was widened to admit '0%' rather than
    discarding a real source value.
  * treatment_type: IPSubType is stored as-is. Four of its 20 values are not in
    the app's TreatmentType list and were added to the constraint. 'Others'
    (2 rows) means nothing and is stored NULL, reported rather than invented.

Idempotent via etl.id_map keyed on (source_table, source_id, branch_code).
"""
from __future__ import annotations

from collections import defaultdict

from psycopg2.extras import execute_values

from access_reader import fetch_all
from clinical_match import _norm, clean_ic, split_alias
from context import MigrationContext
from etl_id_map import IdMap
from multiselect import clean_scalar

TARGET = "physio_assessments"

# Access column -> physio_assessments column.
#
# physio_assessments has no `subjective` or `objective` column: the app's
# "Subjective Assessment" section collects Chief Complaint / Current History /
# Social History, and the analysis lives in `impression`. The SOAP mapping is
# therefore:
#   Subjective  -> current_history   (the patient's own report, which is what
#                                     current_history collects)
#   Objective   -> prepended to impression alongside Analysis (both are the
#                                     therapist's own findings/assessment)
#   Analysis    -> impression
# Chief Complaint, Past Medical History and Social History have no Access
# counterpart and stay NULL -- there is no legacy data behind them.
FIELD_MAP = {
    "Subjective": "current_history",
    "PlanAndIntervention": "plan_intervention",
    "Evaluation": "evaluation",
}

# Objective and Analysis both land in `impression`, so they are combined rather
# than mapped 1:1. Order is Objective then Analysis, matching SOAP order.
IMPRESSION_PARTS = ("Objective", "Analysis")

# Every Access column holding actual clinical content. IPSubType, CreditHour
# and Completion count as content even where they are thin, so a row is only
# contentless when the entire note is empty.
CONTENT_COLUMNS = (
    list(FIELD_MAP) + list(IMPRESSION_PARTS) + ["IPSubType", "CreditHour", "Completion"]
)

# IPSubType values with no meaning attached. 'Others' is Access's own
# catch-all bucket -- 2 rows, no indication of what was actually done -- so it
# is stored NULL and reported rather than mapped to a real treatment type.
NULL_TREATMENT_TYPES = {"others"}

# Completion -> treatment_compliance. The column takes percentages, Access
# stores bare numbers. Only 0/25/50/100 occur; '75%' has no source counterpart
# in this table but stays allowed in the constraint for the app.
COMPLETION_MAP = {"0": "0%", "25": "25%", "50": "50%", "100": "100%"}


def _care_setting(raw: str | None) -> str | None:
    """Access Dept -> care_setting, or None if this row is another branch's.

    An allow-list, not a denylist: 'BAGAN', 'bagan', 'KOTAPERMAI', 'PERMAI' and
    'BM' all appear and the spellings are not consistent, so listing the two
    settings we own is the only rule that stays correct as new branches appear.
    """
    value = (clean_scalar(raw) or "").strip().upper()
    return value if value in ("IP", "OP") else None


def _target_column_types(cur) -> dict[str, str]:
    """column_name -> data_type for the live target, used to cast VALUES lists."""
    cur.execute(
        "select column_name, data_type from information_schema.columns "
        "where table_schema = 'public' and table_name = %s",
        (TARGET,),
    )
    return {r[0]: r[1] for r in cur.fetchall()}


def _assert_target_columns(cur, needed) -> None:
    """Fail loudly if the target table lacks a column this transform writes.

    schema/001_init.sql is a SNAPSHOT and physio_assessments has already drifted
    from it in production (op_patient_id, care_setting and documented_by_other
    were added; resident_id lost its NOT NULL). Writing a column that isn't
    there aborts the whole run part-way through -- it cost a real commit on
    2026-09-26, where `subjective` had been mapped from Access without ever
    being checked against the live table. Better to check once, up front.
    """
    cur.execute(
        "select column_name from information_schema.columns "
        "where table_schema = 'public' and table_name = %s",
        (TARGET,),
    )
    present = {r[0] for r in cur.fetchall()}
    missing = sorted(needed - present)
    if missing:
        raise RuntimeError(
            f"{TARGET} is missing column(s) this transform writes: {', '.join(missing)}. "
            f"Live columns: {', '.join(sorted(present))}. The transform must be "
            f"reconciled with the live schema before running."
        )


def run(ctx: MigrationContext) -> None:
    rows = fetch_all(ctx.access_conn, "tbl_PhyIPProgressNote")
    ctx.report.inc("tbl_PhyIPProgressNote.source_rows", len(rows))

    idmap = None if ctx.dry_run else IdMap(ctx.pg_conn, ctx.branch_code, "tbl_PhyIPProgressNote")
    cur = ctx.pg_conn.cursor()

    _assert_target_columns(cur, {
        "branch_id", "care_setting", "resident_id", "op_patient_id",
        "entry_timestamp", "treatment_type", "credit_hours",
        "current_history", "impression", "plan_intervention", "evaluation",
        "treatment_compliance", "total_score", "documented_by",
    })

    # tbl_physio_op_patients across ALL branches: the AMN outpatient list does
    # not exist, but AMP's does and holds these patients. Cross-branch
    # op_patient_id is already the norm in this table (2,845 live AMP rows), so
    # restricting the lookup to ctx.branch_id would resolve nothing.
    #
    # The IC is normalised on BOTH sides: clean_ic strips dashes, but the live
    # rows store some ICs with dashes ('431120-08-6000') while Access stores them
    # bare, so an unnormalised index misses those patients. FOONG SIEW CHAN also
    # has two rows sharing one raw IC; a setdefault keeps the first, which is the
    # same de-duplication a person wants here.
    op_by_ic: dict[str, int] = {}
    ic_of: dict[int, str] = {}
    op_by_name: dict[str, set[int]] = defaultdict(set)
    cur.execute(
        "select id, patient_name, ic_number from tbl_physio_op_patients"
    )
    for pid, name, ic in cur.fetchall():
        ic = clean_ic(ic)
        if ic:
            ic_of[pid] = ic
            op_by_ic.setdefault(ic, min(op_by_ic.get(ic, pid), pid))
        if name:
            op_by_name[_norm(name)].add(pid)
    ctx.report.inc("physio_op_patients.indexed", len(op_by_ic))

    # Rows are accumulated and written in batches at the end rather than one
    # statement per row -- see _flush for why.
    to_insert: list[tuple] = []
    to_update: list[tuple] = []

    for row in rows:
        source_id = row["ID"]

        setting = _care_setting(row.get("Dept"))
        if setting is None:
            ctx.report.skip_row(
                "tbl_PhyIPProgressNote", source_id,
                f"out-of-branch Dept {clean_scalar(row.get('Dept'))!r}",
            )
            continue

        # Same rule as tbl_ProgressNote: a row with only an identity and a
        # timestamp is an artefact of Access capturing the form, not a session.
        if not any(clean_scalar(row.get(col)) for col in CONTENT_COLUMNS):
            ctx.report.skip_row(
                "tbl_PhyIPProgressNote", source_id,
                "no clinical content (only name/timestamp populated)",
            )
            continue

        # entry_timestamp is NOT NULL on physio_assessments. Three housecall
        # rows for TAM MEI LAN (IDs 8394 / 8558 / 8599) carry real treatment
        # content but no DateAndTime. Per owner decision they are skipped rather
        # than given a fabricated date -- stamping them with the migration run
        # date would put them at the top of her chart claiming they happened
        # today, which is worse than losing them. Checked after the contentless
        # test so a genuinely empty undated row is not reported twice.
        if not row.get("DateAndTime"):
            ctx.report.skip_row(
                "tbl_PhyIPProgressNote", source_id,
                "no DateAndTime (entry_timestamp is NOT NULL; not fabricating one)",
            )
            continue

        if setting == "IP":
            resident_id, reason = ctx.residents.resolve(row.get("Name"), row.get("IC"))
            if resident_id is None:
                ctx.report.skip_row("tbl_PhyIPProgressNote", source_id, reason)
                continue
            op_patient_id = None
        else:
            resident_id = None
            op_patient_id = _resolve_op(row, op_by_ic, op_by_name, ic_of)
            if op_patient_id is None:
                ctx.report.skip_row(
                    "tbl_PhyIPProgressNote", source_id,
                    f"outpatient not in tbl_physio_op_patients (name={clean_scalar(row.get('Name'))!r}, "
                    f"IC={clean_scalar(row.get('IC'))!r})",
                )
                continue

        treatment_type = clean_scalar(row.get("IPSubType"))
        if treatment_type and treatment_type.strip().lower() in NULL_TREATMENT_TYPES:
            ctx.report.note(
                f"tbl_PhyIPProgressNote {source_id}: IPSubType {treatment_type!r} is a "
                "catch-all with no meaning attached -- treatment_type stored NULL, "
                "not mapped to a real treatment type."
            )
            treatment_type = None

        completion = (clean_scalar(row.get("Completion")) or "").strip()
        values: dict[str, object] = dict(
            branch_id=ctx.branch_id,
            care_setting=setting,
            resident_id=resident_id,
            op_patient_id=op_patient_id,
            entry_timestamp=row.get("DateAndTime"),
            treatment_type=treatment_type,
            credit_hours=_numeric(row.get("CreditHour")),
            treatment_compliance=COMPLETION_MAP.get(completion),
            documented_by=ctx.staff.resolve(row.get("Therapist"), "tbl_PhyIPProgressNote"),
            # Access has no examination / body-chart / functional / balance /
            # coordination data for these rows. total_score is computed by the
            # app from physio_examinations; there are none, so it stays NULL
            # rather than being invented as 0.
            total_score=None,
        )
        for src_col, dst_col in FIELD_MAP.items():
            values[dst_col] = clean_scalar(row.get(src_col))
        values["impression"] = _combine(row, IMPRESSION_PARTS)

        if not ctx.dry_run:
            existing = idmap.get(source_id)
            if existing is not None:
                to_update.append((source_id, existing, values))
            else:
                to_insert.append((source_id, values))

        ctx.report.inc(f"{TARGET}.imported")
        ctx.report.inc(f"physio_assessments.{setting}")

    if not ctx.dry_run:
        _flush(cur, to_insert, to_update, idmap, _target_column_types(cur))
    ctx.commit()


# Rows per statement. Large enough to amortise the round trip, small enough
# that a failure names a manageable range.
BATCH = 500


def _flush(cur, to_insert, to_update, idmap, types) -> None:
    """Write the accumulated rows in batched multi-row statements.

    The per-row `insert ... returning id` this replaces cost a full network
    round trip per row: the first attempt took over 25 minutes and died at row
    10,402 after all that time. Batching the target-table write brought the
    successful run down to 16m30s for 10,630 rows, and all but seconds of that
    was `IdMap.put()` doing one upsert per row -- now batched too, via
    put_many()/flush() at the end of this function. tbl_NursingChart's 85,686
    rows should land in roughly a minute.

    `etl.id_map` is written in the same pass: it is upserted with the ids the
    batch returned, so a re-run takes the UPDATE path and nothing duplicates.
    The mapping goes through IdMap.put_many()/flush() rather than put() per row
    -- see etl_id_map.py for why.
    """
    columns = list(to_insert[0][1].keys()) if to_insert else list(to_update[0][2].keys())
    cols_sql = ", ".join(columns)
    id_pairs: list[tuple[str, str, int]] = []

    if to_insert:
        for start in range(0, len(to_insert), BATCH):
            chunk = to_insert[start:start + BATCH]
            execute_values(
                cur,
                f"insert into {TARGET} ({cols_sql}) values %s returning id",
                [tuple(row.values()) for _, row in chunk],
                page_size=BATCH,
            )
            returned = cur.fetchall()
            if len(returned) != len(chunk):
                raise RuntimeError(
                    f"insert returned {len(returned)} ids for {len(chunk)} rows; "
                    f"id_map cannot be trusted for this batch"
                )
            id_pairs.extend(
                (str(source_id), TARGET, target_id)
                for (source_id, _), (target_id,) in zip(chunk, returned)
            )

    if to_update:
        # UPDATE ... FROM (VALUES ...) is the batched form of a per-row UPDATE.
        # Every parameter in a VALUES list is inferred as text, so each value
        # needs an explicit cast back to its real column type -- without this
        # Postgres rejects it with DatatypeMismatch on the first bigint.
        def cast(col: str) -> str:
            return f"cast(%s as {_PG_CASTS.get(types.get(col, 'text'), 'text')})"

        marks = ", ".join(cast(c) for c in columns)
        set_sql = ", ".join(f"{c} = v.{c}" for c in columns)
        value_cols = ", ".join(["target_id"] + columns)
        for start in range(0, len(to_update), BATCH):
            chunk = to_update[start:start + BATCH]
            # Built per chunk: a VALUES list is positional, so a fixed-size
            # template would need parameters for rows this batch doesn't have.
            values_sql = ", ".join(f"(%s, {marks})" for _ in chunk)
            params = [
                (target_id, *tuple(v.values()))
                for _source_id, target_id, v in chunk
            ]
            cur.execute(
                f"update {TARGET} as t set {set_sql} "
                f"from (values {values_sql}) as v({value_cols}) "
                f"where t.id = v.target_id",
                [p for row in params for p in row],
            )

    # One batched upsert for the whole run, rather than one round trip per row.
    if idmap is not None and id_pairs:
        idmap.put_many(id_pairs)
        idmap.flush()


# information_schema data_type -> the type to cast back to in a VALUES list.
_PG_CASTS = {
    "bigint": "bigint",
    "integer": "int",
    "numeric": "numeric",
    "boolean": "boolean",
    "timestamp with time zone": "timestamptz",
    "text": "text",
}


def _resolve_op(row, op_by_ic, op_by_name, ic_of) -> int | None:
    """Outpatient identity. IC wins; a name matching several *different* people
    is a miss.

    Same principle as ResidentIndex -- a session on the wrong patient's chart is
    worse than a missing one -- with the AMP shared list in place of an
    AMN-local one. Two wrinkles specific to this list:

      * Both sides of the IC comparison are normalised, so an IC stored with
        dashes in the database ('431120-08-6000') still matches a bare one.
      * The outpatient list has the SAME duplicate-registration problem as
        tbl_residents: TAN HUM MENG (5) and TAN HUN MENG (8) share IC
        690812075181, and ROHANA (106) and ROHANA BINTI ZAKARIA (105) share
        601123015936. An IC match pointing at one row while the name points at
        the other is not a conflict between people -- it is one person entered
        twice. The IC wins, and the id_map-free rule is the same one the owner
        approved for residents: same IC means the same person.
    """
    ic = clean_ic(row.get("IC"))
    by_ic = op_by_ic.get(ic) if ic else None

    name = clean_scalar(row.get("Name")) or ""
    _, alias = split_alias(name)
    candidates: set[int] = set()
    for key in {name, alias or ""}:
        if key:
            candidates |= op_by_name.get(_norm(key), set())
    by_name = next(iter(candidates)) if len(candidates) == 1 else None

    # IC vs name disagreement is tolerated only when every named candidate
    # carries the same IC the row did -- i.e. one person, entered twice. A name
    # pointing at a genuinely different person is still refused.
    if by_ic and by_name and by_ic != by_name:
        if ic and candidates and all(ic_of.get(c) == ic for c in candidates):
            return by_ic
        return None
    if by_ic:
        return by_ic
    if by_name:
        return by_name
    return None


def _norm_name(name: str) -> str:
    return _norm(name)


def _combine(row, columns) -> str | None:
    """Join several Access text columns into one target column, in order.

    Blank parts are dropped so a row with only an Objective does not gain a
    stray label. Labels are prefixed because Objective and Analysis are
    different things and a reader should not have to guess which is which.
    """
    parts: list[str] = []
    for col in columns:
        text = clean_scalar(row.get(col))
        if text:
            parts.append(f"{col}:\n{text}")
    return "\n\n".join(parts) if parts else None


def _numeric(raw) -> float | None:
    """Access stores every number as text. Junk becomes NULL rather than 0."""
    text = (clean_scalar(raw) or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None
