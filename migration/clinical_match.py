"""Identity resolution for the clinical-table migration (Hospital Referral,
Progress Note, and later NursingChart / PhyIPProgressNote).

Diverges from staff_match.py in two deliberate ways:

  1. Staff are matched ACROSS ALL BRANCHES, not just the branch being migrated.
     Real data proved this necessary: tbl_ProgressNote is reviewed by
     'Dr. Irene' (rostered at ALMA/AMN) *and* 'Dr. Lim Yi Wei' (rostered at HQ
     only), and the doctors together account for 51% of all ReviewBy values.
     reviewed_by references tbl_staff."StaffID" with no branch constraint, so a
     cross-branch attribution is structurally valid.

  2. A staff name that matches nothing in the roster is NOT dropped and NOT
     guessed at. It is registered as a candidate for an auto-created part-time,
     non-registered staff record (position 'Healthcare Worker', department
     'Nursing', role 'STAFF', status 'INACTIVE') -- per owner decision, since a
     name appearing on clinical records but absent from tbl_staff means the
     person worked without being registered. The dry-run LISTS every such
     candidate and creates none. A record is created (commit run only) ONLY for
     names the owner approved one by one in APPROVED_PART_TIME; every other
     candidate stays unattributed and listed until it is reviewed.

Residents resolve against tbl_residents (the master list), never against
Access's own ResidentID column -- which is NULL in every row of
tbl_ProgressNote anyway. IC wins over name; a name that matches two different
residents is ambiguous and is skipped rather than picked between.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field

from multiselect import clean_scalar

# Access stored this IC with a stray extra digit, on 18 rows. Verified to occur
# ONLY under the name 'NG AH HUAH' and to collide with no other resident, and
# confirmed with the owner to be the same person. Expressed as an explicit
# alias rather than a general "malformed IC -> ignore" rule so the reason for
# the merge is recorded rather than re-derived.
IC_ALIASES: dict[str, str] = {
    "4412211075158": "441221075158",
}

# Residents whose Access records cannot be separated by IC or name alone, so
# the correct target row is asserted here and logged on every use. Each entry
# was established from the evidence recorded beside it -- they are NOT a
# general "similar name" heuristic.
#
#   TAN GUEK LEN (Access ResidentID 51 / 113 / 119) is ONE person registered
#   three times: same IC 490825075340, same age 75, and admission dates that
#   chain without a gap (2024-04-06 -> 2025-05-02, 2025-04-19 -> 2025-05-02,
#   2025-05-26 -> present). All 114 Access progress notes (2024-04-18 ->
#   2026-09-19) fall inside that span, and the IC is identical on all three
#   rows, so no IC-based rule could ever have separated them. Current record
#   is the ACTIVE one.
#
#   QUAH CHEOW GUAT has exactly ONE progress note, dated 2025-01-20. Of the two
#   candidates, id 738 was admitted 2025-01-18 and discharged 2025-01-21 (the
#   note falls inside that admission); id 778 was admitted 2025-12-14, eleven
#   months later. Resolved on the admission window, not on the junk ICs
#   (420228-08-5292 / 123456789).
#
#   HANG MA SANG has two physio notes (2024-04-17, 2024-04-19) and matches no
#   master-list resident. The only close name is HONG MA SANG (id 700) at 0.92
#   similarity -- a transposition that Access's free-text entry readily produces.
#   The notes fall just outside 700's admission window, so the dates do not
#   corroborate it; the name is the only evidence, and the owner accepted it.
#
#   tbl_NursingChart misspellings, confirmed one by one with the owner on
#   2026-09-26. Each was checked against the candidate's admission window;
#   the dates are noted. 'TEOH KHOON GOH' (1 row) is deliberately absent:
#   TEOH KHOON LEE (757) and LIM KHOON GNOH (750) were both resident that day.
#   The ids are AMN residents, so for any other branch they fail the
#   master-list existence check and fall through to the normal rules.
RESIDENT_OVERRIDES: dict[str, int] = {
    "TAN GUEK LEN": 758,
    "QUAH CHEOW GUAT": 738,
    "HANG MA SANG": 700,
    "THE SOCK LEK": 647,         # Teh Sock Lek; notes 2024-11..2025-04, resident 2021..2026
    "TAN HUA SHE": 730,          # TAN HUA SEH; notes 2024-12..2025-01, adm 2024-11-04 dis 2025-01-28
    "LEE SHEAU HUEY": 724,       # LIM SHEAU HUEY; notes 5-6 Nov 2024, adm 2024-11-04
    "HG AH HUAH": 781,           # NG AH HUAH; notes 14-15 Jan 2026, adm 2026-01-14
    "TANG SAW YING": 701,        # TANG SAW YIN; resident since 2024-05-02
    "TAN GUEK LAN": 758,         # TAN GUEK LEN -- follows her override above
    "NG WILLL JEAH": 660,        # Ng Wil Jeah; resident since 2023-04-01
    "SHUM UM CHIN CHOON": 649,   # SHUM CHIN CHOON; resident 2021-09-15..2025-03-30
    "SHUM": 649,                 # note on 2025-03-30, his discharge day; only Shum on record
    "LOH MUY CHUNG": 745,        # LOH MOOI CUNG; note 2025-03-10 = admission day
    "KUMAR": 716,                # PULAMI KUMAR; the only Kumar resident on 2024-12-16
}

# Access staff names that are not the person's name. 'patricia' is Teoh Ying
# Ying (HQ-0003, Nursing Director) -- confirmed by the owner. 'sn syaa' is Syaa
# at ALMA (AMN-0024); the bare name 'Syaa' is ambiguous because BGN-0018 has the
# same name, so the explicit branch pick is required rather than optional.
STAFF_ALIASES: dict[str, str] = {
    "patricia": "HQ-0003",
    "sn syaa": "AMN-0024",
    "syaa": "AMN-0024",
    # tbl_PhyIPProgressNote's Therapist column writes Ian Cheen Yik Yuan (AMN-0033)
    # three ways, and the date spans are contiguous and non-overlapping -- one
    # person whose Access entry style changed over time:
    #     'Physiotherapist Ian' / 'PHYSIO IAN' / 'Physiotherapy Ian'  79 rows
    #        2023-08-23 -> 2023-11-08
    #     3 misspellings of 'Physiotherapist'                        3 rows
    #        2023-09-27 -> 2023-11-01  (nested inside the window above)
    #     'Ian Cheen Yik Yuan'                                      81 rows
    #        2023-11-15 -> 2024-07-29
    # The correctly-spelled titles normalise to a bare given name ('ian'),
    # which does not match the roster's full name; the 3 typos are not title
    # words at all. The bare string 'ian' is deliberately NOT aliased -- two
    # clinicians can share a first name, and a note resolving to the wrong
    # person is worse than one left unattributed. Each exact source string is
    # asserted instead, so a future note reading only 'Ian' still falls
    # through to review rather than being captured here.
    "phsiotherapist ian": "AMN-0033",
    "phyiotherapist ian": "AMN-0033",
    "physiotherpist ian": "AMN-0033",
    "physio ian": "AMN-0033",
    "physiotherapy ian": "AMN-0033",
    # covers 'PHYSIOTHERAPIST IAN' / 'Physiotherapist Ian' / 'Physiotherapist ian'
    "physiotherapist ian": "AMN-0033",
}

# Sentinel alias target: the name is known, reviewed with the owner, and
# deliberately left unattributed -- it must NOT fall through to the part-time
# registry and create a staff record.
UNATTRIBUTED = ""

# Aliases that are facts about ONE branch's staff, not general patterns, so they
# are looked up only while that branch is being migrated. Every entry below was
# confirmed one by one with the owner on 2026-09-26 against the AMN roster
# (tbl_NursingChart 'Review by'). Do not copy them to another branch: 'Dewi' and
# 'Ros' exist at BGN/BMN too, and 'mary' -> Meere is an owner fact, not a
# spelling rule.
BRANCH_STAFF_ALIASES: dict[str, dict[str, str]] = {
    "AMN": {
        # Same name at other branches; AMN's own staff member is the one who
        # charted at AMN.
        "dewi": "AMN-0021",
        "ros": "AMN-0020",
        # Given name / 'SN' (staff nurse) prefix / spelling variants.
        "ivy": "AMN-0017",
        "sn ivy": "AMN-0017",
        "sn aini": "AMN-0016",
        "mera": "AMN-0014",
        "mearawati": "AMN-0014",
        "merawatu": "AMN-0014",
        "m": "AMN-0004",
        "mar": "AMN-0004",
        "m ard": "AMN-0004",       # 'm,ard' after _norm
        "mere": "AMN-0025",
        "meeere": "AMN-0025",
        "meerre": "AMN-0025",
        "neere": "AMN-0025",
        "a n meere": "AMN-0025",   # 'a/n meere' -- a/n = assistant nurse
        "mary": "AMN-0025",
        "nabila": "AMN-0013",
        "aiah": "AMN-0023",
        # Not a staff member -- most likely the resident 'LOH POH CHAN @ ALICE'
        # typed into the wrong box. Left unattributed by owner decision.
        "alice": UNATTRIBUTED,
    },
}

# Names that match no roster entry and that the owner APPROVED, one by one, to
# be created as part-time staff (PART_TIME_* fields below). Only these are ever
# created; any other unmatched name is reported and left unattributed until it
# is reviewed. Keyed by _norm(name) -> the staff_name to create.
APPROVED_PART_TIME: dict[str, dict[str, str]] = {
    "AMN": {
        "asyiqin": "Asyiqin",
        "ayu": "Ayu",
        "siti": "Siti",
    },
}

# 'Merawati and rozie' / 'Zulaikha, dewi' / 'Farah Najwa& AYU' /
# 'Shazrianie  N DEWI': two people signed one entry. The attribution column holds
# one StaffID, so by owner decision the FIRST-named person is recorded.
_PAIR_SPLIT_RE = re.compile(r"\s*(?:,|&|\band\b|\bn\b)\s*", re.IGNORECASE)

# Auto-created part-time staff. tbl_staff has no 'part time' position and no
# non-Nursing department that fits, so both are fixed by owner decision and
# every candidate is listed in the dry-run report for approval.
PART_TIME_POSITION = "Healthcare Worker"
PART_TIME_DEPARTMENT = "Nursing"
PART_TIME_ROLE = "STAFF"
PART_TIME_STATUS = "INACTIVE"

# 'Merawati - Head Nurse' / 'Farah Suhana - Caregiver' / 'Hoo Suying -
# Physiotherapist': the job title is appended after a dash. Strip it -- the
# person is identified by the name, and the same person appears with several
# different titles across the four tables.
_ROLE_SUFFIX_RE = re.compile(
    r"\s*[-–—|]\s*("
    r"staff\s*nurse|head\s*nurse|nursing\s*director|assist\.?\s*nurse|"
    r"caregiver|medical\s*assistant|physiotherapist|physio\s*\w*|"
    r"staff\s*midwife|enrolled\s*nurse|registered\s*nurse|nurse"
    r")\s*$",
    re.IGNORECASE,
)

# Bare titles that prefix a name inconsistently: 'Dr. Irene' / 'Dr Irene' /
# 'Irene' are one person. 'Nur' is deliberately NOT in this list -- the roster
# may store 'Nur Atiqah' or 'Atiqah', so stripping it would be a guess. It is
# handled as an ordered primary-then-fallback candidate in _staff_candidates.
_DOCTOR_PREFIX_RE = re.compile(r"^dr\.?\s+", re.IGNORECASE)

# Honorifics that prefix a name and are sometimes written, sometimes not:
# 'Nur Atiqah' / 'Atiqah', 'Sr Lim' / 'Lim'. Tried only as a fallback after the
# full name misses. The trailing \b is load-bearing: without it this also
# mangles words that merely begin with those letters -- 'Physiotherapist Ian'
# would lose its P and become 'hysiotherapist ian'. 'enrolled' is included
# because the roster uses both 'Enrolled Nurse' and the bare 'enrolled' form.
_HONORIFIC_PREFIX_RE = re.compile(r"^(?:nur|sr|enrolled)\b\s*", re.IGNORECASE)

# A job title written in front of the name rather than after it, in the
# separator style Access used for the same thing elsewhere: 'physiotherapist -
# Athirah', 'Dr - Lim'. Stripped, leaving the person.
_LEADING_ROLE_RE = re.compile(
    r"^(?:dr|physiotherapist|physiotherapy|physio|therapist)\b\.?\s*[-–—|]\s+",
    re.IGNORECASE,
)

# A title word in front of the name with no separator at all: 'Physiotherapist
# Ian' / 'Physiotherapy Ian' / 'Physio Ian'. Only a leading run of known title
# words is removed, and a single word is required to follow, so 'Ian Cheen Yik
# Yuan' (a real roster name that starts with a bare given name) is left intact.
_LEADING_TITLE_WORDS = (
    r"physiotherapist|physiotherapy|physio|therapist|enrolled|registered|staff"
)
_LEADING_TITLE_RE = re.compile(
    rf"^(?:{_LEADING_TITLE_WORDS})\b\.?\s+(?=\w)", re.IGNORECASE
)

_WS_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^a-z ]+")


def _norm(text: str) -> str:
    """Casefold, drop punctuation, collapse whitespace -- for match keys only."""
    return _WS_RE.sub(" ", _NON_ALNUM_RE.sub(" ", text.lower())).strip()


def clean_ic(raw: str | None) -> str | None:
    """Normalise an IC to bare digits, applying the verified alias map."""
    if raw is None:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if not digits:
        return None
    return IC_ALIASES.get(digits, digits)


def split_alias(raw_name: str) -> tuple[str, str | None]:
    """'Cheah Khoon Gnoh @ Irene' -> ('Cheah Khoon Gnoh', 'Irene').

    The full 'A @ B' string is what Access holds and is never rewritten; the
    pre-'@' segment is only ever used as a match key. The alias is returned so
    callers can retain it.
    """
    text = clean_scalar(raw_name)
    if text is None:
        return ("", None)
    if "@" in text:
        primary, _, alias = text.partition("@")
        return (primary.strip(), alias.strip() or None)
    return (text, None)


def resident_match_keys(raw_name: str) -> list[str]:
    """Match keys for a resident name, in priority order.

    The full name first, then the pre-'@' primary. Neither key is ever written
    back to the database -- tbl_progress_notes and tbl_hospital_referrals have
    no name column at all, the name lives in tbl_residents.resident_name from
    the earlier resident migration.
    """
    text = clean_scalar(raw_name)
    if text is None:
        return []
    primary, _ = split_alias(text)
    keys = [_norm(text), _norm(primary)]
    seen: set[str] = set()
    return [k for k in keys if k and not (k in seen or seen.add(k))]


def _strip_role_suffix(name: str) -> str:
    return _ROLE_SUFFIX_RE.sub("", name).strip()


def _resident_override(raw_name: str | None) -> tuple[int, str] | None:
    """(target_id, match_key) if this name has an asserted override."""
    text = clean_scalar(raw_name)
    if text is None:
        return None
    primary, _ = split_alias(text)
    for key in resident_match_keys(text):
        target = RESIDENT_OVERRIDES.get(key.upper().strip())
        if target is not None:
            return (target, _norm(primary))
    return None


# Overrides whose source name is a MISSPELLING and so deliberately does not
# match the target resident's name. The match guard in ResidentIndex.resolve
# exists to catch a stale override pointing at a resident who no longer matches
# what was asserted; for these it would always fail, so they are listed here to
# be verified only for existence in the master list, not for name equality.
# Names shared by two DIFFERENT residents, where neither IC helps, resolved by
# the note's date: the resident with the latest admission on or before it.
# QUAH CHEOW GUAT: 738 admitted 2025-01-18 (discharged 01-21), 778 admitted
# 2025-12-14. Her 21 NursingChart rows split 15 (Jan 2025) / 6 (Dec 2025); the
# undated RESIDENT_OVERRIDES entry would have put all 21 on 738. Used only when
# the caller passes the note's date; otherwise RESIDENT_OVERRIDES applies.
ADMISSION_WINDOW_OVERRIDES: dict[str, tuple[int, ...]] = {
    "QUAH CHEOW GUAT": (738, 778),
}

SPELLING_OVERRIDES: frozenset[str] = frozenset({
    "HANG MA SANG", "THE SOCK LEK", "TAN HUA SHE", "LEE SHEAU HUEY", "HG AH HUAH",
    "TANG SAW YING", "TAN GUEK LAN", "NG WILLL JEAH", "SHUM UM CHIN CHOON", "SHUM",
    "LOH MUY CHUNG", "KUMAR",
})


def _staff_candidates(raw_name: str) -> list[str]:
    """Ordered match keys for a staff name.

    Primary is the name with any job title stripped, minus a 'Dr' prefix.
    A leading 'Nur'/'Sr' is KEPT in the primary key, and retried without it as
    a fallback only if the primary finds nothing -- never both, and never in
    preference to an exact hit.
    """
    name = _strip_role_suffix(clean_scalar(raw_name) or "")
    if not name:
        return []
    # A title in front of the name ('Physiotherapist Ian', 'physio - Athirah')
    # is stripped first; then a 'Dr' prefix. Order matters: 'Dr' can itself be
    # part of a leading title run.
    name = _LEADING_ROLE_RE.sub("", name).strip()
    name = _LEADING_TITLE_RE.sub("", name).strip()
    without_dr = _DOCTOR_PREFIX_RE.sub("", name).strip()
    primary = _norm(without_dr)
    if not primary:
        return []
    keys = [primary]
    without_nur = _norm(_HONORIFIC_PREFIX_RE.sub("", without_dr))
    if without_nur and without_nur != primary:
        keys.append(without_nur)
    return keys


@dataclass
class PartTimeCandidate:
    """A staff name that appeared on clinical records but matched no roster
    entry -- proposed for an auto-created part-time record, pending approval."""

    raw_name: str
    staff_name: str
    position: str = PART_TIME_POSITION
    department: str = PART_TIME_DEPARTMENT
    occurrences: int = 0
    tables: set[str] = field(default_factory=set)


class PartTimeRegistry:
    """Collects part-time candidates across a run so the dry-run can list every
    one of them, deduplicated, with its proposed fields."""

    def __init__(self, report):
        self.report = report
        self._by_name: dict[str, PartTimeCandidate] = {}

    def register(self, raw_name: str, staff_name: str, table: str) -> PartTimeCandidate:
        key = _norm(staff_name)
        candidate = self._by_name.get(key)
        if candidate is None:
            candidate = PartTimeCandidate(raw_name=raw_name, staff_name=staff_name)
            self._by_name[key] = candidate
        candidate.occurrences += 1
        candidate.tables.add(table)
        # One line per distinct name is rendered by render(); a note per
        # occurrence buried the report under thousands of identical lines.
        return candidate

    def contains(self, raw_name: str | None) -> bool:
        """True if this name was registered as an unmatched candidate."""
        name = clean_scalar(raw_name)
        return bool(name) and _norm(_strip_role_suffix(name)) in self._by_name

    def candidates(self) -> list[PartTimeCandidate]:
        return sorted(self._by_name.values(), key=lambda c: (-c.occurrences, c.staff_name))

    def render(self) -> str:
        rows = self.candidates()
        if not rows:
            return ""
        lines = [
            f"## Unmatched staff names awaiting review ({len(rows)} distinct)",
            "",
            "These staff names appear on clinical records but match no row in tbl_staff,",
            "no alias, and no owner-approved part-time name (APPROVED_PART_TIME). They",
            "are NOT created in either mode; their rows stay unattributed until each",
            "name is reviewed and added to an alias or APPROVED_PART_TIME.",
            "",
            "| staff_name | source name | position | department | role | status | rows | tables |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for c in rows:
            src = c.raw_name if c.raw_name == c.staff_name else f"`{c.raw_name}`"
            lines.append(
                f"| {c.staff_name} | {src} | {c.position} | {c.department} | "
                f"{PART_TIME_ROLE} | {PART_TIME_STATUS} | {c.occurrences} | {', '.join(sorted(c.tables))} |"
            )
        lines.append("")
        return "\n".join(lines)


class ResidentIndex:
    """tbl_residents as the master list, indexed by IC and by name."""

    def __init__(self, pg_conn, branch_id: int, report):
        self.report = report
        self.by_ic: dict[str, int] = {}
        # resident id -> its IC, so a name that matches several rows can be
        # collapsed when they are demonstrably the same person (see resolve).
        self.ic_of: dict[int, str] = {}
        # name -> set of ids. >1 means ambiguous, which is only resolved when the
        # candidates are provably one person; otherwise never silently.
        self.by_name: dict[str, set[int]] = defaultdict(set)
        # every resident id in the master list, for existence checks
        self.ids: set[int] = set()

        cur = pg_conn.cursor()
        cur.execute(
            "select id, resident_name, ic_number, admission_date from tbl_residents where branch_id = %s",
            (branch_id,),
        )
        rows = cur.fetchall()
        self.admitted: dict[int, object] = {}
        for rid, name, ic, admitted in rows:
            self.ids.add(rid)
            self.admitted[rid] = admitted
            if ic:
                normalised = IC_ALIASES.get(str(ic).strip(), str(ic).strip())
                self.by_ic.setdefault(normalised, rid)
                self.ic_of[rid] = normalised
            for key in resident_match_keys(name):
                self.by_name[key].add(rid)
        self.total = len(rows)
        report.inc("residents.master_list", len(rows))

    def _collapse_duplicates(self, candidates: set[int]) -> int | None:
        """Several name matches that all carry the SAME IC are one person,
        registered more than once. Return the lowest id.

        Access let a resident be registered repeatedly; the duplicates carry
        identical ICs and, in the cases seen, identical admission dates, so
        choosing between them is picking a row for a person, not a person for a
        row. TAN GUEK LEN is the same failure at a larger scale and is settled by
        an asserted override instead -- there the three registrations have
        DIFFERENT admission windows, so only the newest is correct.

        Returns None unless every candidate agrees, so a genuine same-name
        collision between different people still falls through to the ambiguity
        guard.
        """
        if len(candidates) < 2:
            return None
        ic = clean_scalar(self.ic_of.get(next(iter(candidates))))
        if not ic:
            return None
        if all(self.ic_of.get(c) == ic for c in candidates):
            return min(candidates)
        return None

    def resolve(self, raw_name: str | None, raw_ic: str | None,
                when=None) -> tuple[int | None, str]:
        """IC wins over name. Returns (resident_id | None, reason).

        A row is skipped rather than guessed whenever the IC and the name
        disagree, or the name is ambiguous -- a clinical note attached to the
        wrong resident is worse than a missing one.

        `when` (the note's datetime) enables ADMISSION_WINDOW_OVERRIDES.
        """
        if when is not None:
            key = (clean_scalar(raw_name) or "").strip().upper()
            window_ids = ADMISSION_WINDOW_OVERRIDES.get(key)
            if window_ids:
                day = when.date() if hasattr(when, "date") else when
                admitted = [(self.admitted.get(i), i) for i in window_ids
                            if i in self.ids and self.admitted.get(i) and self.admitted[i] <= day]
                if admitted:
                    target = max(admitted)[1]
                    self.report.fuzzy("resident_admission_window", str(raw_name),
                                      f"resident {target} (latest admission on/before {day})")
                    return target, "admission-window override (see ADMISSION_WINDOW_OVERRIDES)"
                return None, f"{raw_name!r} on {day}: before any candidate's admission"
        ic = clean_ic(raw_ic)
        by_ic = self.by_ic.get(ic) if ic else None

        name_candidates: set[int] = set()
        for key in resident_match_keys(raw_name):
            name_candidates |= self.by_name.get(key, set())
        by_name = next(iter(name_candidates)) if len(name_candidates) == 1 else None

        # Asserted overrides, checked before the ambiguity/IC-conflict guards so
        # they can settle a case the generic rules deliberately refuse to guess.
        # Logged every time, since a silently-picked resident is the failure
        # mode this whole module exists to prevent.
        override = _resident_override(raw_name)
        if override is not None:
            target, matched_name = override
            # A misspelling override never matches the target's name by
            # construction -- that is the whole point of asserting it -- so it
            # is verified only for existing in the master list. Every other
            # override must still name a resident that actually matches, which
            # is what catches an override going stale after a rename.
            if (clean_scalar(raw_name) or "").strip().upper() in SPELLING_OVERRIDES:
                valid = target in self.ids
            else:
                valid = target in self.by_name.get(matched_name, set()) or target == by_ic
            if valid:
                self.report.fuzzy(
                    "resident_override",
                    str(raw_name),
                    f"resident {target} (asserted override)",
                )
                return target, "asserted override (see RESIDENT_OVERRIDES)"

        if by_ic and by_name and by_ic != by_name:
            return None, f"IC {ic} resolves to resident {by_ic} but name {raw_name!r} to {by_name}"
        if by_ic:
            return by_ic, "matched on IC"
        if by_name:
            return by_name, "matched on name (no usable IC)"

        collapsed = self._collapse_duplicates(name_candidates)
        if collapsed is not None:
            self.report.fuzzy(
                "resident_duplicate_registration",
                str(raw_name),
                f"resident {collapsed} ({sorted(name_candidates)} share one IC "
                f"{self.ic_of.get(collapsed)})",
            )
            return collapsed, "collapsed duplicate registration (same IC)"
        if len(name_candidates) > 1:
            return None, f"ambiguous name {raw_name!r} -> {sorted(name_candidates)}"

        if ic and ic not in self.by_ic:
            return None, f"IC {ic} not in master list and name {raw_name!r} did not match"
        return None, f"no match for name {raw_name!r} / IC {raw_ic!r}"


class StaffIndex:
    """tbl_staff across ALL branches, indexed by normalized name."""

    def __init__(self, pg_conn, report, branch_code: str | None = None,
                 branch_id: int | None = None, dry_run: bool = True):
        self.report = report
        self.pg_conn = pg_conn
        self.branch_code = branch_code
        self.branch_id = branch_id
        self.dry_run = dry_run
        self.by_name: dict[str, set[str]] = defaultdict(set)  # norm name -> StaffIDs
        self.part_time = PartTimeRegistry(report)
        self.branch_aliases = BRANCH_STAFF_ALIASES.get(branch_code or "", {})
        self.approved_part_time = APPROVED_PART_TIME.get(branch_code or "", {})
        self._part_time_ids: dict[str, str] = {}  # approved staff_name -> StaffID

        cur = pg_conn.cursor()
        cur.execute('select "StaffID", staff_name from tbl_staff')
        for staff_id, name in cur.fetchall():
            for key in _staff_candidates(name):
                self.by_name[key].add(staff_id)
        self.total = sum(len(v) for v in self.by_name.values())
        report.inc("staff.roster_all_branches", self.total)

    def resolve(self, raw_name: str | None, table: str) -> str | None:
        """Resolve to a StaffID, or register a part-time candidate and return None.

        Tries each candidate key in priority order and takes the first that hits
        exactly one StaffID. A key matching several different people is treated
        as a miss, not a coin flip.

        A name naming two people ('Merawati and rozie') resolves to the
        first-named person, by owner decision -- the attribution column holds a
        single StaffID.
        """
        name = clean_scalar(raw_name)
        if name is None:
            return None

        staff_id, settled = self._resolve_one(name, table)
        if settled:
            return staff_id

        parts = [p for p in _PAIR_SPLIT_RE.split(name) if p.strip()]
        if len(parts) > 1:
            first = parts[0].strip()
            staff_id, settled = self._resolve_one(first, table)
            if not settled:
                # 'Shazrianie DEWI N HAS': no separator between the first two
                # names, so try the leading words of the first segment, longest
                # first. An ambiguous prefix ('Farah') settles as unattributed.
                words = first.split()
                for n in range(len(words) - 1, 0, -1):
                    staff_id, settled = self._resolve_one(" ".join(words[:n]), table)
                    if settled:
                        break
            if settled:
                self.report.fuzzy(f"staff_pair:{table}", name,
                                  f"{staff_id or 'unattributed'} (first-named person)")
                return staff_id

        staff_name = _strip_role_suffix(name)
        self.part_time.register(name, staff_name, table)
        return None

    def _resolve_one(self, name: str, table: str) -> tuple[str | None, bool]:
        """(StaffID | None, settled). `settled` is False only when nothing at all
        recognised the name -- the caller may then try it as a pair, or register
        it as a part-time candidate. An ambiguous name is settled (as None)."""
        key = _norm(name)

        # Asserted aliases beat every generic rule: 'patricia' and 'sn syaa'
        # are not names, and 'Syaa' alone collides across AMN/BGN.
        alias = STAFF_ALIASES.get(key)
        if alias is None:
            alias = self.branch_aliases.get(key)
        if alias is not None:
            self.report.fuzzy(f"staff_alias:{table}", name,
                              f"{alias} (asserted alias)" if alias else "unattributed (asserted)")
            return (alias or None), True

        if key in self.approved_part_time:
            return self._approved_part_time(self.approved_part_time[key], table), True

        for cand in _staff_candidates(name):
            hits = self.by_name.get(cand, set())
            if len(hits) == 1:
                (staff_id,) = hits
                if cand != _staff_candidates(name)[0]:
                    self.report.fuzzy(
                        f"staff_fallback:{table}",
                        name,
                        f"{staff_id} (via '{cand}')",
                    )
                return staff_id, True
            if len(hits) > 1:
                self.report.fuzzy(
                    f"staff_ambiguous:{table}", name, f"{len(hits)} candidates: {sorted(hits)}"
                )
                return None, True
        return None, False

    def _approved_part_time(self, staff_name: str, table: str) -> str | None:
        """StaffID of an owner-approved part-time staff member, creating the
        tbl_staff row on first use in a COMMIT run. Returns None in a dry run
        (nothing is created) -- the report counts the rows it would attribute.

        Idempotent by looking the row up by exact name in the branch before
        inserting. etl.id_map cannot hold it: its target_id is bigint and
        tbl_staff's key is the text "StaffID" ('AMN-0034'), with no numeric id.
        Note tbl_staff's staff_to_google trigger mirrors the new row to the
        staff Google Sheet.
        """
        self.report.inc(f"part_time_staff.approved_rows:{staff_name}")
        if self.dry_run:
            return None
        if staff_name in self._part_time_ids:
            return self._part_time_ids[staff_name]

        cur = self.pg_conn.cursor()
        cur.execute(
            'select "StaffID" from tbl_staff where branch_id = %s and staff_name = %s',
            (self.branch_id, staff_name),
        )
        found = cur.fetchall()
        if len(found) > 1:
            raise RuntimeError(f"{len(found)} tbl_staff rows named {staff_name!r} in this branch")
        if found:
            (staff_id,) = found[0]
        else:
            cur.execute("select id from tbl_positions where name = %s", (PART_TIME_POSITION,))
            pos = cur.fetchone()
            if pos is None:
                raise RuntimeError(f"position {PART_TIME_POSITION!r} not in tbl_positions")
            cur.execute(
                """
                insert into tbl_staff (branch_id, staff_name, position_id, role, department, status)
                values (%s, %s, %s, %s, %s, %s)
                returning "StaffID"
                """,
                (self.branch_id, staff_name, pos[0], PART_TIME_ROLE, PART_TIME_DEPARTMENT,
                 PART_TIME_STATUS),
            )
            (staff_id,) = cur.fetchone()
            self.report.inc("part_time_staff.created")
            self.report.note(f"created part-time staff {staff_id} for {staff_name!r} (owner-approved)")
        self._part_time_ids[staff_name] = staff_id
        return staff_id
