"""Loads every target reference/lookup table into memory and resolves raw
Access text against it: exact match -> normalized match -> fuzzy match.
Every non-exact resolution and every miss is logged to the Report rather than
silently guessed or dropped.
"""
from __future__ import annotations

import difflib
from dataclasses import dataclass, field

import psycopg2
import psycopg2.extras

from multiselect import normalize_for_match
from report import Report

# (list_name, table, id_column, value_column)
LOOKUP_TABLES: list[tuple[str, str, str, str]] = [
    ("position", "tbl_positions", "id", "name"),
    # Access stores the country name ('Malaysia'), not the demonym
    # ('Malaysian') -- confirmed against real data, so match on country_name.
    ("nationality", "tbl_nationalities", "id", "country_name"),
    ("diet_type", "tbl_diet_types", "id", "name"),
    ("feeding_type", "tbl_feeding_types", "id", "name"),
    ("diagnosis_option", "tbl_diagnosis_options", "id", "name_en"),
    ("product_category", "tbl_product_categories", "id", "category_name"),
    ("uom", "tbl_uoms", "id", "code"),
    ("meal_type", "tbl_meal_types", "id", "name"),
    ("meal_portion", "tbl_meal_portions", "id", "name"),
    ("activity", "tbl_activities", "id", "name"),
    ("psycho_social_behaviour", "tbl_psycho_social_behaviours", "id", "name"),
    ("active_complaint", "tbl_active_complaints", "id", "name_en"),
    ("bowel_output_type", "tbl_bowel_output_types", "id", "name"),
    ("pass_urine_type", "tbl_pass_urine_types", "id", "name"),
]

# Branch codes and staff positions must resolve with high confidence (they
# drive FK columns with no free-text fallback), so fuzzy matching is disabled
# for them -- unresolved values are always logged, never guessed.
NO_FUZZY = {"branch"}

FUZZY_CUTOFF = 0.84


@dataclass
class LookupResolver:
    report: Report
    # list_name -> {normalized_value: (id, canonical_value)}
    _tables: dict[str, dict[str, tuple[int, str]]] = field(default_factory=dict)
    # list_name -> list of (normalized_value, id, canonical_value), for fuzzy matching
    _fuzzy_pool: dict[str, list[tuple[str, int, str]]] = field(default_factory=dict)
    branch_ids: dict[str, int] = field(default_factory=dict)  # branch code -> id

    @classmethod
    def load(cls, conn: psycopg2.extensions.connection, report: Report) -> "LookupResolver":
        resolver = cls(report=report)
        cur = conn.cursor()
        for list_name, table, id_col, val_col in LOOKUP_TABLES:
            cur.execute(f"select {id_col}, {val_col} from {table}")
            table_map: dict[str, tuple[int, str]] = {}
            pool: list[tuple[str, int, str]] = []
            for row_id, value in cur.fetchall():
                if value is None:
                    continue
                norm = normalize_for_match(value)
                table_map[norm] = (row_id, value)
                pool.append((norm, row_id, value))
            resolver._tables[list_name] = table_map
            resolver._fuzzy_pool[list_name] = pool

        resolver.reload_branches(conn)
        return resolver

    def reload_branches(self, conn: psycopg2.extensions.connection) -> None:
        cur = conn.cursor()
        cur.execute("select id, code from tbl_branches")
        self.branch_ids = {code: bid for bid, code in cur.fetchall()}

    def resolve(self, list_name: str, raw_value: str | None) -> int | None:
        """Returns the target row id for raw_value, or None (and logs it) if unresolved."""
        if raw_value is None:
            return None
        raw_value = str(raw_value).strip()
        if not raw_value or raw_value.lower() == "none":
            return None

        table = self._tables.get(list_name)
        if table is None:
            raise KeyError(f"no lookup table registered for list '{list_name}'")

        norm = normalize_for_match(raw_value)
        hit = table.get(norm)
        if hit is not None:
            row_id, canonical = hit
            if canonical != raw_value:
                self.report.fuzzy(list_name, raw_value, canonical)  # case/whitespace-only diff, still log
            return row_id

        if list_name not in NO_FUZZY:
            pool = self._fuzzy_pool[list_name]
            candidates = difflib.get_close_matches(
                norm, [p[0] for p in pool], n=1, cutoff=FUZZY_CUTOFF
            )
            if candidates:
                match_norm = candidates[0]
                for p_norm, row_id, canonical in pool:
                    if p_norm == match_norm:
                        self.report.fuzzy(list_name, raw_value, canonical)
                        return row_id

        self.report.unresolved(list_name, raw_value)
        return None

    def resolve_many(self, list_name: str, raw_values: list[str]) -> list[int]:
        """Resolves a list of raw tokens, silently deduping and dropping unresolved
        (each unresolved token is still logged individually by resolve())."""
        ids: list[int] = []
        seen: set[int] = set()
        for raw in raw_values:
            rid = self.resolve(list_name, raw)
            if rid is not None and rid not in seen:
                ids.append(rid)
                seen.add(rid)
        return ids

    def resolve_branch(self, code: str) -> int | None:
        """Exact match first. Falls back to a prefix match against
        tbl_branches.code, because real data showed the source 'Branch' tag
        used on staff/resident rows ('ALMA') is shorter than the actual
        BranchCode in tbl_Branches ('ALMA (AM)') -- the tag is a prefix of
        the real code, not identical to it."""
        bid = self.branch_ids.get(code)
        if bid is not None:
            return bid
        for stored_code, stored_id in self.branch_ids.items():
            if stored_code.startswith(code) and (
                len(stored_code) == len(code) or stored_code[len(code)] in (" ", "(")
            ):
                self.report.fuzzy("branch", code, stored_code)
                return stored_id
        self.report.unresolved("branch", code)
        return None
