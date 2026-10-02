# Clinical modules — detail

## Modules at a glance

| Tab | Sub-tabs / notes |
|---|---|
| Residents | Resident roster + detail page (shows Resident ID); Medication Orders sub-tab — see `docs/medication.md` |
| Clinical | Nursing Chart, Observation Chart, Behaviour Chart, Vital Signs, Wound Photo, Medical Progress Notes, Hospital Referral |
| Physiotherapy | IP/OP split, its own assessment form with a body-chart section, treatment types + credit hours (Supabase-driven), an Analytics dashboard |
| Staff | Roster (`tbl_staff`), separate from logins |
| Accounts | Logins (`tbl_user_accounts`); admin-only; clickable rows open an edit-confirmation modal |

Clinical report queries are row-capped (500) so a bounded list is never
mistaken for the complete one. The Nursing Chart tab still defaults to a
7-day window; Vital Signs does not — a silent default there rendered older
readings as "No vital signs recorded yet." and hid the HQ ADMIN edit/delete
buttons entirely, since an empty table has no rows to hang them on.
`schema/016_add_vital_entry_timestamp_index.sql` indexes
`tbl_vital.entry_timestamp desc` so the "All Residents, no date range" read is
an index scan rather than a seq scan + sort of ~37k rows (measured: ~775ms →
bounded index scan). That is a modest win on a sub-second query; it is **not**
the fix for the "canceling statement due to statement timeout" that error was
originally blamed on — that read completes in well under a second, and the
Nursing Chart read returns its 500 rows without trouble, so neither report
query is what times out. Unrooted as of 2026-09-29; the next step is
Supabase → Logs → Postgres Logs, searched for `statement timeout` at a
failing page-load, which names the actual statement. The leading suspect is
one of the lookup queries in the `Promise.all` on the clinical page
(`getClinicalLookups()`, `getAllStaffWithBranch()`, …), not either report
query.

Known gap: `tbl_nursing_chart_elimination_episodes` has no index on
`chart_entry_id` — its two sibling child tables have one — so its lookup is a
sequential scan; acceptable at the current cap, worth adding if it ever gets
slow.

## Wound Photo

The most involved sub-tab: a front/back body-chart image
(`webapp/public/body-chart-wound.png`) with percentage-positioned tap
targets (round dots for most regions, elongated capsules for Hand/Leg
covering the distal ~60% of the limb), immediate per-photo upload to
Google Drive on "Use Photo" (not batched behind a later Save), and a
"Finish Session" step that waits for any in-flight uploads before
completing. See `webapp/src/app/(app)/clinical/wound-body-diagram.tsx` and
`new-wound-photo-form.tsx` for the current implementation and their
inline comments for the reasoning behind specific coordinate/UX choices.
Uploads go through `webapp/src/lib/google-drive.ts` — see
`docs/integrations.md` for the Drive/Apps Script side.

## Medical Progress Notes

`tbl_progress_notes`: `feeding_plan` and `monitoring_plan` are longtext,
exactly like `physical_examination` and `medical_plan`. In forms, review
grids, and table views, size them equally wide/tall as those two fields —
clinical feeding/monitoring instructions are long, and narrow fields clip
them. (Prior feedback, learned the hard way once.)

### Inline resident particulars editors (New Entry tab)

The **New Entry** tab's resident dashboard carries an "Edit these details"
button on three cards — Medical/surgical history, Known allergy, TCA notes.
**Current medication list deliberately has none**: medications are owned by
Medication Orders, where the Google Sheet is the source of truth
(`docs/medication.md`), and a second free-text editor would be a conflicting
place to type them.

Writes go through one Server Action,
`clinical/resident-particulars-actions.ts` → `updateResidentParticulars`,
discriminated by a `field` argument. Authority matches creating a progress
note (anyone who can see the resident, plus the symmetric DEMO check) — *not*
the HQ-ADMIN-only `admin-records.ts` framework.

Four things that are easy to get wrong here:

1. **Allergy is a compiled string, not free text.** `lib/allergy-text.tsx`
   owns the one `compileAllergy()` / `parseAllergyText()` pair that
   `resident-form.tsx` and this editor both use. A plain textarea over
   `tbl_residents.allergy` orphans the questionnaire — the next read parses to
   null and the resident form silently degrades to its raw-text fallback. The
   editor reproduces that fallback deliberately for legacy/imported rows.
2. **Diagnoses are delete-then-reinsert, never upsert.**
   `tbl_resident_diagnoses` has `unique (resident_id, diagnosis_option_id)`,
   which an upsert still can't express as "the user unchecked this one". Same
   shape as `residents/actions.ts`.
3. **`branch_id` is never sent** for diagnosis rows —
   `fn_fill_resident_diagnosis_branch()` fills it before insert.
4. **Single-column patches.** `allergy` / `tca_notes` update only their own
   column. Reusing `buildResidentPayload()` would write ~20 columns and blank
   whatever the caller didn't send.

The audit trail is free: both tables are in `fn_audit_trigger()`'s list. There
is **no `updated_at` auto-touch trigger** on `tbl_residents`, so these edits
do not bump `updated_at`.

`resident-dashboard.tsx` renders the buttons only when a `residentId` prop is
passed; the other two call sites stay read-only. Turning them on elsewhere is a
one-line prop flip. Editors are marked `data-standalone-editor` so the
progress-note form's `onChangeCapture` skips them — typing in an editor and
pressing Cancel must not raise an unsaved-changes prompt for the note.

## Cross-department entry creation

A physiotherapist may create records only in the physiotherapy module, and a
nursing/medical login only in the clinical module. **Viewing is never
restricted** — both sides read every existing entry, because a physiotherapist
still needs the resident's clinical notes and vice versa. Hiding a "New
Entry" button hides creation only.

The rule lives in `lib/current-user.ts` as two mirror helpers,
`canCreateClinicalEntry()` and `canCreatePhysioEntry()`. Both treat everyone
above plain STAFF as exempt (HQ accounts, and every MODERATOR/ADMIN
regardless of branch) so supervision and correction stay possible.

**Department is inferred from `tbl_branches.Function`, not
`tbl_staff.department`.** `tbl_user_accounts` carries only `rights` +
`branch_id` and has no link to the staff roster — the schema keeps those two
deliberately decoupled, since a login may be shared by several people at a
branch. So a physiotherapist working out of a nursing branch reads as NUR and
keeps clinical create rights. That is the accepted trade-off for needing no
migration. **If per-person departments are ever required, add a
`department staff_dept` column to `tbl_user_accounts`** (not a join to the
roster — it would contradict the schema's stated design) and swap the
`isPhysioDepartment` predicate.

**Enforced in both layers, deliberately.** Each clinical module receives a
`canCreateEntry` prop and hides its New Entry button; each of the six clinical
Server Actions (`createVital`, `createProgressNote`, `createNursingChartEntry`,
`createObservationChart`, `createBehaviourChart`, `createHospitalReferral`)
re-checks `canCreateClinicalEntry()` and returns
`CROSS_DEPARTMENT_ENTRY_DENIED`. The physiotherapy side does the same via
`canCreate` on `PhysioAssessmentTabs` and a check in `createPhysioAssessment`
/ `createOpPatient`. **Hiding the button is never the guard** — a Server
Action is reachable directly, so the action check is the real one.

## Accounts tab UX

Rows are clickable (entire row, not just the username link). Clicking a
row shows a confirmation modal ("Edit account for [username]?");
confirming navigates to `/accounts/[id]/edit`. The view page
(`/accounts/[id]`) still exists but is no longer the primary entry point
from the list. The modal is implemented in `accounts/accounts-table.tsx`
(client component), keeping the list page itself a server component.

## Physiotherapy scoring — Normalized Impairment Score

`webapp/src/lib/physio-scoring.ts` holds the **single canonical scoring
pass**, `computePhysioScoreResult()`, imported by both the client (the live
"Current Assessment" preview) and the server (the PDF route), so the two can
never disagree. Do not re-implement the arithmetic anywhere else.

Two distinct metrics come out of one pass, and they are **never combined**:

- **Normalized Impairment Score** — `raw impairment / maximum possible
  impairment × 100`, over only the fields that hold a value. Higher = greater
  impairment among the fields assessed. `null` when nothing is assessed.
  Without it, two assessments with different numbers of assessed fields
  aren't comparable (20 fields scoring 20 vs 100 fields scoring 50).
- **Assessment Coverage** — how many available scorable fields carry a
  value. Purely descriptive. It does **not** mean "reassessed this visit":
  the New Entry form carries the previous assessment's values forward and
  the data model has no per-field "newly reassessed" flag.

Per-field maxima (never one flat denominator): Power 5, Tone 4, ROM 4,
Reflexes 4, Functional 4, Balance 3, Coordination 4. Power is inverted
(`5 - power`) because it is the only scale running 0=worst..5=normal; every
other scale already increases with impairment. `null` means *Not assessed*
and contributes to **neither** numerator nor denominator — it is never 0.

`physio_assessments.total_score` keeps its historical meaning (the raw sum)
and no historical row is rewritten. Normalized score and coverage are derived
from the child rows on read (`scoreStoredAssessment()`), so no duplicated
columns were added.

Read-side scoring runs against `buildFullExamGrid()` — the persisted exam
rows merged into the full 76-row grid — because only scored movements are
actually persisted. The same helper backs the form's carry-forward, so the
coverage denominator is identical for a fresh form and a stored note.

Review Notes (`assessment-review.tsx`) shows a Normalized Impairment trend,
the latest assessment summary with a category breakdown, and a clinical
timeline that opens the full detail in a modal. Trend and summary render only
when one patient is selected; the all-patients list deliberately loads **no**
child rows (`score: null`, cells read "—") to stay lightweight.

**Wording rule:** no invented clinical thresholds and no
improved/worsened/delta commentary. This is an impairment measure over the
fields assessed; it is not a dependency score and does not represent overall
patient dependency on its own.

## Physiotherapy dirty-tracking bridge

Physiotherapy had a pre-existing module-local dirty-tracking
implementation (`physio-dirty-context.tsx`, for resident-switch) before
the app-wide guard existed. Rather than duplicate it, it's bridged into
the global context via `PhysioGlobalDirtyBridge` (same file), which calls
`useDirtyForm("physio-assessment-new")` from `lib/dirty-form-context.tsx`
— so sidebar and module-tab navigation respects it too, while keeping its
own resident-switch UX unchanged. See `docs/unsaved-navigation.md` for
the guard system itself.

## Admission Analytics (bed capacity / occupancy)

`tbl_branches.bed_capacity` (schema/002_add_bed_capacity.sql) drives the
Residents → Admission Analytics dashboard's occupancy %, KPI drill-down
modals (`admission-analytics/analytics-details-modal.tsx`,
`kpi-cards-client.tsx`), and period-aware Active Residents display. Access
is restricted to NUR/HQ `branch_function` accounts. This shipped via
commits `cae6559`/`9e1ef35`/`e0a965f`; the historical build notes are in
the root `COMPLETION_SUMMARY.md`/`IMPLEMENTATION_SUMMARY.md` if deeper
rationale is ever needed, but the code itself is now the source of truth.
