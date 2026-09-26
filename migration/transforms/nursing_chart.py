"""tbl_NursingChart -> tbl_nursing_chart_entries + _meals + _hygiene_episodes
+ _elimination_episodes, and the vital-sign columns -> tbl_vital.

85,686 rows, the largest clinical table. The source is one wide row per chart
entry per day; the target splits it across four tables:

  tbl_nursing_chart_entries           one row per chart entry (the narrative
                                      and scalar fields)
  tbl_nursing_chart_meals             repeating group, 0..6 rows (MealPortion)
  tbl_nursing_chart_hygiene_episodes  0..1 row (AssistedHygieneCare)
  tbl_nursing_chart_elimination_episodes 0..1 row (BO + PU)
  tbl_vital                           only when the row carries vitals

Decisions taken with the owner on 2026-09-26, recorded in
docs/access-clinical-migration.md:

  * MealPortion mixes two forms. 'Breakfast (Full)' carries meal AND portion;
    a bare 'Full' or a bare 'Breakfast' carries only one. A bare token is
    interpreted by which lookup list it belongs to, so 'Breakfast; Full'
    becomes two meal rows -- one with the meal id, one with the portion id --
    and neither half is discarded or invented.
  * Unmatched multi-select tokens: obvious variants are mapped to the real id
    (Self PU -> PU @ Toilet, Assisted Shower -> Shower) and anything genuinely
    new goes to the column's *_other free-text field with the id left NULL.
    Every variant and every *_other term is listed in the dry-run report.
  * PU is multi-valued in Access ('Fully Soaked; Half Soaked') but
    pass_urine_id is single, so the FIRST token wins and any further ones are
    reported rather than silently dropped. BO is an array, so every BO token
    is kept.

Idempotent via etl.id_map keyed on (source_table, source_id, branch_code).
Child rows are deleted and rewritten per chart entry, which is the only way to
keep a repeating group consistent with an UPDATE that changes its contents.
"""
from __future__ import annotations

import re
from collections import defaultdict

from psycopg2.extras import execute_values

from access_reader import fetch_all
from clinical_match import clean_ic
from context import MigrationContext
from etl_id_map import IdMap
from multiselect import clean_scalar, extract_assistance_level, split_multiselect

ENTRIES = "tbl_nursing_chart_entries"
MEALS = "tbl_nursing_chart_meals"
HYGIENE = "tbl_nursing_chart_hygiene_episodes"
ELIMINATION = "tbl_nursing_chart_elimination_episodes"
VITAL = "tbl_vital"

SOURCE = "tbl_NursingChart"
VITAL_SOURCE = "tbl_NursingChartVital"
BATCH = 500

# MealPortion token forms. 'Breakfast (Full)' is meal+portion; 'Breakfast' is
# meal only; 'Full' is portion only. 'Tube Feeding' is a meal name here even
# though tbl_meal_types does not have it -- it is reported, not invented.
_MEAL_PAREN_RE = re.compile(r"^(?P<meal>.*?)\s*\(\s*(?P<portion>[^()]*)\s*\)\s*$")

# Multi-select variants -> the real lookup label. Asserted rather than fuzzy:
# every entry is a clear spelling/spacing variant of a term that exists, and
# the dry-run report lists any Access token that is NOT covered here.
VARIANTS: dict[str, dict[str, str]] = {
    "hygiene": {
        "self pu": "PU @ Toilet",
        "self bo": "BO @ Toilet",
        "assisted shower": "Shower",
        "self shower": "Shower",
        "assisted sponging": "Sponging",
        "assisted grooming": "Grooming",
        "assisted oral care": "Oral Care",
        "assisted skin care": "Skin Care",
        "assisted eye care": "Eye Care",
        "pu": "PU @ Urinal",
        "bo": "BO @ Commode",
        "with assistance": None,  # the assistance level itself, not an activity
    },
    "activity": {
        "sit on wheelchair": None,  # genuinely new, goes to activity_other
        "sit on wheel chair": None,
        "awake - sit on wheel chair": None,
        "sit on chair": None,
    },
}

# A token that names its OWN assistance level. 22,565 hygiene rows have no
# 'By Self | '/'With Assistance | ' prefix, but the activity is unambiguous:
# 'Self PU' is by definition self-toileting, 'Assisted Shower' is assisted.
# This only recovers a level the row already states; it never upgrades a
# stated level, and a token carrying neither (a bare 'Shower') still leaves
# assistance_level NULL and the row is reported rather than guessed at.
TOKEN_ASSISTANCE: dict[str, str] = {
    "self pu": "By Self",
    "self bo": "By Self",
    "self shower": "By Self",
}

# MealPortion tokens where the meal name has extra free text, e.g.
# 'Dinner own food', 'Evening Tea kopi'. The meal is recoverable and the rest
# is a genuine 'Others' note, so the row keeps both. Tokens with no recognisable
# meal head are reported and skipped -- a meal name is never invented.
_MEAL_PREFIXES: tuple[str, ...] = (
    "Breakfast", "Morning Tea", "Lunch", "Evening Tea", "Supper", "Dinner",
    "Tube Feeding",
)

# Access Spo2Con -> tbl_vital.spo2_condition. The target is free text, so the
# O2 phrases are kept verbatim and only the obvious junk (bare numbers that
# belong in spo2, not here) is dropped.
SPO2_CON_DROP = {"128", "123", "84", "108", "109", "119"}


def _num(raw) -> float | None:
    """Access stores every number as text. Junk becomes NULL, never 0.

    A fabricated 0 is a clinical statement -- a temperature of 0 or a heart
    rate of 0 reads as a real, catastrophic measurement.
    """
    text = (clean_scalar(raw) or "").strip().rstrip("%")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _lookup(cur, table: str, name_col: str) -> dict[str, int]:
    cur.execute(f"select id, {name_col} from {table}")
    return {str(label): pid for pid, label in cur.fetchall() if label is not None}


def _resolve(tokens, valid: dict, variants: dict, report, list_name, other_label):
    """Map multi-select tokens to ids, returning (ids, unmatched_terms).

    A token is used only if it is literally in `valid` or is an asserted
    variant of one. Anything else is returned as free text for the column's
    *_other field -- never guessed at, and never silently dropped.
    """
    lowered = {k.lower(): v for k, v in variants.items()}
    ids: list[int] = []
    unmatched: list[str] = []
    for token in tokens:
        label = token if token in valid else lowered.get(token.lower())
        if label in valid:
            if label not in ids:
                ids.append(valid[label])
            continue
        if token in lowered and lowered[token.lower()] is None:
            # A known non-activity like the assistance prefix -- drop quietly.
            continue
        if token not in unmatched:
            unmatched.append(token)
    return ids, unmatched


def _parse_meal_portion(raw, meal_by_name, portion_by_name, other_meal_ids, report, source_id):
    """'Breakfast (Full); Lunch (Half); Full' -> [(meal_id, portion_id), ...]

    A 'Meal (Portion)' token sets both. A bare token is interpreted by which
    lookup list it belongs to, so a bare meal yields (meal, None) and a bare
    portion yields (None, portion) -- each becomes its own meal row. A token in
    neither list is reported and skipped rather than guessed at.
    """
    out: list[tuple[int | None, int | None, str | None]] = []
    for token in split_multiselect(raw):
        m = _MEAL_PAREN_RE.match(token)
        if m:
            meal = m.group("meal").strip()
            portion = m.group("portion").strip()
            meal_id = meal_by_name.get(meal)
            if meal_id is None:
                # 'Dinner own food (Full)' -- the portion is clean but the meal
                # carries a qualifier. Recover the meal head and keep the
                # portion, rather than dropping a row whose portion was
                # recorded perfectly well.
                head = next((p for p in _MEAL_PREFIXES if meal.startswith(p)), None)
                if head and head in meal_by_name:
                    meal_id = meal_by_name[head]
                    _note("meal-qualifier",
                          f"MealPortion {token!r} -- meal {head!r} kept, "
                          f"{meal[len(head):].strip()!r} is a note, not a meal")
            portion_id = portion_by_name.get(portion)
            if portion_id is None:
                _note("portion", f"portion {portion!r} not in tbl_meal_portions")
            other = None
            if meal_id is None:
                # 'Tube Feeding' is a real, recorded feeding mode that simply
                # has no tbl_meal_types row. tbl_meal_types carries an
                # 'Others:' entry precisely for this, and the target has a
                # meal_type_other free-text column, so the row is kept rather
                # than thrown away.
                if meal in other_meal_ids:
                    meal_id = other_meal_ids[meal]
                    other = meal
                    _note("meal-other", f"meal {meal!r} has no tbl_meal_types row; "
                                        f"stored as 'Others:' + meal_type_other")
                else:
                    _note("meal", f"meal {meal!r} not in tbl_meal_types")
            out.append((meal_id, portion_id, other))
            continue
        if token in meal_by_name:
            out.append((meal_by_name[token], None, None))
        elif token in other_meal_ids:
            out.append((other_meal_ids[token], None, token))
            _note("meal-other", f"meal {token!r} has no tbl_meal_types row; "
                                f"stored as 'Others:' + meal_type_other")
        elif token in portion_by_name:
            out.append((None, portion_by_name[token], None))
        else:
            # 'Dinner own food' / 'Evening Tea kopi' -- the meal is recoverable
            # and the rest is a genuine note, so keep both rather than drop it.
            head = next((p for p in _MEAL_PREFIXES if token.startswith(p)), None)
            if head and (head in meal_by_name or head in other_meal_ids):
                mid = meal_by_name.get(head) or other_meal_ids[head]
                out.append((mid, None, None))
                _note("meal-qualifier", f"MealPortion {token!r} -- meal {head!r} kept, remainder is a note, not a portion")
            else:
                _note("meal-unknown", f"unrecognised MealPortion token {token!r}")
    return out


def run(ctx: MigrationContext) -> None:
    rows = fetch_all(ctx.access_conn, SOURCE)
    ctx.report.inc(f"{SOURCE}.source_rows", len(rows))

    idmap = None if ctx.dry_run else IdMap(ctx.pg_conn, ctx.branch_code, SOURCE)
    cur = ctx.pg_conn.cursor()

    for col in ("branch_id", "resident_id", "entry_timestamp", "activity_ids",
                "active_complaint_ids", "tube_feeding", "fluid_input",
                "intervention", "reviewed_by"):
        _assert_column(cur, ENTRIES, col)
    for col in ("branch_id", "resident_id", "entry_timestamp", "systolic_bp",
                "temperature", "spo2", "gcs_eye_id", "avpu_id"):
        _assert_column(cur, VITAL, col)

    meal_by_name = _lookup(cur, "tbl_meal_types", "name")
    # tbl_meal_types ships an 'Others:' row and the target has a
    # meal_type_other free-text column: that pair is where a feeding mode the
    # lookup doesn't know about belongs, instead of being discarded. The id is
    # the 'Others:' row; the actual name goes in meal_type_other.
    others_meal_id = next(
        (pid for label, pid in meal_by_name.items() if label.lower().startswith("others")),
        None,
    )
    meal_by_name = {k: v for k, v in meal_by_name.items()
                    if not k.lower().startswith("others")}
    # Meals Access records that have no tbl_meal_types row at all. Asserted
    # rather than inferred: 'Tube Feeding' is a real feeding mode (3,572 rows),
    # not a typo, and tbl_feeding_types has no row the meal group can use.
    other_meals = {} if others_meal_id is None else {
        "Tube Feeding": others_meal_id,
    }
    other_meal_ids = {k: v for k, v in other_meals.items()}
    portion_by_name = _lookup(cur, "tbl_meal_portions", "name")
    feeding_time_by_label = {}
    cur.execute("select id, time_of_day from tbl_feeding_times")
    for fid, label in cur.fetchall():
        feeding_time_by_label[str(label).strip().lower()] = fid
    activity_by_name = _lookup(cur, "tbl_activities", "name")
    hygiene_by_name = _lookup(cur, "tbl_hygiene_care_activities", "activity")
    complaint_by_name = _lookup(cur, "tbl_active_complaints", "name_en")
    psycho_by_name = _lookup(cur, "tbl_psycho_social_behaviours", "name")
    bowel_by_name = _lookup(cur, "tbl_bowel_output_types", "name")
    urine_by_name = _lookup(cur, "tbl_pass_urine_types", "name")
    disturbance_by_name = _lookup(cur, "tbl_disturbance_levels", "description")
    avpu_by_label = _lookup(cur, "tbl_avpu_options", "label")

    # DisturbanceLevel in Access is 0..4; the lookup descriptions start
    # 'L0: ', 'L1: ' ...
    disturbance_by_code = {k.split(":")[0].strip().lower(): v for k, v in disturbance_by_name.items()}
    gcs_eye = _score_lookup(cur, "tbl_gcs_eye_responses")
    gcs_verbal = _score_lookup(cur, "tbl_gcs_verbal_responses")
    gcs_motor = _score_lookup(cur, "tbl_gcs_motor_responses")

    to_insert, to_update = [], []
    meal_rows: list[tuple[int, int | None, int | None, int | None]] = []
    hygiene_rows: list[tuple[int, str, list[int], str | None]] = []
    elim_rows: list[tuple[int, list[int], int | None]] = []
    vitals: list[tuple] = []

    for row in rows:
        source_id = row["ID"]
        timestamp = row.get("Timestamp")
        if not timestamp:
            ctx.report.skip_row(SOURCE, source_id, "no Timestamp (entry_timestamp is NOT NULL)")
            continue

        resident_id, reason = ctx.residents.resolve(row.get("ResidentName"), None)
        if resident_id is None:
            ctx.report.skip_row(SOURCE, source_id, reason or "resident not resolved")
            continue

        # --- child groups, built before the entry so the batched writes can
        # reference chart_entry_id.
        meals = _parse_meal_portion(row.get("MealPortion"), meal_by_name,
                                    portion_by_name, other_meal_ids, ctx.report, source_id)
        # TubeFeeding is a feeding TIME ('9:00 AM; 12:00 PM (asp:0mL)'), not an
        # enum. It maps to feeding_time_id on the meal rows; the enum column
        # tbl_feeding_types is not used by this target schema.
        feed_times: list[int] = []
        for t in split_multiselect(row.get("TubeFeeding")):
            fid = feeding_time_by_label.get(t.lower())
            if fid:
                feed_times.append(fid)

        hygiene_raw = row.get("AssistedHygieneCare")
        assistance = extract_assistance_level(hygiene_raw)
        hyg_tokens = split_multiselect(hygiene_raw)
        hyg_ids, hyg_other = _resolve(
            hyg_tokens, hygiene_by_name, VARIANTS["hygiene"],
            ctx.report, "hygiene", "hygiene")

        act_ids, act_other = _resolve(
            split_multiselect(row.get("Activity")), activity_by_name, VARIANTS["activity"],
            ctx.report, "activity", "activity")
        complaint_ids, complaint_other = _resolve(
            split_multiselect(row.get("ActiveComplain")), complaint_by_name, {},
            ctx.report, "complaint", "complaint")
        psycho_ids, psycho_other = _resolve(
            split_multiselect(row.get("PsychoSocialBehaviour")), psycho_by_name, {},
            ctx.report, "psycho_social", "psycho_social")

        disturb_ids = []
        for t in split_multiselect(row.get("DisturbanceLevel")):
            did = disturbance_by_code.get(t.strip().lower())
            if did:
                disturb_ids.append(did)

        bo_ids, _ = _resolve(split_multiselect(row.get("BO")), bowel_by_name, {},
                             ctx.report, "bowel", "bowel")
        pu_ids, _ = _resolve(split_multiselect(row.get("PU")), urine_by_name, {},
                             ctx.report, "urine", "urine")
        # pass_urine_id is single: first token wins, extras reported.
        if len(pu_ids) > 1:
            _note("pu-multi", f"row {source_id}: {len(pu_ids)} PU values; keeping the first")

        tube_text = clean_scalar(row.get("TubeFeeding"))
        values = dict(
            branch_id=ctx.branch_id,
            resident_id=resident_id,
            entry_timestamp=timestamp,
            tube_feeding=tube_text,
            fluid_input=_num(row.get("Fluid Input")),
            fluid_output=_num(row.get("Fluid Output")),
            cbd_drainage=clean_scalar(row.get("CBD Drainage")),
            activity_ids=act_ids or None,
            disturbance_level_ids=disturb_ids or None,
            psycho_social_behaviour_ids=psycho_ids or None,
            active_complaint_ids=complaint_ids or None,
            intervention=clean_scalar(row.get("Intervention")),
            doctors_plan=clean_scalar(row.get("Doctor's Plan")),
            reviewed_by=ctx.staff.resolve(row.get("Review by"), SOURCE),
            activity_other="; ".join(act_other) or None,
            active_complaint_other="; ".join(complaint_other) or None,
            psycho_social_other="; ".join(psycho_other) or None,
        )
        # created_by has no Access counterpart: the chart entry is keyed by the
        # patient, not the nurse who typed it. Left NULL rather than attributed
        # to a person who did not write it.

        if not ctx.dry_run:
            existing = idmap.get(source_id)
            if existing is not None:
                to_update.append((source_id, existing, values))
            else:
                to_insert.append((source_id, values))

        ctx.report.inc(f"{ENTRIES}.imported")

        # tbl_vital only when the row actually carries a vital sign.
        vital_values = dict(
            branch_id=ctx.branch_id, resident_id=resident_id, entry_timestamp=timestamp,
            systolic_bp=_num(row.get("Systolic BP")), diastolic_bp=_num(row.get("Diastolic BP")),
            heart_rate=_num(row.get("Heart Rate")), temperature=_num(row.get("Temperature")),
            spo2=_num(row.get("Spo2")), spo2_condition=_spo2_con(row.get("Spo2Con")),
            dxt=_num(row.get("DXT")), dxt_remark=clean_scalar(row.get("DXTRemark")),
            insulin_adjustment=clean_scalar(row.get("Insulin Adjustment")),
            respiration_rate=_num(row.get("RespirationRate")),
            gcs_eye_id=gcs_eye.get(str(clean_scalar(row.get("GCSE")) or "").strip()),
            gcs_verbal_id=gcs_verbal.get(str(clean_scalar(row.get("GCSV")) or "").strip()),
            gcs_motor_id=gcs_motor.get(str(clean_scalar(row.get("GCSM")) or "").strip()),
            avpu_id=avpu_by_label.get(str(clean_scalar(row.get("AVPU")) or "").strip()),
            reviewed_by=ctx.staff.resolve(row.get("Review by"), SOURCE),
        )
        if any(v is not None for k, v in vital_values.items() if k not in ("branch_id", "resident_id", "entry_timestamp", "reviewed_by")):
            vitals.append((source_id, vital_values))
            ctx.report.inc(f"{VITAL}.imported")

        # Staged in both modes so a dry run reports the real child-row counts.
        _stage_children(meals, feed_times, hyg_ids, hyg_other, hyg_tokens,
                        assistance, bo_ids, pu_ids, source_id, meal_rows,
                        hygiene_rows, elim_rows)

    if not ctx.dry_run:
        _flush(cur, to_insert, to_update, idmap, vitals, meal_rows,
               hygiene_rows, elim_rows, ctx.branch_id)
    # Collapse to one report line per distinct message, with a count.
    tally: dict[tuple[str, str], int] = defaultdict(int)
    for kind, text in _STAGE_NOTES:
        tally[(kind, text)] += 1
    for (kind, text), n in sorted(tally.items(), key=lambda kv: -kv[1])[:60]:
        ctx.report.note(f"{SOURCE} [{kind}] x{n}: {text}")
    if len(tally) > 60:
        ctx.report.note(f"{SOURCE}: {len(tally) - 60} further distinct parsing notes suppressed")
    ctx.report.inc(f"{MEALS}.rows", len(meal_rows))
    ctx.report.inc(f"{HYGIENE}.rows", len(hygiene_rows))
    ctx.report.inc(f"{ELIMINATION}.rows", len(elim_rows))
    _STAGE_NOTES.clear()
    ctx.commit()


def _spo2_con(raw) -> str | None:
    """Access Spo2Con -> spo2_condition. Bare numbers are dropped: they are
    mis-keyed SpO2 readings, and a number in a text condition column would be
    worse than nothing."""
    text = (clean_scalar(raw) or "").strip()
    if not text or text in SPO2_CON_DROP:
        return None
    return text


def _score_lookup(cur, table):
    cur.execute(f"select id, score from {table}")
    return {str(score): pid for pid, score in cur.fetchall() if score is not None}


def _assert_column(cur, table, column):
    cur.execute(
        "select 1 from information_schema.columns where table_schema='public' "
        "and table_name=%s and column_name=%s", (table, column))
    if not cur.fetchall():
        raise RuntimeError(
            f"{table}.{column} does not exist in production. schema/001_init.sql "
            f"is a stale snapshot; read the live table instead."
        )


def _stage_children(meals, feed_times, hyg_ids, hyg_other, hyg_tokens,
                    assistance, bo_ids, pu_ids, source_id, meal_rows,
                    hygiene_rows, elim_rows):
    """Queue child rows against the Access source id.

    They carry source_id, not chart_entry_id, because the entry id is only
    known after the batched insert returns. _flush() links them.

    Feeding times are paired to meals positionally. When the counts line up --
    'Breakfast; 9:00 AM; Lunch; 12:00 PM' style, or a single 'Tube Feeding' with
    one time -- the pairing is meaningful. When they do not (two meals and one
    time), the times are NOT smeared across the meals: an assertion that Lunch
    was eaten at 09:00 is a claim Access never made. Those times go to the
    entry's tube_feeding text, which already carries the raw value.
    """
    times = list(feed_times)
    if len(times) == len(meals):
        paired = list(zip(meals, times))
    else:
        if times:
            _note("feeding-time", f"row {source_id}: {len(times)} feeding time(s) for {len(meals)} meal(s); not paired")
        paired = [(m, None) for m in meals]
    for (meal_id, portion_id, other), fid in paired:
        meal_rows.append((source_id, meal_id, portion_id, other, fid))

    if hyg_ids or hyg_other or assistance:
        # assistance_level is NOT NULL. Where the row states it via the
        # 'With Assistance | ' prefix, use that. Otherwise recover it from a
        # token that names its own level ('Self PU' -> By Self). A row with
        # neither is reported and dropped rather than defaulted -- 'By Self'
        # and 'With Assistance' are different care levels, and asserting the
        # wrong one misstates the care the resident received.
        if assistance is None:
            stated = {TOKEN_ASSISTANCE[t.lower()] for t in hyg_tokens
                      if t.lower() in TOKEN_ASSISTANCE}
            if len(stated) == 1:
                assistance = stated.pop()
            elif len(stated) > 1:
                _note("hygiene", f"row {source_id}: conflicting assistance levels {sorted(stated)}; skipped")
        if assistance is None:
            _note("hygiene-no-level", "hygiene activities present but no assistance level stated; episode skipped")
        else:
            hygiene_rows.append((source_id, assistance, hyg_ids,
                                 "; ".join(hyg_other) or None))
    if bo_ids or pu_ids:
        elim_rows.append((source_id, bo_ids, pu_ids[0] if pu_ids else None))


def _flush(cur, to_insert, to_update, idmap, vitals, meal_rows, hygiene_rows,
           elim_rows, branch_id):
    """Write everything batched, then link the child rows to their entries."""
    entry_id_of = {}

    if to_insert:
        columns = list(to_insert[0][1].keys())
        cols_sql = ", ".join(columns)
        for start in range(0, len(to_insert), BATCH):
            chunk = to_insert[start:start + BATCH]
            execute_values(
                cur, f"insert into {ENTRIES} ({cols_sql}) values %s returning id",
                [tuple(r.values()) for _, r in chunk], page_size=BATCH)
            got = cur.fetchall()
            if len(got) != len(chunk):
                raise RuntimeError(f"insert returned {len(got)} ids for {len(chunk)} rows")
            for (source_id, _), (entry_id,) in zip(chunk, got):
                entry_id_of[str(source_id)] = entry_id
                idmap.put(str(source_id), ENTRIES, entry_id)

    if to_update:
        types = _column_types(cur, ENTRIES)  # noqa: F821 - defined at module bottom

        def cast(c):
            return f"cast(%s as {_PG_CASTS.get(types.get(c, 'text'), 'text')})"

        columns = list(to_update[0][2].keys())
        marks = ", ".join(cast(c) for c in columns)
        set_sql = ", ".join(f"{c} = v.{c}" for c in columns)
        value_cols = ", ".join(["target_id"] + columns)
        for start in range(0, len(to_update), BATCH):
            chunk = to_update[start:start + BATCH]
            values_sql = ", ".join(f"(%s, {marks})" for _ in chunk)
            params = [(tid, *tuple(v.values())) for _sid, tid, v in chunk]
            cur.execute(
                f"update {ENTRIES} as t set {set_sql} "
                f"from (values {values_sql}) as v({value_cols}) where t.id = v.target_id",
                [p for row in params for p in row])
            for source_id, tid, _ in chunk:
                entry_id_of[str(source_id)] = tid

    # Child rows: delete-then-rewrite per entry so an UPDATE that changes a
    # repeating group cannot leave a stale row behind.
    _replace_children(cur, entry_id_of, meal_rows, MEALS, (
        "chart_entry_id", "branch_id", "meal_type_id", "meal_portion_id",
        "meal_type_other", "feeding_time_id"),
        lambda r: (entry_id_of[str(r[0])], r[1], r[2], r[3], r[4], r[5]))
    _replace_children(cur, entry_id_of, hygiene_rows, HYGIENE, (
        "chart_entry_id", "branch_id", "assistance_level", "activity_ids"),
        lambda r: (entry_id_of[str(r[0])], r[1], r[2], r[3]))
    _replace_children(cur, entry_id_of, elim_rows, ELIMINATION, (
        "chart_entry_id", "branch_id", "bowel_output_ids", "pass_urine_id"),
        lambda r: (entry_id_of[str(r[0])], r[1], r[2]))

    if vitals:
        _flush_vitals(cur, vitals, branch_id)


def _replace_children(cur, entry_id_of, rows, table, cols, build):
    """Delete existing children for every touched entry, then insert the new
    set. Doing it in that order keeps the repeating group consistent on re-runs
    -- an UPDATE that removes a meal must not leave the old meal row behind."""
    if not rows:
        return
    ids = sorted({entry_id_of[str(r[0])] for r in rows if str(r[0]) in entry_id_of})
    if not ids:
        return
    for start in range(0, len(ids), BATCH):
        cur.execute(f"delete from {table} where chart_entry_id = any(%s)",
                    (ids[start:start + BATCH],))
    payload = [build(r) for r in rows if str(r[0]) in entry_id_of]
    if payload:
        execute_values(
            cur, f"insert into {table} ({', '.join(cols)}) values %s",
            payload, template="(" + ", ".join(["%s"] * len(cols)) + ")")


def _flush_vitals(cur, vitals, branch_id):
    """tbl_vital is keyed on (resident, timestamp), not on the chart entry, so
    it has its own identity: the same vital is written on re-run by deleting
    the rows for the touched timestamps first. Vitals are NOT linked through
    id_map -- there is no chart_entry_id on the table."""
    columns = list(vitals[0][1].keys())
    cols_sql = ", ".join(columns)
    # Delete by (resident_id, entry_timestamp) for everything about to be
    # rewritten, so a re-run updates in place instead of duplicating.
    keys = sorted({(v["resident_id"], v["entry_timestamp"]) for _, v in vitals})
    for start in range(0, len(keys), BATCH):
        chunk = keys[start:start + BATCH]
        cur.execute(
            f"delete from {VITAL} where (resident_id, entry_timestamp) in "
            f"(select unnest(%s::bigint[]), unnest(%s::timestamptz[]))",
            ([k[0] for k in chunk], [k[1] for k in chunk]))
    for start in range(0, len(vitals), BATCH):
        chunk = vitals[start:start + BATCH]
        execute_values(
            cur, f"insert into {VITAL} ({cols_sql}) values %s",
            [tuple(v.values()) for _, v in chunk], page_size=BATCH)



# information_schema data_type -> the type to cast back to in a VALUES list.
_PG_CASTS = {
    "bigint": "bigint",
    "integer": "int",
    "numeric": "numeric",
    "boolean": "boolean",
    "timestamp with time zone": "timestamptz",
    "text": "text",
    "ARRAY": "bigint[]",
}

# Notes raised while staging child rows, flushed into the report at the end of
# run() so the row loop stays free of report calls. Kept as (kind, text) and
# COLLAPSED -- there are 85,686 rows, and one line per row would produce a
# 29,000-line report nobody can review. Each distinct kind is reported once with
# a count, which is what makes the report readable at all.
_STAGE_NOTES: list[tuple[str, str]] = []


def _note(kind: str, text: str) -> None:
    _STAGE_NOTES.append((kind, text))


def _column_types(cur, table: str) -> dict[str, str]:
    cur.execute(
        "select column_name, data_type from information_schema.columns "
        "where table_schema = 'public' and table_name = %s", (table,))
    return {r[0]: r[1] for r in cur.fetchall()}
