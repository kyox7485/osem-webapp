# Clinical modules — detail

## Modules at a glance

| Tab | Sub-tabs / notes |
|---|---|
| Residents | Resident roster + detail page (shows Resident ID); Medication Orders sub-tab — see `docs/medication.md` |
| Clinical | Nursing Chart, Observation Chart, Behaviour Chart, Vital Signs, Wound Photo, Medical Progress Notes, Hospital Referral |
| Physiotherapy | IP/OP split, its own assessment form with a body-chart section, treatment types + credit hours (Supabase-driven), an Analytics dashboard |
| Staff | Roster (`tbl_staff`), separate from logins |
| Accounts | Logins (`tbl_user_accounts`); admin-only; clickable rows open an edit-confirmation modal |

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
