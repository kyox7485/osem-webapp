"""Collects everything that didn't map cleanly during a migration run and
writes it to a human-readable report. Never silently drop something that
doesn't fit -- log it here instead.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass, field


@dataclass
class Report:
    branch_code: str
    dry_run: bool
    counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    unresolved_lookups: dict[str, dict[str, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int))
    )
    fuzzy_resolutions: list[tuple[str, str, str]] = field(default_factory=list)  # (list_name, raw, matched)
    skipped_rows: list[tuple[str, str, str]] = field(default_factory=list)  # (table, source_pk, reason)
    unparsed_blobs: list[tuple[str, str, str]] = field(default_factory=list)  # (table, source_pk, raw_text)
    notes: list[str] = field(default_factory=list)

    def inc(self, key: str, n: int = 1) -> None:
        self.counts[key] += n

    def unresolved(self, list_name: str, raw_value: str) -> None:
        self.unresolved_lookups[list_name][raw_value] += 1

    def fuzzy(self, list_name: str, raw_value: str, matched_value: str) -> None:
        self.fuzzy_resolutions.append((list_name, raw_value, matched_value))

    def skip_row(self, table: str, source_pk: object, reason: str) -> None:
        self.skipped_rows.append((table, str(source_pk), reason))

    def unparsed(self, table: str, source_pk: object, raw_text: str) -> None:
        self.unparsed_blobs.append((table, str(source_pk), raw_text))

    def note(self, text: str) -> None:
        self.notes.append(text)

    def render_markdown(self) -> str:
        lines: list[str] = []
        mode = "DRY RUN (no writes made)" if self.dry_run else "COMMIT (writes were made)"
        lines.append(f"# Migration report -- branch {self.branch_code} -- {mode}")
        lines.append(f"Generated: {dt.datetime.now().isoformat(timespec='seconds')}")
        lines.append("")

        lines.append("## Row counts")
        for k in sorted(self.counts):
            lines.append(f"- {k}: {self.counts[k]}")
        lines.append("")

        if self.notes:
            lines.append("## Notes")
            for n in self.notes:
                lines.append(f"- {n}")
            lines.append("")

        total_unresolved = sum(len(v) for v in self.unresolved_lookups.values())
        lines.append(f"## Unresolved lookup values ({total_unresolved} distinct values)")
        lines.append("These raw source values could not be matched to any row in the")
        lines.append("corresponding target lookup table (exact, normalized, or fuzzy).")
        lines.append("They were left unset / excluded rather than guessed.")
        lines.append("")
        for list_name in sorted(self.unresolved_lookups):
            values = self.unresolved_lookups[list_name]
            lines.append(f"### {list_name} ({len(values)} distinct unresolved)")
            for v, n in sorted(values.items(), key=lambda kv: -kv[1]):
                lines.append(f"- `{v!r}` (seen {n}x)")
            lines.append("")

        if self.fuzzy_resolutions:
            lines.append(f"## Fuzzy-matched lookup values ({len(self.fuzzy_resolutions)})")
            lines.append("Matched to a lookup value via normalization/fuzzy match, not an exact hit.")
            lines.append("Spot-check these.")
            lines.append("")
            for list_name, raw, matched in self.fuzzy_resolutions:
                lines.append(f"- [{list_name}] `{raw!r}` -> `{matched!r}`")
            lines.append("")

        if self.skipped_rows:
            lines.append(f"## Skipped rows ({len(self.skipped_rows)})")
            for table, pk, reason in self.skipped_rows:
                lines.append(f"- {table}#{pk}: {reason}")
            lines.append("")

        if self.unparsed_blobs:
            lines.append(f"## Unparsed free-text blobs ({len(self.unparsed_blobs)})")
            lines.append("Couldn't be confidently parsed into structured sub-rows (e.g. meal")
            lines.append("slots). The parent row was still migrated; this substructure was not.")
            lines.append("")
            for table, pk, raw in self.unparsed_blobs[:500]:
                lines.append(f"- {table}#{pk}: `{raw!r}`")
            if len(self.unparsed_blobs) > 500:
                lines.append(f"- ... and {len(self.unparsed_blobs) - 500} more")
            lines.append("")

        return "\n".join(lines)

    def write(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            f.write(self.render_markdown())
