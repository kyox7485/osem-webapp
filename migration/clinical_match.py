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
     candidate and creates none; creation happens only in the commit run.

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
RESIDENT_OVERRIDES: dict[str, int] = {
    "TAN GUEK LEN": 758,
    "QUAH CHEOW GUAT": 738,
    "HANG MA SANG": 700,
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
SPELLING_OVERRIDES: frozenset[str] = frozenset({"HANG MA SANG"})


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
        self.report.note(
            f"part-time staff candidate {staff_name!r} (from {raw_name!r}) in {table} "
            f"x{candidate.occurrences} -- no tbl_staff match; would be created as "
            f"{candidate.position}/{candidate.department} (status {PART_TIME_STATUS})."
        )
        return candidate

    def candidates(self) -> list[PartTimeCandidate]:
        return sorted(self._by_name.values(), key=lambda c: (-c.occurrences, c.staff_name))

    def render(self) -> str:
        rows = self.candidates()
        if not rows:
            return ""
        lines = [
            f"## Part-time staff to be created ({len(rows)} distinct)",
            "",
            "These staff names appear on clinical records but match no row in tbl_staff.",
            "Per decision they are treated as part-time, non-registered staff and will",
            "be auto-created in the COMMIT run. Nothing is created during a dry run.",
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
            "select id, resident_name, ic_number from tbl_residents where branch_id = %s",
            (branch_id,),
        )
        rows = cur.fetchall()
        for rid, name, ic in rows:
            self.ids.add(rid)
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

    def resolve(self, raw_name: str | None, raw_ic: str | None) -> tuple[int | None, str]:
        """IC wins over name. Returns (resident_id | None, reason).

        A row is skipped rather than guessed whenever the IC and the name
        disagree, or the name is ambiguous -- a clinical note attached to the
        wrong resident is worse than a missing one.
        """
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

    def __init__(self, pg_conn, report):
        self.report = report
        self.by_name: dict[str, set[str]] = defaultdict(set)  # norm name -> StaffIDs
        self.part_time = PartTimeRegistry(report)

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
        """
        name = clean_scalar(raw_name)
        if name is None:
            return None

        # Asserted aliases beat every generic rule: 'patricia' and 'sn syaa'
        # are not names, and 'Syaa' alone collides across AMN/BGN.
        alias = STAFF_ALIASES.get(_norm(name))
        if alias is not None:
            self.report.fuzzy(f"staff_alias:{table}", name, f"{alias} (asserted alias)")
            return alias

        for key in _staff_candidates(name):
            hits = self.by_name.get(key, set())
            if len(hits) == 1:
                (staff_id,) = hits
                if key != _staff_candidates(name)[0]:
                    self.report.fuzzy(
                        f"staff_fallback:{table}",
                        name,
                        f"{staff_id} (via '{key}')",
                    )
                return staff_id
            if len(hits) > 1:
                self.report.fuzzy(
                    f"staff_ambiguous:{table}", name, f"{len(hits)} candidates: {sorted(hits)}"
                )
                return None

        staff_name = _strip_role_suffix(name)
        self.part_time.register(name, staff_name, table)
        return None
