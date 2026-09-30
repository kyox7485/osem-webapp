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
