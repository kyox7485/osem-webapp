# Access → Supabase clinical-table migration (ALMA / branch `AMN`)

Covers the four clinical tables exported from the legacy Access system, and
the decisions taken while migrating the first two. Read this before extending
the migration to `tbl_NursingChart` or `tbl_PhyIPProgressNote` — most of the
hard problems are already solved, and the remaining two tables have their own
complications noted at the bottom.

**Migrating a branch other than AMN? Read
`docs/access-clinical-migration-next-branch.md` first** — a checklist written
after the AMN run, covering the traps that cost time or a wrong attribution
(schema drift, branch-scoped lookups that resolve nothing, throughput, and
which asserted overrides do *not* transfer to another branch). This file is the
AMN log; that one is the "do this before your first commit" list.

## Source and scope

Source of truth is the `.accdb` at `access/alma/OSEM MS_be.accdb`, read
read-only via `access_reader.py` (pyodbc). The `.xlsx` files in the same
folder are exports of that database and were verified byte-for-byte equivalent
on row counts and max timestamps (2026-09-26). **Prefer the `.accdb`** — it is
the live system and these tables are still being entered daily.

Migrated so far:

| Access table | Rows | Target | Status |
|---|---|---|---|
| `tbl_HospReferral` | 53 | `tbl_hospital_referrals` | done |
| `tbl_ProgressNote` | 5,117 | `tbl_progress_notes` | done |
| `tbl_PhyIPProgressNote` | 10,687 | `physio_assessments` | done |
| `tbl_NursingChart` | 85,686 | `tbl_nursing_chart_entries` + meals/hygiene/elimination + `tbl_vital` | done 2026-09-26 (85,352 entries) |

## The branch code is `AMN`, not `ALMA`

**`.env` had `BRANCH_CODE=ALMA`, which matches no row in `tbl_branches`.**
The four migrated branches are `AMN` (146 residents), `BGN` (157), `BMN`
(149), `DEMO` (31). ALMA's code is `AMN` — see the ResidentID prefix
correction in the ALMA/BAGAN migration (Access `ALMA` rows become `AMN-`
prefixed IDs, not `BMN-`).

The September 2026 resident/staff migration did not hit this because it
resolved the branch from the Access DB rather than from `BRANCH_CODE`. The
clinical transforms do read `BRANCH_CODE`, so it had to be corrected.
`run_migration.py` now exits 3 with a report note instead of proceeding when
the branch can't be resolved, rather than silently importing nothing.

Access's own `Branch` column still says `ALMA` — that is the Access-side name
for the same branch. Don't "fix" it in the source.

## Running it

```bash
venv/Scripts/python.exe run_migration.py --dry-run --tables hospital_referrals,progress_notes_v2
venv/Scripts/python.exe run_migration.py --commit --tables hospital_referrals,progress_notes_v2
venv/Scripts/python.exe run_migration.py --dry-run --tables physio_assessments
venv/Scripts/python.exe run_migration.py --commit --tables physio_assessments
```

Always dry-run first and read the report. `--commit` writes to production.

**One-off schema prerequisite.** The physio migration needs the widened check
constraints in `migration/scripts/physio_widen_checks.sql` applied once, before
its first `--commit`. It is not needed by the other tables.

## Identity resolution

`clinical_match.py` holds all of this. Two indexes are built at the start of
every clinical run:

- **`ResidentIndex`** — `tbl_residents` for the migrating branch is the master
  list. Access's `ResidentID` column is **never** consulted as an authority;
  it is NULL in all 5,117 rows of `tbl_ProgressNote` anyway.
- **`StaffIndex`** — `tbl_staff` across **all** branches, not just the branch
  being migrated. This is deliberate and load-bearing: `tbl_ProgressNote` is
  reviewed by `Dr. Irene` (rostered `AMN-0015`, Medical Officer) *and*
  `Dr. Lim Yi Wei` (rostered `HQ-0002`), together 51% of all `ReviewBy`
  values. `reviewed_by` references `tbl_staff."StaffID"` with no branch
  constraint, so a cross-branch attribution is structurally valid.

**Note:** the roster stores staff names **with** titles (`Dr. Irene`), while
Access writes them both ways (`Dr. Irene` / `Dr Irene` / `Irene`). Both sides
go through the same normalisation, which is why these resolve. When checking
staff by hand in SQL, do not strip the title from the query — that is how the
doctors got mistakenly reported as missing once already.

### Residents: IC wins, ambiguity is never resolved by guessing

1. Parse `A @ B` aliases. The **full string is never rewritten** — the target
   tables have no name column at all (the name lives in
   `tbl_residents.resident_name` from the earlier migration), so the pre-`@`
   segment is used purely as a match key.
2. IC match wins outright. ICs are stripped to bare digits.
3. IC absent/malformed → fall back to name.
4. IC and name disagree, or the name is genuinely ambiguous, or neither
   matches → **skip and log**. A clinical note on the wrong resident is worse
   than a missing one.

**Asserted overrides** in `clinical_match.RESIDENT_OVERRIDES` settle two cases
the generic rules deliberately refuse to guess. Each is commented with the
evidence that established it, and every use is logged. They are *not* a fuzzy
-name heuristic:

- **`TAN GUEK LEN` → id 758.** One person registered **three times** in Access
  (`ResidentID` 51 / 113 / 119), same IC `490825075340`, same age 75, with
  admission dates that chain without a gap (2024-04-06→2025-05-02,
  2025-04-19→2025-05-02, 2025-05-26→present). All 111 non-empty progress notes
  (2024-04-18→2026-09-19) fall inside that span. **The IC is identical on all
  three rows, so no IC-based rule could ever have separated them** — the
  ambiguity guard is the only thing that prevented a wrong attribution here.
  758 is the current ACTIVE record.
- **`QUAH CHEOW GUAT` → id 738.** Two candidates, both DISCHARGED, both with
  junk ICs (`420228-08-5292`, `123456789`). Resolved on the **admission
  window**: the single Access note is dated 2025-01-20, and id 738 was
  admitted 2025-01-18 / discharged 2025-01-21, while id 778 was not admitted
  until 2025-12-14. Currently dormant — that note turned out to be one of the
  contentless rows (see below), so this override has no rows to act on yet.

### Staff: normalise, then fail to a part-time record

Normalisation strips a trailing ` - <Position>` (`Merawati - Head Nurse`),
strips a leading `Dr`, casefolds, and drops punctuation. A leading `Nur`/`Sr`
is **kept** in the primary key, with the un-prefixed form retried as a fallback
**only if the primary finds nothing** — never both, never in preference to an
exact hit.

A name matching **no** roster entry is not dropped and not guessed at. It is
listed in the report ("Unmatched staff names awaiting review") and left
unattributed. A part-time, non-registered staff record
(`position='Healthcare Worker'`, `department='Nursing'`, `role='STAFF'`,
`status='INACTIVE'`) is created **only** for names the owner approved one by
one in `clinical_match.APPROVED_PART_TIME`, inline during the commit run, so the
clinical row gets the StaffID as it is written. Creating a `tbl_staff` row fires
its `staff_to_google` trigger, which mirrors it to the staff Google Sheet.

Changed 2026-09-26: `transforms/part_time_staff.py` used to create **every**
unmatched name and then back-fill. Blind creation turned typos and two-person
entries (`mera`, `Zulaikha, dewi`, `m,ard`) into fake staff, and the back-fill
set each new StaffID on **every** row with an empty attribution column, not
just that person's rows. It never ran only because no part-time staff had been
created yet. Both are removed; the step now only reports.

**Two-person entries** (`Merawati and rozie`, `Zulaikha, dewi`,
`Farah Najwa& AYU`) record the **first-named person**, by owner decision; the
attribution column holds one StaffID.

**Branch-scoped aliases** (`clinical_match.BRANCH_STAFF_ALIASES["AMN"]`) are
owner-confirmed facts about AMN's staff and apply only while migrating AMN:
`Dewi`/`Ros` → the AMN staff member of that name (both names exist at other
branches too), `IVY` → Ivy Tan, `sn aini` → Aini Maisarah, `mera` → Merawati,
`m`/`mar`/`m,ard` → Mardziyaton, `mere`/`a/n meere`/`mary` → Meere,
`nabila` → Nabilah, `Aiah` → Aliah, and `ALICE` deliberately unattributed
(probably resident `LOH POH CHAN @ ALICE` typed into the wrong box).

**Asserted staff aliases** (`clinical_match.STAFF_ALIASES`), because the
generic rules cannot resolve them:

- `patricia` → `HQ-0003` (Teoh Ying Ying, Nursing Director) — the name is not
  the person's name.
- `sn syaa` → `AMN-0024`, and bare `Syaa` → `AMN-0024` — **two different
  people are called Syaa** (`AMN-0024` and `BGN-0018`), so the cross-branch
  staff index reports the name as ambiguous. The explicit branch pick is
  required, not a preference.

## Contentless rows are skipped

A ProgressNote / HospReferral row whose clinical columns are all NULL — only
`Timestamp` (and sometimes the name or `ReviewBy`) populated — is an artefact
of Access capturing the form, not a real entry. These are **skipped and
logged**, never imported. Importing them would put empty notes on a resident's
chart, which reads as a real encounter.

**144 of 5,117 ProgressNote rows match** (2.8% of the file). Note that
`TCA`, `PastMedCondition` and `CurrMedRegime` count as *content* for this test
even though TCA has no target column and the other two are dropped — a note
whose only text is one of those is still a genuine encounter, and skipping it
would lose data silently.

The check runs **before** identity resolution: a contentless row has nothing
to attribute, so resolving it would only risk landing an empty note on the
wrong resident.

## Dropped fields

`tbl_ProgressNote.PastMedCondition` and `CurrMedRegime` have no target column
in `tbl_progress_notes` and are **dropped** by owner decision.

This is deliberately *different* from the September resident migration, which
stuffed `PastMedList` into `medication_reconciliation_log` with a prefix. That
column means something more specific (a withheld/dose-changed comparison log);
putting per-note medication text there would be wrong.

`TCA` is also dropped — `tbl_progress_notes` has no `tca_notes` column (that
column exists on `tbl_residents`, which is a different thing).

## Idempotency

`etl.id_map` (own `etl` schema, created only on `--commit`) is keyed on
`(source_table, source_id, branch_code)`. Re-running updates the existing row
rather than inserting a duplicate. **Verify with a second `--commit` run** —
row counts must not move.

Note `tbl_hospital_referrals` and `tbl_progress_notes` already held 4 and 6
rows before this migration; those are updated in place, not duplicated.

## Bugs fixed along the way (pre-existing, unrelated to the clinical tables)

- `run_migration.py` called `ensure_schema()` + commit **unconditionally**,
  including under `--dry-run` — a "dry run" wrote a schema to production. Now
  gated behind `--commit`.
- `lookups.py` selected `id, code` from `tbl_branches` instead of
  `"BranchID", "BranchCode"`. This is the `CLAUDE.md` footgun; in SQL it
  raises `UndefinedColumn` rather than silently returning nothing.

## `schema/001_init.sql` has drifted — check the live table

The physio migration aborted mid-commit on 2026-09-26 because
`physio_assessments` has **no `subjective` column**: the Access column was
mapped 1:1 without ever checking the live table. The snapshot is behind:

| `schema/001_init.sql` says | Production actually has |
|---|---|
| `resident_id bigint not null` | nullable |
| no `op_patient_id` | `op_patient_id bigint` |
| no `care_setting` | `care_setting text not null default 'IP'` |
| no `documented_by_other` | `documented_by_other text` |
| no `physio_assessments_patient_ref_check` | enforces IP⇒resident / OP⇒op_patient |

`transforms/physio_assessments.py` now calls `_assert_target_columns()` before
touching anything, so this class of mistake fails in the first second instead
of after thousands of inserts. **When adding a transform, read the live columns
via `information_schema` rather than trusting the snapshot.**

Re-syncing `schema/001_init.sql` against production is still outstanding.

## `tbl_NursingChart` (85,686 rows) — committed 2026-09-26

`transforms/nursing_chart.py`. Owner rule for this table: **preserve as much as
possible, but never change the table structure to do it** — a value with no
column (or no allowed value) is dropped *and reported*. The dry-run report now
lists every loss, collapsed per distinct message with sample row IDs (the old
60-line cap hid most of them).

**Schema prerequisites — both APPLIED to production 2026-09-26** (Supabase
migrations `nursing_chart_unspecified_assistance`,
`vital_dxt_remark_pre_post_meal`; files in `migration/scripts/`):
`tbl_nursing_chart_hygiene_episodes.assistance_level` admits `Unspecified`, and
`tbl_vital.dxt_remark` admits `Pre-Meal` / `Post-Meal`. The dry run checks
these live and reports a `BLOCKER` if either is missing.

**Committed 2026-09-26** (3m44s), then committed a second time to prove
idempotency: every count, the `etl.id_map` target-id checksum and the three
part-time staff (AMN-0037 Ayu, AMN-0038 Siti, AMN-0039 Asyiqin) were unchanged,
with no duplicate vitals. Timestamps checked against Access: exact, in MYT.

Dry run / commit (0 blockers): 85,352 chart entries, 37,224 vitals, 73,483
meal rows (8,930 tube feeds), 57,111 hygiene episodes, 45,909 elimination
episodes. Skipped: 21 switchover duplicates and 296 rows whose resident cannot
be identified — 293 with no name at all, 2 named `7`, and `TEOH KHOON GOH`
(TEOH KHOON LEE and LIM KHOON GNOH were both resident that day).

**Resident misspellings** were confirmed one by one against each candidate's
admission window and added to `RESIDENT_OVERRIDES` / `SPELLING_OVERRIDES`
(29 rows: `The Sock Lek`, `TAN HUA SHE`, `LEE SHEAU HUEY`, `HG AH HUAH`,
`TANG SAW YING`, `TAN GUEK LAN`, `NG WiLLl Jeah`, `ShUM um Chin Choon`/`shum`,
`loh muy chung`, `KUMAR`).

**`QUAH CHEOW GUAT` is two residents** (738, admitted 2025-01-18; 778, admitted
2025-12-14). The undated override (set from one progress note) would have put
all 21 NursingChart rows on 738; `ADMISSION_WINDOW_OVERRIDES` now picks the
latest admission on or before each note's date (15 → 738, 6 → 778). Checked:
no already-migrated progress note, referral or physio row belongs to either.

Mapping decisions (all owner-confirmed 2026-09-26):

- **Hygiene is one line per section** since 2025-04-17:
  `By Self | A; B\r\nWith Assistance | C`, either line possibly empty or a bare
  heading. Parsed line by line. The generic `split_multiselect` keeps only the
  text after the last `|`, which on 695 rows would drop the By Self items and
  file the With Assistance ones under By Self. Older rows are a bare list; an
  item that names its own level (`Self PU`, `Assisted Shower`) keeps it, the
  rest become **`Unspecified`** (3,283 episodes) — never a guessed level.
- A bare hygiene `PU`/`BO` names no location: **dropped** (530), not mapped to
  `PU @ Urinal` / `BO @ Commode` as the first draft did.
- **BO `None`** is a real lookup value ("no bowel output", 25,793 rows) that
  the generic splitter treats as empty; BO is split without that filter.
- **Tube feeding** is stored the way the app's form writes it: one meal row per
  feed time (`9:00 AM` → the `tbl_feeding_times` slot; the table stores `time`,
  so a string lookup matched nothing), the regime text (`2scoop milk
  200ml+50ml`) in `feeding_volume`, `asp:NmL` in `aspirate_amount`, and the
  entry's `tube_feeding` set to the app's `Tube Feeding` / `Oral Feed`, not the
  raw Access text. A time outside the six slots keeps its text in
  `feeding_volume`.
- **`Others:` meals/portions and free-text meals** use the app's `Others:` meal
  type / portion + `meal_type_other` / `meal_portion_other`. A meal with a food
  note and no portion (`Dinner own food`) keeps the note as portion `Others:`,
  matching how Access recorded `Dinner (Others: outside food)`. With a portion
  already given, the note is dropped (259).
- AVPU is stored as a letter (`A`/`V`/`P`), disturbance level as a digit
  (`0`–`4`); both map to their lookups (7,102 and 4,186 values that the first
  draft silently lost).
- `tbl_vital.spo2_condition` and `dxt_remark` are CHECK-constrained. DXT
  `Pre-Meal` (2,467) / `Post-Meal` (172) are admitted by the widened check; a
  remark starting with a category (`Pre-Meal ( PRE DINNER )`, `Fasting 5am`)
  keeps the category; the ~225 one-off notes (`5am`, `balik dialisis`) and 14
  junk SpO2 conditions are dropped and reported.
- Numbers: `36..4` → 36.4 (repaired only when one plausible number remains);
  a bare 3-digit temperature 340–429 is a missing decimal point (`365` → 36.5,
  owner decision); other implausible temperatures (`98`, `3.0`) and
  respiration rates → NULL, reported.
- Only one `pass_urine_id`: the first PU value is kept, extras reported (189).
- An unmatched reviewer name is kept in `tbl_vital.reviewed_by_other`;
  `tbl_nursing_chart_entries` has no such column.

**Switchover.** The app went live at AMN on 2026-09-25 11:48, but Access was
used until 2026-09-26 06:03 and staff typed most rounds into **both** systems,
the app copy re-timed and typed hours later, so no timestamp rule can dedupe
them. All 55 post-go-live rows were paired by resident + staff + readings and
decided with the owner one by one; the list is `SWITCHOVER` in the transform
(skip / temperature-only / entry-only / full). A post-go-live row not in that
list is skipped and reported, and a branch with no `SWITCHOVER` entry refuses
to run.

Commit-path defects fixed before any commit (the dry run skipped `_flush()`, so
none of these could show up in a dry run): child rows were built without
`branch_id` (meals would crash, hygiene would write `'By Self'` into
`branch_id`), `IdMap.put()` was still per row, and `tbl_vital`'s CHECK
constraints would have aborted the run. A `_validate()` step now checks every
written column and every CHECK-constrained value against the live catalog in
**both** modes.

### Historical notes from before the transform was written

- **Write throughput is the first problem, not the parsing.** A per-row
  `insert ... returning id` cost a full network round trip per row: 10,633
  physio rows took **over 25 minutes**, and an early run that hit a data error
  at row 10,402 burned all of that before rolling back. `physio_assessments`
  now batches with `psycopg2.extras.execute_values` (500 rows/statement) and
  `UPDATE ... FROM (VALUES ...)` for the idempotent path — **copy `_flush()` in
  `transforms/physio_assessments.py` rather than re-deriving it.**
  The committed 10,630-row run took **16m30s** with batching; the target-table
  write is now seconds and the rest is `IdMap.put()`, still one upsert per row
  and the only remaining bottleneck. 85,686 rows will want it batched too.
  Two gotchas that cost a run each:
  - Every parameter in a `VALUES` list is inferred as **text**, so the batched
    UPDATE needs an explicit `cast(%s as bigint)` per non-text column or it
    fails with `DatatypeMismatch`.
  - The `VALUES` list must be built **per chunk**, not from a fixed template —
    a list is positional, so a fixed-size template wants parameters for rows
    the batch doesn't have.

- `MealPortion` — 688 distinct values like `Breakfast (Full)`,
  `Evening Tea (Full)`, `Full`; target is a 6-slot repeating group
  (`tbl_nursing_chart_meals`).
- `TubeFeeding` — target is an **enum** (`Oral Feed` / `Tube Feeding`) but
  3,279 distinct source values are actually **times** (`9:00 AM`,
  `12:00 PM (asp:0mL)`). Time and aspirate volume are jammed into one field.
- `AssistedHygieneCare` (156 distinct) and `Activity` (166 distinct) are
  free-ish text vs. multi-select ID arrays in the target.
- **Every numeric column is stored as text** (`Fluid Input`, `Systolic BP`,
  `Temperature`, `Spo2`, `DXT`, …).
- `Spo2Con` has junk beyond the 11-value enum (`under 0.5LPM O2`, `128`,
  `36.4`).
- `RespirationRate` has only 25 values, several of which are clearly
  copy-paste errors from Temperature (`36.5`, `97`).
- `BO`/`PU` map to lookup tables; `PU` is clean (4 values), `BO` mixes amount
  with texture (`Normal/Soft Stool`, `Watery Stool`) and needs splitting.

## Timezone defect and correction (2026-09-26)

The first three migrations ran with the Postgres session at `TimeZone=UTC` (the
Supabase project default). Access returns naive datetimes, so every Malaysian
wall-clock timestamp was read as UTC and stored 8 hours **later** than intended:
a note recorded at 17:31 rendered as 01:31 the following day. **15,653 rows
were affected** — 10,630 physio, 4,970 progress notes, 53 referrals.

Fixed by `run_migration.py` now issuing `set time zone 'Asia/Kuala_Lumpur'` at
connect, and by `scripts/fix_tz_off_by_8.sql` shifting the affected rows back,
scoped through `etl.id_map` so only migrated rows moved. `created_at` was left
alone — it records when the row was written, which really was that day.

**Verified by comparing every migrated row against its Access source value:
15,653 exact matches, 0 mismatches.** Checksums were not sufficient — they show
a write happened but not that the values are right, and the correction was
briefly applied in the wrong direction (`+8` instead of `-8`) before a single-row
comparison against Access caught it. The sign is documented in both the script
and `docs/access-clinical-migration-next-branch.md` §1a, because `+8` looks
entirely plausible and silently moves every note a further day forward.

## `tbl_PhyIPProgressNote` → `physio_assessments` (10,687 rows, 10,630 imported)

The target is **`physio_assessments`, not `tbl_physio_progress_notes`** — the
app is moving to the assessment form, so the flat SOAP table stays empty and is
not written to. Its five child tables (`physio_examinations`,
`physio_body_chart_findings`, `physio_functional_assessments`,
`physio_balance_assessments`, `physio_coordination_assessments`) all stay empty
too: Access holds no examination chart, and `total_score` is computed by the
app from those rows, so it is left NULL rather than invented as 0.

**57 rows skipped:** 41 other-branch (`Dept` = `BAGAN` / `KOTA PERMAI` / `BM`),
9 outpatient not in the list, 4 contentless, and 3 with no `DateAndTime` (see
below).

- **Other-branch rows** are tested with an allow-list of `{IP, OP}`, not a
  denylist. The spellings are not consistent (`bagan`, `KOTAPERMAI`, `PERMAI`,
  `BM`), so listing the two settings we own stays correct as branches are added.
- **The outpatient list already exists — under `AMP`, not `AMN`.**
  `tbl_physio_op_patients` has 0 AMN rows but 213 AMP ones, and 1,638 of 1,650
  OP rows match one on IC. The lookup is therefore built across **all** branches.
  Cross-branch `op_patient_id` is the established pattern here, not a hack:
  2,845 live rows already point at AMP's list. Do not "fix" this by scoping the
  lookup to the migrating branch — it would resolve nothing.
- **The outpatient list has the same duplicate-registration problem as
  `tbl_residents`.** `TAN HUM MENG` (5) / `TAN HUN MENG` (8) share IC
  `690812075181`; `ROHANA` (106) / `ROHANA BINTI ZAKARIA` (105) share
  `601123015936`. An IC match pointing at one row while the name points at the
  other is one person entered twice, not a conflict between people, so the IC
  wins — the same rule approved for residents. Some ICs are stored **with
  dashes** in the database (`431120-08-6000`) and bare in Access, so both sides
  must go through `clean_ic` or those patients are missed entirely.
- **`care_setting` follows Access's `Dept` verbatim.** 156 OP rows also match
  an AMN resident by name; that is expected, because a resident discharged from
  OSEM returns for physio as an outpatient. Access recorded them as OP and so
  do we — reclassifying on a name match would be a guess.
- **`Subjective` → `current_history`**, and **`Objective` + `Analysis` →
  `impression`** (joined, labelled, in SOAP order). `physio_assessments` has no
  `subjective` or `objective` column; the app's "Subjective Assessment" section
  collects Chief Complaint / Current History / Social History. Chief Complaint,
  Past Medical History and Social History have no Access counterpart and stay
  NULL. `PlanAndIntervention` → `plan_intervention`, `Evaluation` → `evaluation`.
- **`IPSubType` → `treatment_type` as-is.** Four of its 20 values were not in the
  app's TreatmentType list and were added to the check constraint by
  `scripts/physio_widen_checks.sql`: `Full Physio`, `Patient Went Out`,
  `Not Performed`, and — for `treatment_compliance` — `0%`. `Others` (2 rows) is
  Access's own catch-all with no meaning attached, so it is stored **NULL and
  reported**, never mapped to a real treatment type. No existing row violates
  either widened constraint (verified before applying).
- **`Completion` → `treatment_compliance`** as `0%`/`25%`/`50%`/`100%`. The
  constraint was widened to admit `0%` rather than discarding a real value.
  `0` is a genuine value, not a null marker: it co-occurs with real treatments.
- **`CreditHour` → `credit_hours`.** It is session length in hours (0.25 =
  15 min, 1.0 = 1 hr) and is *not* the same quantity as `Completion` despite
  both being filled on the same rows — 3,973 rows have `CreditHour` and no
  `Completion`, and the two cross-tab freely (`Basic Physio` is always 0.25,
  `Full Physio (1hr)` always 1.0). Both are stored in their own column.

**`Ian Cheen Yik Yuan` is one person written seven ways.** The Therapist column
uses three correct spellings, three misspellings of "Physiotherapist", and the
full roster name — and the date spans are contiguous and non-overlapping, so it
is one person whose Access entry style changed over time:

| Written as | Rows | Range |
|---|---|---|
| `Physiotherapist Ian` / `PHYSIO IAN` / `Physiotherapy Ian` | 79 | 2023-08-23 → 2023-11-08 |
| `PHSIOTHERAPIST IAN` / `PHYIOTHERAPIST IAN` / `PHYSIOTHERPIST IAN` | 3 | 2023-09-27 → 2023-11-01 |
| `Ian Cheen Yik Yuan` | 81 | 2023-11-15 → 2024-07-29 |

The correct spellings normalise to a bare `ian`, which does not match the
roster's full name; the typos are not title words at all. Each **exact source
string** is asserted in `STAFF_ALIASES` → `AMN-0033`. The bare string `ian` is
deliberately **not** aliased: two clinicians can share a first name, and a note
that resolves to the wrong person is worse than one left unattributed.

### A normaliser bug this table exposed

The `Nur`/`Sr` fallback regex had no word boundary, so it also fired on words
merely *starting* with those letters — `Physiotherapist Ian` lost its P and
became `hysiotherapist ian`. It is now `\b`-anchored, and a leading title run
(`Physiotherapist Ian`, `physio - Athirah`) is stripped before the honorific
fallback. Worth re-checking any future normaliser against this case: it is easy
to write a rule that looks right and quietly mangles a different word.
