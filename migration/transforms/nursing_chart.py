"""tbl_NursingChart -> tbl_nursing_chart_entries + _meals + _hygiene_episodes
+ _elimination_episodes, and the vital-sign columns -> tbl_vital.

85,686 rows, the largest clinical table. The source is one wide row per chart
entry; the target splits it across five tables:

  tbl_nursing_chart_entries              one row per chart entry
  tbl_nursing_chart_meals                0..n rows: oral meals (MealPortion) and
                                         tube feeds (TubeFeeding), in the same
                                         shape the app's own form writes
  tbl_nursing_chart_hygiene_episodes     0..2 rows, one per assistance level
  tbl_nursing_chart_elimination_episodes 0..1 row (BO + PU)
  tbl_vital                              only when the row carries a vital sign

Decisions taken with the owner on 2026-09-26 (see
docs/access-clinical-migration.md, "tbl_NursingChart"):

  * Preserve as much as possible, but never change the target tables to do it:
    a value that has no column or no allowed value is dropped AND reported.
  * Hygiene with no stated assistance level -> 'Unspecified'. This needs
    scripts/nursing_chart_unspecified_assistance.sql applied before the first
    --commit; the dry run reports it as a blocker until then.
  * A bare 'PU' / 'BO' hygiene token names no location, so it is dropped, not
    mapped to 'PU @ Urinal' / 'BO @ Commode'.
  * Rows entered after the app went live are handled one by one
    (SWITCHOVER below) -- staff typed most of them into both systems.
  * Staff attribution follows clinical_match (branch aliases, first-named
    person for two-name entries, owner-approved part-time staff only).

Idempotent via etl.id_map keyed on (source_table, source_id, branch_code).
Child rows are deleted and rewritten per chart entry, which is the only way to
keep a repeating group consistent with an UPDATE that changes its contents.
"""
from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict

from psycopg2.extras import execute_values

from access_reader import fetch_all
from context import MigrationContext
from etl_id_map import IdMap
from multiselect import clean_scalar, split_multiselect

ENTRIES = "tbl_nursing_chart_entries"
MEALS = "tbl_nursing_chart_meals"
HYGIENE = "tbl_nursing_chart_hygiene_episodes"
ELIMINATION = "tbl_nursing_chart_elimination_episodes"
VITAL = "tbl_vital"

SOURCE = "tbl_NursingChart"
BATCH = 500

MEAL_COLS = ("chart_entry_id", "branch_id", "meal_type_id", "meal_portion_id",
             "meal_type_other", "meal_portion_other", "feeding_time_id",
             "feeding_volume", "aspirate_amount")
HYGIENE_COLS = ("chart_entry_id", "branch_id", "assistance_level", "activity_ids")
ELIM_COLS = ("chart_entry_id", "branch_id", "bowel_output_ids", "pass_urine_id")

UNSPECIFIED = "Unspecified"

# --- Switchover -------------------------------------------------------------
# The app went live for nursing charts at AMN on 2026-09-25 11:48 (its first
# entry). Access kept being used until 2026-09-26 06:03, and staff typed most of
# those rounds into BOTH systems -- the app copy re-timed to a round number and
# typed hours later, so the two cannot be matched on timestamp. All 55 were
# paired by resident + staff + readings and decided with the owner one by one:
#
#   SKIP        the app already holds it (exact copy, or a fuller app version)
#   VITAL_ONLY  the app copy holds the hygiene but not the temperature: import
#               only the Access vital, as its own tbl_vital row at the Access time
#   ENTRY_ONLY  keep both versions of the chart entry; the vitals are already in
#               the app, so they are not written twice
#   FULL        exists only in Access (or kept alongside a conflicting app copy)
#
# A post-go-live row NOT listed here is skipped and reported: it was never
# reviewed. A branch without an entry here cannot be migrated until its own
# go-live time and decisions are recorded.
SKIP, VITAL_ONLY, ENTRY_ONLY, FULL = "skip", "vital_only", "entry_only", "full"
SWITCHOVER: dict[str, tuple[dt.datetime, dict[int, str]]] = {
    "AMN": (
        dt.datetime(2026, 9, 25, 11, 48),
        {
            # exact copies of Dewi's 05:03 and Nabilah's 06:00 morning rounds
            **{i: SKIP for i in (87118, 87119, 87120, 87121, 87122, 87123, 87124,
                                  87125, 87126, 87127, 87128, 87129, 87130, 87133,
                                  87136)},
            # app version is a superset of the Access one
            **{i: SKIP for i in (87131, 87132, 87134, 87135)},
            # copies with no temperature to rescue
            **{i: SKIP for i in (87105, 87110)},
            # Dewi 21:03 evening round + Nabilah 23:48 night round: temperature only
            **{i: VITAL_ONLY for i in (87082, 87083, 87084, 87085, 87086, 87087,
                                        87088, 87089, 87090, 87092, 87093, 87106,
                                        87108, 87109, 87111, 87112, 87114)},
            # hygiene conflicts with the app copy -- both kept, vitals already in app
            **{i: ENTRY_ONLY for i in (87137, 87138)},
            # Access only: Dewi's 23:44 round, plus rows kept beside a conflicting copy
            **{i: FULL for i in (87094, 87095, 87096, 87097, 87098, 87099, 87100,
                                  87101, 87102, 87103, 87104, 87107, 87091, 87113,
                                  87116)},
        },
    ),
}

# --- Parsing tables ----------------------------------------------------------
_MEAL_PAREN_RE = re.compile(r"^(?P<meal>.*?)\s*\(\s*(?P<portion>[^()]*)\s*\)\s*$")

# Hygiene variants -> the real lookup label. Asserted rather than fuzzy. A bare
# 'PU'/'BO' is deliberately absent: it names no location, and picking one
# ('PU @ Urinal') would record a detail Access never held.
HYGIENE_VARIANTS: dict[str, str | None] = {
    "self pu": "PU @ Toilet",
    "self bo": "BO @ Toilet",
    "assisted shower": "Shower",
    "self shower": "Shower",
    "assisted sponging": "Sponging",
    "assisted grooming": "Grooming",
    "assisted oral care": "Oral Care",
    "assisted skin care": "Skin Care",
    "assisted eye care": "Eye Care",
    "with assistance": None,  # the assistance level itself, not an activity
    "by self": None,
}
BARE_HYGIENE_TOKENS = {"pu", "bo"}

ACTIVITY_VARIANTS: dict[str, str | None] = {
    # genuinely new -> activity_other (listed so the report shows them as known)
}

# A token that names its OWN assistance level. Used only when the row states no
# level ('By Self | ' / 'With Assistance | ' prefix); a stated level wins.
TOKEN_ASSISTANCE: dict[str, str] = {
    "self pu": "By Self",
    "self bo": "By Self",
    "self shower": "By Self",
    "assisted shower": "With Assistance",
    "assisted sponging": "With Assistance",
    "assisted grooming": "With Assistance",
    "assisted oral care": "With Assistance",
    "assisted skin care": "With Assistance",
    "assisted eye care": "With Assistance",
}

# 'Dinner own food', 'Evening Tea kopi': the meal head is recoverable, and the
# food note goes to portion 'Others:' + meal_portion_other when the row gives no
# portion (see _parse_meal_portion). With a portion already given it has no
# column left and is dropped and reported.
_MEAL_PREFIXES: tuple[str, ...] = (
    "Breakfast", "Morning Tea", "Lunch", "Evening Tea", "Supper", "Dinner",
)

# '12:00 PM (asp:0mL)' / '9:00 AM' -- a tube feed time, optionally with the
# aspirate volume. Everything else in the TubeFeeding field is the feed regime
# ('2scoop milk 200ml+50ml'), which is what the app stores in feeding_volume.
_FEED_TIME_RE = re.compile(
    r"(?P<h>\d{1,2}):(?P<m>\d{2})\s*(?P<ap>[AaPp][Mm])"
    r"(?:\s*\(\s*asp\s*:?\s*(?P<asp>\d+(?:\.\d+)?)\s*m[lL]?\s*\))?"
)

AVPU_LETTERS = {"a": "Alert", "v": "Verbal", "p": "Pain", "u": "Unresponsive"}

# Plausible ranges. A value outside is a mis-keyed number (36.5 in the
# respiration field), and a wrong vital is worse than a missing one.
PLAUSIBLE = {
    "Temperature": (30.0, 45.0),
    "RespirationRate": (4.0, 80.0),
}


# --- Notes: collapsed per distinct message, every one rendered ---------------
_NOTES: dict[tuple[str, str], list] = {}


def _note(kind: str, text: str, source_id=None) -> None:
    entry = _NOTES.setdefault((kind, text), [0, []])
    entry[0] += 1
    if source_id is not None and len(entry[1]) < 5:
        entry[1].append(source_id)


def _num(raw, col: str, source_id) -> float | None:
    """Access stores every number as text. Junk becomes NULL, never 0.

    A fabricated 0 is a clinical statement -- a temperature of 0 or a heart
    rate of 0 reads as a real, catastrophic measurement. A doubled or stray
    decimal point ('36..4', '36.3.') is repaired only when exactly one number
    remains and it is plausible for the column.
    """
    text = (clean_scalar(raw) or "").strip().rstrip("%").strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        repaired = re.sub(r"\.{2,}", ".", text).strip(".")
        try:
            value = float(repaired) if repaired.count(".") <= 1 else None
        except ValueError:
            value = None
        if value is None:
            _note("number-junk", f"{col} {text!r} is not a number -> NULL", source_id)
            return None
        _note("number-repaired", f"{col} {text!r} read as {value}", source_id)
    if col == "Temperature" and re.fullmatch(r"3[4-9]\d|4[0-2]\d", text):
        # '365' / '370': the decimal point was not typed. Owner decision
        # 2026-09-26: read as 36.5 / 37.0. Only a bare 3-digit 340-429 qualifies,
        # so '98' (likely Fahrenheit) and '3.0' stay NULL.
        value = int(text) / 10
        _note("number-repaired", f"{col} {text!r} read as {value} (missing decimal point)", source_id)
    lo_hi = PLAUSIBLE.get(col)
    if lo_hi and not (lo_hi[0] <= value <= lo_hi[1]):
        _note("number-implausible", f"{col} {text!r} outside {lo_hi} -> NULL", source_id)
        return None
    return value


def _fit_allowed(value: str | None, allowed: set[str] | None, col: str, source_id) -> str | None:
    """Store a value in a CHECK-constrained text column.

    An allowed value is kept as is. Otherwise, if the text is, or starts with,
    an allowed category ('pre meal', 'Pre-Meal ( PRE DINNER )', 'Fasting 5am'),
    the stated category is kept and the rest of the note dropped -- the longest
    matching category wins, so 'Post-Meal 2hr ...' stays 'Post-Meal 2hr'. Free
    text naming no category ('5am', 'balik dialisis') has no column: dropped.
    """
    if value is None or allowed is None or value in allowed:
        return value
    norm = re.sub(r"\s+", " ", value.strip().lower()).replace("pre meal", "pre-meal")
    for category in sorted(allowed, key=len, reverse=True):
        c = category.lower()
        if norm == c or norm.startswith(c + " ") or norm.startswith(c + "("):
            if norm != c:
                _note(f"{col.lower()}-category-kept",
                      f"{col} {value!r} -> {category!r}; the rest of the note has no column", source_id)
            return category
    _note(f"{col.lower()}-not-allowed", f"{col} {value!r} names no allowed category; dropped", source_id)
    return None


def _lookup(cur, table: str, name_col: str) -> dict[str, int]:
    cur.execute(f"select id, {name_col} from {table}")
    return {str(label): pid for pid, label in cur.fetchall() if label is not None}


def _allowed_values(cur, table: str, column: str) -> set[str] | None:
    """The literal values a CHECK (column = ANY (ARRAY[...])) admits, or None if
    the column has no such constraint. Read live so the dry run validates
    against production, not against an assumption."""
    cur.execute(
        "select pg_get_constraintdef(oid) from pg_constraint "
        "where conrelid = %s::regclass and contype = 'c'", (f"public.{table}",))
    for (definition,) in cur.fetchall():
        if re.search(rf"\(\s*{column}\s*=\s*ANY", definition):
            return {v.replace("''", "'") for v in re.findall(r"'((?:[^']|'')*)'::text", definition)}
    return None


def _resolve(tokens, valid: dict, variants: dict):
    """Map multi-select tokens to ids -> (ids, unmatched). A token is used only
    if it is literally in `valid` or an asserted variant of one."""
    lowered = {k.lower(): v for k, v in variants.items()}
    ids: list[int] = []
    unmatched: list[str] = []
    for token in tokens:
        label = token if token in valid else lowered.get(token.lower())
        if label in valid:
            if valid[label] not in ids:
                ids.append(valid[label])
            continue
        if token.lower() in lowered and lowered[token.lower()] is None:
            continue
        if token not in unmatched:
            unmatched.append(token)
    return ids, unmatched


def _parse_hygiene(raw, hygiene_by_name, source_id) -> list[tuple[str, list[int]]]:
    """-> [(assistance_level, activity_ids)], at most one episode per level
    (the table is UNIQUE on (chart_entry_id, assistance_level)).

    Since 2025-04-17 Access writes ONE LINE PER SECTION, either of which may be
    empty or a bare heading:

        'By Self | BO @ Toilet; PU @ Toilet\\r\\nWith Assistance | Sponging'
        'By Self | PU @ Toilet\\r\\nWith Assistance'     (empty WA section)
        '\\r\\nWith Assistance | Change Diapers'          (empty By Self section)

    so each line is parsed on its own. (The generic split_multiselect keeps
    only the text after the LAST '|', which on 695 rows drops the By Self items
    and files the With Assistance items under the By Self prefix.) Rows before
    that date are a bare list ('; Assisted Shower') with no section at all.
    """
    items: list[tuple[str | None, str]] = []  # (stated level, token)
    for line in str(raw or "").replace("\r\n", "\n").split("\n"):
        line = line.strip()
        if not line or line in ("By Self", "With Assistance"):
            continue  # blank line, or a section heading with nothing under it
        level = None
        if "|" in line:
            label, line = (s.strip() for s in line.split("|", 1))
            if label in ("By Self", "With Assistance"):
                level = label
            elif label:
                _note("hygiene-label", f"hygiene section label {label!r} not recognised; level from item",
                      source_id)
        for token in (t.strip() for t in line.split(";")):
            if token and token.lower() not in ("none", "-"):
                items.append((level, token))

    by_level: dict[str, list[int]] = defaultdict(list)
    for stated, token in items:
        low = token.lower()
        if low in BARE_HYGIENE_TOKENS:
            _note("hygiene-bare", f"bare {token!r} names no location; dropped", source_id)
            continue
        ids, unmatched = _resolve([token], hygiene_by_name, HYGIENE_VARIANTS)
        if unmatched:
            _note("hygiene-unmatched", f"hygiene term {token!r} has no lookup row; dropped", source_id)
            continue
        if not ids:
            continue  # an assistance word, not an activity
        level = stated or TOKEN_ASSISTANCE.get(low) or UNSPECIFIED
        for i in ids:
            if i not in by_level[level]:
                by_level[level].append(i)
    if UNSPECIFIED in by_level:
        _note("hygiene-unspecified", "no assistance level stated -> 'Unspecified'")
    return [(level, ids) for level, ids in by_level.items() if ids]


def _parse_bo(raw, bowel_by_name, source_id) -> list[int]:
    """BO keeps the literal 'None' -- it is a real lookup value ('no bowel
    output', 25,793 rows), which the generic multi-select splitter would throw
    away as an empty token."""
    if raw is None:
        return []
    ids: list[int] = []
    for token in (t.strip() for t in str(raw).replace("\r\n", "\n").split(";")):
        if not token:
            continue
        pid = bowel_by_name.get(token)
        if pid is None:
            _note("bo-unmatched", f"BO {token!r} has no lookup row; dropped", source_id)
        elif pid not in ids:
            ids.append(pid)
    return ids


def _parse_tube_feeding(raw, feeding_time_by_time, source_id):
    """TubeFeeding -> [dict(feeding_time_id, feeding_volume, aspirate_amount)].

    One meal row per feed time, as the app writes it. The regime text around the
    times ('2scoop milk 200ml+50ml') is kept verbatim in feeding_volume. A time
    that is not one of the app's six slots keeps its text in feeding_volume
    rather than being dropped.
    """
    rows: list[dict] = []
    fallback_regime: str | None = None
    for token in split_multiselect(raw):
        times = list(_FEED_TIME_RE.finditer(token))
        regime = _FEED_TIME_RE.sub(" ", token)
        regime = re.sub(r"\s+", " ", regime).strip(" ,.;") or None
        if not times:
            if regime:
                fallback_regime = regime if fallback_regime is None else f"{fallback_regime}; {regime}"
            continue
        for m in times:
            hour = int(m["h"]) % 12 + (12 if m["ap"].lower() == "pm" else 0)
            slot = feeding_time_by_time.get(dt.time(hour, int(m["m"])))
            volume = regime
            if slot is None:
                _note("feed-time-no-slot", f"feed time {m.group(0)!r} is not an app slot; kept in feeding_volume", source_id)
                volume = f"{regime + ' ' if regime else ''}@ {m.group(0)}"
            rows.append(dict(
                feeding_time_id=slot,
                feeding_volume=volume,
                aspirate_amount=float(m["asp"]) if m["asp"] is not None else None,
            ))
    if rows and fallback_regime:
        for r in rows:
            r["feeding_volume"] = r["feeding_volume"] or fallback_regime
    elif fallback_regime:
        rows.append(dict(feeding_time_id=None, feeding_volume=fallback_regime, aspirate_amount=None))
    return rows


def _others_text(token: str) -> str | None:
    """'Others: outside food' -> 'outside food'; 'Others:' -> None."""
    return token.split(":", 1)[1].strip() or None if ":" in token else None


def _parse_meal_portion(raw, meal_by_name, portion_by_name, others_meal_id,
                        others_portion_id, source_id, has_tube_rows: bool):
    """'Breakfast (Full); Lunch (Half); Full'
        -> [(meal_id, portion_id, meal_type_other, meal_portion_other)]

    A 'Meal (Portion)' token sets both. A bare token is interpreted by which
    lookup list it belongs to. 'Tube Feeding' is not a meal type: when the row's
    TubeFeeding field produced tube rows it is only a marker (returned as the
    tube portion instead); otherwise it is kept as 'Others:' + meal_type_other.

    'Others: <text>' uses the app's own 'Others:' meal type / portion and its
    free-text column, which exist for exactly this. A meal with a food note and
    no portion ('Dinner own food') keeps the note the same way Access itself
    recorded it elsewhere -- 'Dinner (Others: outside food)' -- as portion
    'Others:' + meal_portion_other.
    """
    out: list[tuple[int | None, int | None, str | None, str | None]] = []
    tube_portion: int | None = None
    tokens = split_multiselect(raw)
    tube_marked = any(t.lower() == "tube feeding" for t in tokens)
    bare_portions = [t for t in tokens if t in portion_by_name]
    if has_tube_rows and tube_marked and len(bare_portions) == 1 and not any(
            t in meal_by_name for t in tokens):
        # 'Tube Feeding; Full' -- the portion belongs to the tube feed.
        tube_portion = portion_by_name[bare_portions[0]]
        return out, tube_portion, True

    def meal_of(text: str):
        """-> (meal_id, meal_type_other, food_note) for a meal text."""
        if text in meal_by_name:
            return meal_by_name[text], None, None
        if text.lower() == "tube feeding" and others_meal_id is not None:
            return others_meal_id, "Tube Feeding", None
        if text.lower().startswith("others") and others_meal_id is not None:
            return others_meal_id, _others_text(text), None
        head = next((p for p in _MEAL_PREFIXES if text.startswith(p)), None)
        if head and head in meal_by_name:
            note = text[len(head):].strip(" -:,") or None
            return meal_by_name[head], None, note
        return None, None, None

    def portion_of(text: str, fallback: bool = True):
        """-> (portion_id, meal_portion_other). With `fallback`, free text that
        is no known portion ('3/4', 'Full MILK') is kept verbatim as 'Others:'."""
        if text in portion_by_name:
            return portion_by_name[text], None
        if text.lower().startswith("others") and others_portion_id is not None:
            return others_portion_id, _others_text(text)
        if fallback and text and others_portion_id is not None:
            _note("portion-as-other", "free-text portion kept as 'Others:' + meal_portion_other")
            return others_portion_id, text
        return None, None

    for token in tokens:
        if token.lower() == "tube feeding" and has_tube_rows:
            continue
        m = _MEAL_PAREN_RE.match(token)
        if m:
            meal_text, portion_text = m.group("meal").strip(), m.group("portion").strip()
            meal_id, meal_other, food_note = meal_of(meal_text)
            portion_id, portion_other = portion_of(portion_text)
            if meal_id is None and meal_text and others_meal_id is not None:
                meal_id, meal_other = others_meal_id, meal_text
                _note("meal-as-other", "free-text meal kept as 'Others:' + meal_type_other")
            elif meal_id is None and meal_text:
                _note("meal-unknown", f"meal {meal_text!r} not in tbl_meal_types; dropped", source_id)
            if portion_id is None and portion_text:
                _note("portion", f"portion {portion_text!r} not in tbl_meal_portions; dropped", source_id)
            if food_note:
                if portion_id is None and others_portion_id is not None:
                    portion_id, portion_other = others_portion_id, food_note
                else:
                    _note("meal-qualifier",
                          f"meal {meal_text!r}: note {food_note!r} dropped -- the portion "
                          f"column is already used", source_id)
            if meal_id is not None or portion_id is not None:
                out.append((meal_id, portion_id, meal_other, portion_other))
            continue
        meal_id, meal_other, food_note = meal_of(token)
        if meal_id is not None:
            portion_id = portion_other = None
            if food_note and others_portion_id is not None:
                portion_id, portion_other = others_portion_id, food_note
            out.append((meal_id, portion_id, meal_other, portion_other))
            continue
        portion_id, portion_other = portion_of(token, fallback=False)
        if portion_id is not None:
            out.append((None, portion_id, None, portion_other))
        elif others_meal_id is not None:
            # '1 bowl porridge + 100 mls h2o', 'outside food': a free-text meal
            # description naming no meal slot -- kept verbatim as 'Others:'.
            out.append((others_meal_id, None, token, None))
            _note("meal-as-other", "free-text MealPortion kept as 'Others:' + meal_type_other")
        else:
            _note("meal-unknown", f"MealPortion token {token!r} unrecognised; dropped", source_id)
    return out, tube_portion, tube_marked


def run(ctx: MigrationContext) -> None:
    _NOTES.clear()
    if ctx.branch_code not in SWITCHOVER:
        raise RuntimeError(
            f"No SWITCHOVER entry for branch {ctx.branch_code!r}: record its app go-live "
            f"time and the per-row decisions for Access rows entered after it first.")
    go_live, decisions = SWITCHOVER[ctx.branch_code]

    rows = fetch_all(ctx.access_conn, SOURCE)
    ctx.report.inc(f"{SOURCE}.source_rows", len(rows))

    idmap = None if ctx.dry_run else IdMap(ctx.pg_conn, ctx.branch_code, SOURCE)
    cur = ctx.pg_conn.cursor()

    meal_by_name = _lookup(cur, "tbl_meal_types", "name")
    others_meal_id = next((pid for label, pid in meal_by_name.items()
                           if label.lower().startswith("others")), None)
    meal_by_name = {k: v for k, v in meal_by_name.items() if not k.lower().startswith("others")}
    portion_by_name = _lookup(cur, "tbl_meal_portions", "name")
    others_portion_id = next((pid for label, pid in portion_by_name.items()
                              if label.lower().startswith("others")), None)
    portion_by_name = {k: v for k, v in portion_by_name.items()
                       if not k.lower().startswith("others")}
    cur.execute("select id, time_of_day from tbl_feeding_times")
    feeding_time_by_time = {t: fid for fid, t in cur.fetchall()}
    activity_by_name = _lookup(cur, "tbl_activities", "name")
    hygiene_by_name = _lookup(cur, "tbl_hygiene_care_activities", "activity")
    complaint_by_name = _lookup(cur, "tbl_active_complaints", "name_en")
    psycho_by_name = _lookup(cur, "tbl_psycho_social_behaviours", "name")
    bowel_by_name = _lookup(cur, "tbl_bowel_output_types", "name")
    urine_by_name = _lookup(cur, "tbl_pass_urine_types", "name")
    disturbance_by_name = _lookup(cur, "tbl_disturbance_levels", "description")
    avpu_by_label = {k.lower(): v for k, v in _lookup(cur, "tbl_avpu_options", "label").items()}
    # 'L0: No disturbance' -> '0'. Access stores the bare digit.
    disturbance_by_code = {k.split(":")[0].strip().lower().lstrip("l"): v
                           for k, v in disturbance_by_name.items()}
    gcs_eye = _score_lookup(cur, "tbl_gcs_eye_responses")
    gcs_verbal = _score_lookup(cur, "tbl_gcs_verbal_responses")
    gcs_motor = _score_lookup(cur, "tbl_gcs_motor_responses")
    spo2_allowed = _allowed_values(cur, VITAL, "spo2_condition")
    dxt_allowed = _allowed_values(cur, VITAL, "dxt_remark")

    to_insert, to_update = [], []
    meal_rows: list[tuple] = []      # (source_id, dict)
    hygiene_rows: list[tuple] = []   # (source_id, dict)
    elim_rows: list[tuple] = []      # (source_id, dict)
    vitals: list[tuple] = []         # (source_id, dict)
    entry_sample = vital_sample = None

    for row in rows:
        source_id = row["ID"]
        timestamp = row.get("Timestamp")
        if not timestamp:
            ctx.report.skip_row(SOURCE, source_id, "no Timestamp (entry_timestamp is NOT NULL)")
            continue

        action = FULL
        if timestamp >= go_live:
            action = decisions.get(source_id)
            if action is None:
                ctx.report.skip_row(SOURCE, source_id,
                                    f"entered after app go-live {go_live} and not reviewed (SWITCHOVER)")
                continue
            ctx.report.inc(f"{SOURCE}.switchover.{action}")
            if action == SKIP:
                continue

        resident_id, reason = ctx.residents.resolve(row.get("ResidentName"), None, when=timestamp)
        if resident_id is None:
            ctx.report.skip_row(SOURCE, source_id, reason or "resident not resolved")
            continue

        raw_reviewer = clean_scalar(row.get("Review by"))
        reviewed_by = ctx.staff.resolve(raw_reviewer, SOURCE)
        unmatched_reviewer = (raw_reviewer if reviewed_by is None
                              and ctx.staff.part_time.contains(raw_reviewer) else None)

        # --- vitals (own table, keyed by resident + time, not by chart entry)
        if action in (FULL, VITAL_ONLY):
            spo2_con = clean_scalar(row.get("Spo2Con"))
            if spo2_con is not None and spo2_allowed is not None and spo2_con not in spo2_allowed:
                _note("spo2con-not-allowed", f"Spo2Con {spo2_con!r} not an allowed value; dropped", source_id)
                spo2_con = None
            dxt_remark = _fit_allowed(clean_scalar(row.get("DXTRemark")), dxt_allowed,
                                      "DXTRemark", source_id)
            avpu_raw = (clean_scalar(row.get("AVPU")) or "").strip()
            avpu_id = avpu_by_label.get(avpu_raw.lower()) or avpu_by_label.get(
                AVPU_LETTERS.get(avpu_raw.lower(), "").lower())
            if avpu_raw and avpu_id is None:
                _note("avpu-unmatched", f"AVPU {avpu_raw!r} not recognised; dropped", source_id)
            vital_values = dict(
                branch_id=ctx.branch_id, resident_id=resident_id, entry_timestamp=timestamp,
                systolic_bp=_num(row.get("Systolic BP"), "Systolic BP", source_id),
                diastolic_bp=_num(row.get("Diastolic BP"), "Diastolic BP", source_id),
                heart_rate=_num(row.get("Heart Rate"), "Heart Rate", source_id),
                temperature=_num(row.get("Temperature"), "Temperature", source_id),
                spo2=_num(row.get("Spo2"), "Spo2", source_id),
                spo2_condition=spo2_con,
                dxt=_num(row.get("DXT"), "DXT", source_id),
                dxt_remark=dxt_remark,
                insulin_adjustment=clean_scalar(row.get("Insulin Adjustment")),
                respiration_rate=_num(row.get("RespirationRate"), "RespirationRate", source_id),
                gcs_eye_id=_gcs(gcs_eye, row.get("GCSE"), "GCSE", source_id),
                gcs_verbal_id=_gcs(gcs_verbal, row.get("GCSV"), "GCSV", source_id),
                gcs_motor_id=_gcs(gcs_motor, row.get("GCSM"), "GCSM", source_id),
                avpu_id=avpu_id,
                reviewed_by=reviewed_by,
                reviewed_by_other=unmatched_reviewer,
            )
            measured = {k: v for k, v in vital_values.items() if k not in (
                "branch_id", "resident_id", "entry_timestamp", "reviewed_by", "reviewed_by_other")}
            if any(v is not None for v in measured.values()):
                vitals.append((source_id, vital_values))
                vital_sample = vital_values
                ctx.report.inc(f"{VITAL}.imported")
            elif action == VITAL_ONLY:
                _note("vital-only-empty", "VITAL_ONLY row carries no vital sign", source_id)

        if action == VITAL_ONLY:
            continue

        # --- chart entry and its repeating groups
        tube_rows = _parse_tube_feeding(row.get("TubeFeeding"), feeding_time_by_time, source_id)
        oral, tube_portion, tube_marked = _parse_meal_portion(
            row.get("MealPortion"), meal_by_name, portion_by_name, others_meal_id,
            others_portion_id, source_id, bool(tube_rows))
        if tube_rows or tube_marked:
            tube_feeding = "Tube Feeding"
        elif oral:
            tube_feeding = "Oral Feed"
        else:
            tube_feeding = None

        act_ids, act_other = _resolve(split_multiselect(row.get("Activity")),
                                      activity_by_name, ACTIVITY_VARIANTS)
        complaint_ids, complaint_other = _resolve(split_multiselect(row.get("ActiveComplain")),
                                                  complaint_by_name, {})
        psycho_ids, psycho_other = _resolve(split_multiselect(row.get("PsychoSocialBehaviour")),
                                            psycho_by_name, {})
        disturb_ids = []
        for t in split_multiselect(row.get("DisturbanceLevel")):
            did = disturbance_by_code.get(t.strip().lower().lstrip("l"))
            if did is None:
                _note("disturbance-unmatched", f"DisturbanceLevel {t!r} not recognised; dropped", source_id)
            elif did not in disturb_ids:
                disturb_ids.append(did)

        values = dict(
            branch_id=ctx.branch_id,
            resident_id=resident_id,
            entry_timestamp=timestamp,
            tube_feeding=tube_feeding,
            fluid_input=_num(row.get("Fluid Input"), "Fluid Input", source_id),
            fluid_output=_num(row.get("Fluid Output"), "Fluid Output", source_id),
            cbd_drainage=clean_scalar(row.get("CBD Drainage")),
            activity_ids=act_ids or None,
            disturbance_level_ids=disturb_ids or None,
            psycho_social_behaviour_ids=psycho_ids or None,
            active_complaint_ids=complaint_ids or None,
            intervention=clean_scalar(row.get("Intervention")),
            doctors_plan=clean_scalar(row.get("Doctor's Plan")),
            reviewed_by=reviewed_by,
            activity_other="; ".join(act_other) or None,
            active_complaint_other="; ".join(complaint_other) or None,
            psycho_social_other="; ".join(psycho_other) or None,
        )
        # created_by has no Access counterpart: the chart entry is keyed by the
        # patient, not the nurse who typed it. Left NULL rather than attributed
        # to a person who did not write it. tbl_nursing_chart_entries has no
        # reviewed_by_other, so an unmatched reviewer name is kept only on the
        # vital row (tbl_vital.reviewed_by_other) when there is one.
        entry_sample = values
        if not ctx.dry_run:
            existing = idmap.get(source_id)
            if existing is not None:
                to_update.append((source_id, existing, values))
            else:
                to_insert.append((source_id, values))
        ctx.report.inc(f"{ENTRIES}.imported")

        for t in tube_rows:
            meal_rows.append((source_id, dict(
                meal_type_id=None, meal_portion_id=tube_portion, meal_type_other=None,
                meal_portion_other=None, **t)))
        for meal_id, portion_id, meal_other, portion_other in oral:
            meal_rows.append((source_id, dict(
                meal_type_id=meal_id, meal_portion_id=portion_id, meal_type_other=meal_other,
                meal_portion_other=portion_other, feeding_time_id=None, feeding_volume=None,
                aspirate_amount=None)))
        for level, ids in _parse_hygiene(row.get("AssistedHygieneCare"), hygiene_by_name, source_id):
            hygiene_rows.append((source_id, dict(assistance_level=level, activity_ids=ids)))
        bo_ids = _parse_bo(row.get("BO"), bowel_by_name, source_id)
        pu_tokens = split_multiselect(row.get("PU"))
        pu_ids, pu_unmatched = _resolve(pu_tokens, urine_by_name, {})
        for t in pu_unmatched:
            _note("pu-unmatched", f"PU {t!r} has no lookup row; dropped", source_id)
        if len(pu_ids) > 1:
            _note("pu-multi", f"{len(pu_ids)} PU values; pass_urine_id holds one -> first kept, rest dropped",
                  source_id)
        if bo_ids or pu_ids:
            elim_rows.append((source_id, dict(bowel_output_ids=bo_ids or None,
                                              pass_urine_id=pu_ids[0] if pu_ids else None)))

    # --- validate the payload against the live tables, in BOTH modes, so a dry
    # run catches what would otherwise only fail mid-commit.
    blockers = _validate(cur, ctx, entry_sample, vital_sample, hygiene_rows, vitals)
    for b in blockers:
        ctx.report.note(f"BLOCKER for --commit: {b}")
    if blockers and not ctx.dry_run:
        raise RuntimeError("nursing_chart: " + " | ".join(blockers))

    if not ctx.dry_run:
        _flush(cur, to_insert, to_update, idmap, vitals, meal_rows, hygiene_rows,
               elim_rows, ctx.branch_id)

    for (kind, text), (n, samples) in sorted(_NOTES.items(), key=lambda kv: (-kv[1][0], kv[0])):
        eg = f" (e.g. rows {', '.join(map(str, samples))})" if samples else ""
        ctx.report.note(f"{SOURCE} [{kind}] x{n}: {text}{eg}")
    ctx.report.inc(f"{MEALS}.rows", len(meal_rows))
    ctx.report.inc(f"{MEALS}.tube_feed_rows", sum(1 for _, m in meal_rows if m["feeding_volume"] or m["feeding_time_id"] or m["aspirate_amount"] is not None))
    ctx.report.inc(f"{HYGIENE}.rows", len(hygiene_rows))
    ctx.report.inc(f"{ELIMINATION}.rows", len(elim_rows))
    _NOTES.clear()
    ctx.commit()


def _gcs(lookup, raw, col, source_id):
    text = str(clean_scalar(raw) or "").strip()
    if not text:
        return None
    pid = lookup.get(text)
    if pid is None:
        _note("gcs-unmatched", f"{col} {text!r} is not a GCS score; dropped", source_id)
    return pid


def _score_lookup(cur, table):
    cur.execute(f"select id, score from {table}")
    return {str(score): pid for pid, score in cur.fetchall() if score is not None}


def _live_columns(cur, table) -> set[str]:
    cur.execute("select column_name from information_schema.columns "
                "where table_schema = 'public' and table_name = %s", (table,))
    return {r[0] for r in cur.fetchall()}


def _validate(cur, ctx, entry_sample, vital_sample, hygiene_rows, vitals) -> list[str]:
    """Every column written must exist in production, and every value written to
    a CHECK-constrained column must be one it admits. schema/001_init.sql is a
    stale snapshot, so this reads the live catalog."""
    problems: list[str] = []
    for table, cols in (
        (ENTRIES, entry_sample.keys() if entry_sample else ()),
        (VITAL, vital_sample.keys() if vital_sample else ()),
        (MEALS, MEAL_COLS), (HYGIENE, HYGIENE_COLS), (ELIMINATION, ELIM_COLS),
    ):
        missing = sorted(set(cols) - _live_columns(cur, table))
        if missing:
            problems.append(f"{table} has no column(s) {missing} (schema/001_init.sql is stale)")

    allowed = _allowed_values(cur, HYGIENE, "assistance_level")
    if allowed is not None:
        used = defaultdict(int)
        for _, h in hygiene_rows:
            used[h["assistance_level"]] += 1
        for level, n in used.items():
            if level not in allowed:
                problems.append(
                    f"{n} hygiene episodes use assistance_level {level!r}, which "
                    f"{HYGIENE}'s CHECK does not admit {sorted(allowed)} -- apply "
                    f"migration/scripts/nursing_chart_unspecified_assistance.sql first")
    return problems


def _flush(cur, to_insert, to_update, idmap, vitals, meal_rows, hygiene_rows,
           elim_rows, branch_id):
    """Write everything batched, then link the child rows to their entries."""
    entry_id_of: dict[str, int] = {}

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
            pairs = []
            for (source_id, _), (entry_id,) in zip(chunk, got):
                entry_id_of[str(source_id)] = entry_id
                pairs.append((str(source_id), ENTRIES, entry_id))
            # Batched: put() is one round trip per row, which cost the physio
            # run 16 minutes for 10,630 rows. Written by flush() below.
            idmap.put_many(pairs)

    if to_update:
        types = _column_types(cur, ENTRIES)

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

    idmap.flush()

    # Children: delete-then-rewrite for EVERY touched entry (not only those
    # that still have children) so an update that empties a group leaves
    # nothing stale behind.
    touched = sorted(entry_id_of.values())
    for table in (MEALS, HYGIENE, ELIMINATION):
        for start in range(0, len(touched), BATCH):
            cur.execute(f"delete from {table} where chart_entry_id = any(%s)",
                        (touched[start:start + BATCH],))
    for table, cols, rows in ((MEALS, MEAL_COLS, meal_rows),
                              (HYGIENE, HYGIENE_COLS, hygiene_rows),
                              (ELIMINATION, ELIM_COLS, elim_rows)):
        payload = [(entry_id_of[str(sid)], branch_id, *(d[c] for c in cols[2:]))
                   for sid, d in rows if str(sid) in entry_id_of]
        for start in range(0, len(payload), BATCH):
            execute_values(cur, f"insert into {table} ({', '.join(cols)}) values %s",
                           payload[start:start + BATCH], page_size=BATCH)

    if vitals:
        _flush_vitals(cur, vitals, branch_id)


def _flush_vitals(cur, vitals, branch_id):
    """tbl_vital is keyed on (resident, timestamp), not on the chart entry, so
    it has its own identity: a re-run deletes this branch's rows at the touched
    (resident, timestamp) pairs first, then rewrites them. Vitals are NOT linked
    through id_map -- there is no chart_entry_id on the table."""
    columns = list(vitals[0][1].keys())
    cols_sql = ", ".join(columns)
    keys = sorted({(v["resident_id"], v["entry_timestamp"]) for _, v in vitals})
    for start in range(0, len(keys), BATCH):
        chunk = keys[start:start + BATCH]
        cur.execute(
            f"delete from {VITAL} where branch_id = %s and (resident_id, entry_timestamp) in "
            f"(select unnest(%s::bigint[]), unnest(%s::timestamptz[]))",
            (branch_id, [k[0] for k in chunk], [k[1] for k in chunk]))
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


def _column_types(cur, table: str) -> dict[str, str]:
    cur.execute(
        "select column_name, data_type from information_schema.columns "
        "where table_schema = 'public' and table_name = %s", (table,))
    return {r[0]: r[1] for r in cur.fetchall()}
