# Migrating the next branch's clinical tables

A handoff written on 2026-09-26 after completing `AMN` (ALMA). The AMN run
itself is recorded in `docs/access-clinical-migration.md` — that is the log of
what happened. **This is the checklist for the branch after that**: the traps
that cost time or a wrong attribution, and what to check before you write
anything.

Status: `tbl_HospReferral`, `tbl_ProgressNote` and `tbl_PhyIPProgressNote` are
done **for AMN only**. `tbl_NursingChart` is not started anywhere. For the next
branch all four are unstarted, and none of the asserted overrides below
transfer — they are specific to AMN's people.

---

## 1. Do these five things before writing a single row

| # | Check | Why it bites |
|---|---|---|
| 1 | `BRANCH_CODE` in `.env` is a real `tbl_branches."BranchCode"` | `.env` said `ALMA`, which matches no row. The clinical transforms read it (unlike the resident migration, which resolved the branch from the Access DB). It now exits 3 with a report note instead of importing nothing. |
| 2 | Read the **live** target columns via `information_schema` | `schema/001_init.sql` is a stale snapshot. It cost a 25-minute commit that died at row 10,402 because Access's `Subjective` was mapped to a `subjective` column that only ever existed in the snapshot. |
| 3 | Confirm which branch owns the outpatient / support lists | The physio outpatient list "ready for ALMA" lives under **`AMP`**, with **0** `AMN` rows. A lookup scoped to the migrating branch resolves nothing. |
| 4 | Dry-run first, and actually read the report | The skip reasons in the report are the review material. A dry run is the only place a 156-row misattribution is visible before it is committed. |
| 5 | Check whether the master list has duplicate registrations | Both `tbl_residents` and `tbl_physio_op_patients` had people entered 2–3× under one IC. This is the single largest source of "ambiguous name" false alarms. |
| 6 | **Pin the session timezone before writing any timestamp** | §1a. Its absence silently displaced 15,653 clinical timestamps by 8 hours. |

---

## 1a. Pin the session timezone — the one that actually moved data

**Do this before the first commit of any branch.** It is a one-line fix, and
without it every timestamp the migration writes is 8 hours wrong.

Access has no concept of timezones and returns **naive** datetimes. Every target
timestamp column is `timestamptz`. So Postgres has to assume a zone for those
wall-clock values, and it uses the **session** `TimeZone` — which on this
Supabase project is `UTC`. Every Malaysian local time was therefore stored as if
it were UTC.

`run_migration.py` now issues `set time zone 'Asia/Kuala_Lumpur'` immediately
after connecting, so every transform inherits it. Keep that line above the
`try:` and commit it before the branch does anything else.

**Get the sign right — this is the part that is easy to get wrong.** Storing a
naive Malaysian time *as UTC* makes the instant **later** than intended, not
earlier. `17:31` local is stored as `17:31+00`, which is `01:31+08` the next
day. The correction is therefore **`- interval '8 hours'`**, not `+`. During
this incident the `+8` version was applied first, which pushed every row a
further day forward, before the sign was caught and reversed.

**Verify against a known source value, never by reasoning about the offset:**

```
Access RID 10402       = 2026-03-18 17:31:31   (Malaysia wall clock)
stored before any fix  = 2026-03-18 17:31:31+00
rendered in Asia/KL    = 2026-03-19 01:31:31   <-- wrong
after -8h              = 2026-03-18 17:31:31+08
```

A whole-day shift on a chart is a clinical error, not a cosmetic one: it moves
notes across dates and misstates when care happened.

**Correcting it afterwards** (`scripts/fix_tz_off_by_8.sql`, applied and
verified 2026-09-26): scope the update through `etl.id_map` on
`(source_table, source_id, branch_code)` so it touches only rows this migration
wrote and leaves hand-created rows alone; shift only the **source-side** column
(`entry_timestamp`, `referral_datetime`); and leave `created_at`/`updated_at`
alone — those record when the row was written, which really was that day.

**Then prove it field-by-field.** Row counts and checksums show *that* a write
happened, not that the values are right — a wrong-direction update still moves
a checksum, so checksums would not have caught the sign error. Comparing every
migrated row against its Access source is what did.

Use the right source key per table: `tbl_PhyIPProgressNote` keys on `ID`, but
`tbl_ProgressNote` and `tbl_HospReferral` key on **`RID`**. A `select [ID]`
against the latter two raises a confusing ODBC *"Too few parameters"* error
rather than a missing-column error, so it reads like a quoting bug.

Result after the fix: **15,653 of 15,653 rows exactly matching source, 0
mismatches** (10,630 physio + 4,970 progress notes + 53 referrals).
**Verify the schema-snapshot claim for yourself.** `physio_assessments` drifted
in five ways that are not in the snapshot: `resident_id` lost its `NOT NULL`,
and `op_patient_id`, `care_setting`, `documented_by_other` and
`physio_assessments_patient_ref_check` were added. Whatever else is stale
elsewhere, this table alone is proof the file is not authoritative.

---

## 2. Identity resolution — the rules that are load-bearing

Full detail in `clinical_match.py`; the decisions that generalise:

- **IC wins, ambiguity is never resolved by guessing.** A clinical note on the
  wrong resident is worse than a missing one. Conflict → skip and log.
- **Access's own `ResidentID` column is never an authority.** It is NULL in all
  5,117 `tbl_ProgressNote` rows anyway.
- **Same IC across duplicate registrations = one person, not a conflict.**
  Collapse to the lowest id. This is the exception that keeps the IC-vs-name
  guard from firing on `TAN GUEK LEN` (3 rows) and `ROHANA` (2 rows).
- **Staff must be indexed across all branches, not the migrating one.** 51% of
  AMN's `ReviewBy` values are cross-branch attributions, and
  `tbl_staff."StaffID"` has no branch constraint, so those are structurally
  valid. Scoping the staff index to the branch loses half your attributions.
- **An unknown staff name is auto-created part-time, never dropped and never
  guessed** — and it is listed in the dry-run report for approval *before*
  anything is created. `part_time_staff.py` runs last and back-fills
  `reviewed_by` / `documented_by` on rows already written.
- **Contentless rows are skipped, and the check runs *before* identity
  resolution** — a row with only a timestamp has nothing to attribute, so
  resolving it could only land an empty note on the wrong chart. 144 of 5,117
  ProgressNote rows (2.8%) and 4 of the physio rows are these.
- **A column can be "dropped" and still count as content.** `TCA`,
  `PastMedCondition` and `CurrMedRegime` have no target column but count as
  content — a note whose only text is one of them is a real encounter, and
  skipping it loses data silently.

### Asserted overrides are per-branch

`RESIDENT_OVERRIDES`, `STAFF_ALIASES` and `IC_ALIASES` in `clinical_match.py`
are **AMN-specific facts, not patterns.** Each is commented with the evidence
that established it. For the next branch, re-derive them:

- A duplicate-registration collapse **can be computed** — same IC, collapse to
  lowest id. Prefer that over a hardcoded id.
- A name that is not the person's name (`patricia` → the Nursing Director) or
  a first name shared by two people (`syaa` → `AMN-0024` vs `BGN-0018`) **cannot
  be computed.** Someone has to decide, and the decision goes in the file with
  its evidence.
- **Do not alias a bare first name.** AMN's `physiotherapist ian` is safe
  because the *title* is in the string. The bare `ian` was deliberately left
  out: two clinicians can share a first name, and a note attributed to the
  wrong one is worse than one left unattributed. The same reasoning should gate
  every alias you add.
- When you assert an override whose target's **name differs** from the source
  string (a misspelling correction), it goes in `SPELLING_OVERRIDES` — the
  validity check otherwise demands name equality and the override silently
  never fires.

---

## 3. Read the live schema, not the snapshot

Add `_assert_target_columns()` to any new transform. It costs a second and
turns a 25-minute mid-run abort into an immediate, named failure. The AMN
transform is the model: query `information_schema.columns`, diff against the
columns you intend to write, raise listing what's missing.

Also read **`data_type`** while you're there, not just the names — see §5.

### Check constraints may need widening first

Access carries values the app's enumerated lists never had. The physio run
needed `scripts/physio_widen_checks.sql` applied once before its first commit:

- `treatment_type` 17 → 21 values (`Full Physio`, `Patient Went Out`,
  `Not Performed`)
- `treatment_compliance` 4 → 5 (`0%`)

**Widen rather than discard a real source value** — `0%` is a genuine
completion, not a null marker, and it co-occurs with real treatments. But
widen only for values that *mean* something. `Others` (2 rows) is Access's own
catch-all with nothing behind it, so it is stored **NULL and reported**, never
mapped to a real treatment type. Same rule as the two NULL findings below.

**Preview the DDL before applying it**, and confirm zero existing rows violate
the constraint. These are live tables.

---

## 4. Data-shape traps found in the source

Free-text columns are not what their names suggest. Check each on the new
branch rather than assuming:

- **Every numeric column is stored as text.** `Fluid Input`, `Systolic BP`,
  `Temperature`, `Spo2`, `DXT`. Junk becomes NULL, **never 0** — a fabricated
  0 is a clinical statement.
- **Two columns mashed together.** `TubeFeeding` is a target *enum* but 3,279
  distinct source values are *times* (`9:00 AM`, `12:00 PM (asp:0mL)`); `BO`
  mixes amount with texture (`Normal/Soft Stool`, `Waterly Stool`) and needs
  splitting. Expect more of these.
- **Copy-paste errors from adjacent columns survive in the source.**
  `RespirationRate` has 25 values, several of which are temperatures (`36.5`,
  `97`). `Spo2Con` has junk past its 11-value enum (`under 0.5LPM O2`, `128`).
  These are genuine data problems, not migration bugs — don't "fix" them
  silently.
- **High-cardinality text → repeating-group tables.** `MealPortion` has 688
  distinct values (`Breakfast (Full)`, `Evening Tea (Full)`, `Full`) feeding a
  6-slot group; `AssistedHygieneCare` (156) and `Activity` (166) are free text
  against multi-select ID arrays.
- **IC formatting differs between the two systems.** Some live ICs are stored
  with dashes (`431120-08-6000`), Access stores them bare. Run `clean_ic` on
  **both** sides of every comparison, or you silently lose those patients — it
  cost 8 `FOONG SIEW CHAN` rows before it was caught.
- **Set/list columns need `setdefault`, not overwrite.** One person can appear
  under several raw keys in the same list.
- **`NOT NULL` on a target column that Access leaves NULL.** AMN had three
  housecall rows with real treatment content and no `DateAndTime`, against a
  `NOT NULL entry_timestamp`. The decision was to **skip and report**, not to
  stamp the migration run date — that would put them at the top of the
  patient's chart claiming they happened today. Check every target `NOT NULL`
  against the source's nullability *before* the run, not at row 10,000.

---

## 5. Throughput — fix this before the first commit

**This is the first thing to solve for a large table, ahead of parsing.**

- A per-row `insert ... returning id` is a full network round trip per row:
  10,633 physio rows took **over 25 minutes**, and one run burned all of that
  before dying at row 10,402. Batching brought the same work to **16m30s**,
  all of it now `IdMap`.
- `transforms/physio_assessments.py::_flush()` is the working implementation —
  `psycopg2.extras.execute_values` at 500 rows/statement for inserts, and
  `UPDATE ... FROM (VALUES ...)` for the idempotent path. **Copy it; don't
  re-derive it.** Two gotchas that each cost a run:
  - Every parameter in a `VALUES` list is inferred as **text**, so the batched
    UPDATE needs an explicit `cast(%s as bigint)` per non-text column or it
    fails `DatatypeMismatch` on the first bigint. `_target_column_types()`
    supplies the real types for this.
  - The `VALUES` list must be built **per chunk**, not from a fixed template —
    a list is positional, so a fixed-size template asks for parameters for rows
    the batch doesn't have (`TypeError: not all arguments converted`).
- **`IdMap.put()` is one upsert per row and was the entire remaining cost.** It
  is now batched too: `put_many()` + `flush()` write 500 rows per statement, and
  `transforms/physio_assessments.py::_flush()` collects its pairs and flushes
  once at the end. `put()` is deliberately still eager — **seven transforms call
  it and never `flush()`**, so deferring the write there would silently stop
  their `id_map` rows from persisting at all. New transforms should use
  `put_many()`; don't "tidy" `put()` into the deferred form.
- **Don't pipe a long run through `tail`.** The shell then reports
  `exited with code 0` while the pipeline's real exit code is swallowed — a
  25-minute failure reported itself as a success. Capture the exit code
  explicitly and print it.

---

## 6. Normalisers are easy to get subtly wrong

The `Nur`/`Sr` fallback regex had no word boundary, so it also fired on words
merely *starting* with those letters — `Physiotherapist Ian` lost its `P` and
became `hysiotherapist ian`. It was `\b`-anchored only because the physio table
happened to expose it, and it was live in the already-committed ProgressNote
migration (harmless there — those tables have no such names).

When adding a normaliser rule, test it against a string that begins with the
literal but is a different word. Every rule added to `clinical_match.py`
affects **all** clinical tables, including committed ones.

---

## 7. Idempotency — prove it, don't assume

`etl.id_map` is keyed on `(source_table, source_id, branch_code)`; re-running
updates in place. A second `--commit` must leave every number identical:

```
physio_assessments: 16139 (was 16139)
id_map physio:     10630 (was 10630)
sum(target_id): 179918065 (was 179918065)
```

`sum(target_id)` is the check that matters — a single duplicate insert or a
re-pointed row moves it, while row counts alone would not.

**A re-run overwrites migrated rows.** That is correct for a one-time backfill
and wrong as a recurring job while Access is still live: any web-app edit to an
already-migrated note gets clobbered. Do not schedule this.

Also note `tbl_hospital_referrals` and `tbl_progress_notes` already held rows
(4 and 6) before the migration — the target may not be empty. Check before
assuming a clean insert.

---

## 8. Verify the data, then explain the exceptions

Row counts prove the write happened, not that it's right. After committing,
check the distributions you care about, and then **trace every anomaly to a
source gap before calling it done.** Both NULL findings in the AMN run turned
out to be genuine: one source row has no `Therapist` value, and 62 rows have no
`IPSubType`. Neither was a migration bug — but neither would have been obvious
without looking.

Report what you actually ran. A dry run, a commit, a re-run and their timings
are all separate claims.

---

## 9. Open items to settle

- **Re-sync `schema/001_init.sql` against production.** Known-stale in five
  places in `physio_assessments` alone. It is a wider change than any single
  migration, and it was deliberately left for that reason — but every new
  transform should be reading `information_schema`, not this file, until it is.
- **Delete `migration/transforms/progress_notes.py`.** Dead, never run,
  superseded by `progress_notes_v2`. Still present.
- **Batch `IdMap.put()`** before `tbl_NursingChart`.
- **`tbl_NursingChart` (85,686 rows)** — unstarted. Parsing complexity is
  catalogued in `docs/access-clinical-migration.md`; throughput is §5 above.

## Housekeeping

Access is still the live system and these tables are still being entered
daily. The `.accdb` is read read-only; prefer it over the `.xlsx` exports in
the same folder. Supabase holds real production clinical data — dry-run, read
the report, and confirm before any `--commit` or DDL.
