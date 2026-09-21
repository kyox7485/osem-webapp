# OSEM Web App — project manual

This file is auto-loaded by Claude Code whenever a session opens anywhere
under this repo. It exists so a brand-new chat doesn't have to rediscover
the project from scratch. Keep it updated as the project evolves — when a
decision here turns out to be wrong or stale, fix this file in the same
commit that changes the behavior, don't leave it to drift.

## What this is

OSEM is a Malaysian nursing home operator. This repo is a Next.js +
Supabase (Postgres) web app that is **replacing a legacy Microsoft Access
database** (`OSEM MS_be.accdb`) branch by branch. `ALMA` is the first
branch fully migrated; others still run on Access until their turn comes.
The live Supabase project is real production data for ALMA — treat it
accordingly (this has come up before: past sessions had to clean up test
records/sessions/Drive files created while verifying a feature).

The other project location, `Z:\My Drive\OSEM MS\OSEM WebApp` (Google
Drive-synced, not a git repo), holds the legacy Access `.accdb` file and
adjacent docs/screenshots. This repo (`C:\Users\NGF\dev\osem-webapp`) is
the actual git checkout where all code work happens.

## Repo layout

```
osem-webapp/
├── webapp/               Next.js app — this is what staff actually use
├── migration/            One-off Python scripts that move data Access → Supabase
├── schema/               Hand-written Postgres schema (schema/001_init.sql)
├── google-apps-script/   Code deployed to Google Apps Script (Drive integration)
└── CLAUDE.md             This file
```

### `webapp/` — the Next.js app

- Next.js 16 (App Router), React 19, Tailwind v4, TypeScript.
- `src/app/(app)/` — one folder per top-level nav tab: `residents/`,
  `clinical/`, `physiotherapy/`, `staff/`, `accounts/`.
- `src/app/(app)/clinical/` has its own sub-tabs, each a `*-module.tsx` +
  `*-actions.ts` (Server Actions) pair: Nursing Chart, Vital Signs, Wound
  Photo, Medical Progress Notes, Hospital Referral.
- `src/lib/supabase/{client,server,admin}.ts` — Supabase client factories.
  `server.ts` is what Server Components/Actions use (respects RLS via the
  signed-in session); `admin.ts` uses the service-role key for the rare
  admin-only action (e.g. inviting a staff login).
- `src/lib/current-user.ts` — reads `tbl_user_accounts` (the **login**),
  not `tbl_staff` (the **clinical roster**). These are deliberately
  separate: a login can be shared by several people at a branch, so it
  only tells you branch/rights scope, never "who is the real person doing
  this." Anything that needs to attribute an action to a real person
  (progress notes, resident admission, wound photo "uploaded by", etc.)
  carries its own explicit staff-picker field — never assume
  `current_user.id` is the author.
  **`getCurrentUser()` takes zero arguments** — it creates its own
  Supabase client internally. Never call it as `getCurrentUser(supabase)`;
  TypeScript will reject it and break the Vercel build. The correct
  pattern in a Server Action is: `const account = await getCurrentUser();`
  first (cheap auth check before hitting the DB), then
  `const supabase = await createClient();` for subsequent queries.
- `src/lib/i18n/` — English/Bahasa Malaysia switcher. `t("English text")`
  looks the English string up in `translations.ts`'s `msDictionary`; a
  missing key just falls back to English, it's not a build error. New UI
  text doesn't need a translation to compile, but should get one.
- Env vars: see `webapp/.env.local.example`. Supabase URL/anon key are
  public; `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_APPS_SCRIPT_*`, and
  `OMNIROUTE_*` are server-only, never `NEXT_PUBLIC_`.
- Run locally: `cd webapp && npm run dev` (or use `preview_start` with the
  `.claude/launch.json` config `osem-webapp-dev` if you're in a Claude Code
  session with the Browser pane). `npm run lint` and `npx tsc --noEmit -p .`
  are the two cheap sanity checks to run before calling a change done.

### `migration/`

One-off Python scripts (`migration/scripts/*.py`) that read the Access
`.accdb` (via `access_reader.py`) and write into Supabase (via `PG_DSN` in
`migration/.env` — direct Postgres connection, not the REST API). Each
script is single-purpose and named for what it does
(`add_wound_photo_tables.py`, `rework_wound_body_parts.py`,
`create_physio_assessment_tables.py`, `reset_osemnursing_test_pw.py`,
etc.) — there's no migration framework/runner beyond `run_migration.py`
for the actual Access→Supabase ETL pass. **Running one of these touches
the real Supabase database** (see "production data" note above); confirm
with the user before running anything that isn't clearly read-only, the
same way you would for any other production-affecting action.

### `schema/001_init.sql`

The hand-written source-of-truth schema (enums, tables, RLS policies) as
it looked at initial rollout. It is **not** kept in sync with every later
`alter table` run ad hoc through a migration script or directly in the
Supabase SQL editor — treat it as a snapshot/reference for the original
design intent and enum values, and check the live database (or the
relevant `migration/scripts/*.py`) for current truth on anything that
might have changed since.

### `google-apps-script/wound-photo-drive.gs`

Wound photo binaries live in Google Drive, not Supabase Storage, because
OSEM's Drive is a personal (non-Workspace) `osemmedicare@gmail.com`
account — no Shared Drive for a service account to use. This script runs
*as that real account* via Apps Script's Web App deployment, called from
`webapp/src/lib/google-drive.ts`. **Editing this file does nothing by
itself** — Apps Script needs a manual redeploy (Deploy → Manage
deployments → edit existing → New version) under that Google account,
which only the user can do. After editing this file, say so explicitly
rather than assuming the change is live.

### Medication Orders — Google Sheet is the source of truth, not Supabase

The webapp **never writes directly to `tbl_medication_orders`**. The flow is
always: Next.js Server Action → Google Apps Script Web App → Google Sheet
`tbl_MedicationOrder` (source of truth) → a separate Apps Script sync layer
mirrors that sheet into Supabase `tbl_medication_orders` → and rebuilds
`tbl_residents.current_medication_list` for the affected resident(s). If a
future change is tempted to have the webapp upsert `tbl_medication_orders`
directly, don't — it would silently diverge from the sheet.

**The Apps Script project's real source of truth is a separate repo,
`osemmedicare/test`, not this one.** This repo only tracks a copy of
`google-apps-script/medication-orders.gs` for reference/diffing — Claude
Code sessions here typically do **not** have push access to
`osemmedicare/test`. When `medication-orders.gs`, `MedicationSync.gs`,
`MedicationSummary.gs`, `Config.gs`, `Code.gs`, or `Utils.gs` need to
change, edit the local clone, then hand the changed file(s) to the user via
`SendUserFile` — they paste them into the Apps Script editor and redeploy
(Deploy → Manage deployments → edit existing → New version; a plain save
does not update the live `/exec` URL). Never claim a `.gs` change is live
without the user confirming they redeployed.

**`Code.gs`'s `doPost`/`doGet` are the single entry point for the whole
Apps Script project's Web App.** Apps Script merges every `.gs` file in a
project into one namespace — only one `doPost` and one `doGet` can exist
project-wide. A past bug had `medication-orders.gs` define its own
competing `doPost`/`doGet`; whichever file loaded last silently discarded
the other's routes, causing intermittent "Apps Script request failed"
errors depending on load order. `medication-orders.gs` must never define
`doPost`/`doGet`/`jsonResponse` again — it only exports
`createOrder`/`updateOrder`, which `Code.gs`'s `doPost` calls into for
`action: "create"`/`"update"` (gated by a `SHARED_SECRET` constant that
must match Vercel's `MEDICATION_ORDER_SCRIPT_SECRET`).

Key design points, current as of the last revision:
- **`Noted By` is a single sheet column**, not two. It holds either an
  internal `tbl_staff.StaffID` (when the picker's staff list was used) or a
  free-text name (when "Others" was picked — e.g. a visiting doctor).
  `MedicationSync.gs`'s `resolveMedicationNotedBy_` tells the two cases
  apart by looking the value up against `tbl_staff.StaffID`; a match →
  Supabase `noted_by` (FK), no match → `noted_by_external_name` (plain
  text). Supabase keeps both columns regardless — only the *sheet* is
  single-column.
- **Start Date / End Date are stored on the sheet as `DD/MM/YYYY`** (e.g.
  `17/09/2026`), not ISO. The webapp always sends `YYYY-MM-DD`;
  `medication-orders.gs`'s `formatDateForSheet_` converts on write, and
  `MedicationSync.gs`'s `normalizeMedicationDate_` explicitly parses
  `DD/MM/YYYY` back to ISO for Supabase — do not let this fall through to
  `new Date(text)`, which misreads `DD/MM/YYYY` as `MM/DD/YYYY`.
- **Editing an order never overwrites the row in place.** It sets the old
  row's `Status` to `"Discontinued"` and appends a brand-new row with a new
  `RxOrderID` and `PreviousRxOrderID` = the old `RxOrderID`, giving a full
  audit trail. On that new row, `Active Ingredient`, `Dosage Form`, `Dose`,
  `Unit`, `Frequency`, `Administration Times`, `Dosing Days`,
  `Indication`, and `Instruction` (the `INHERITED_ON_REVISION` list in
  `medication-orders.gs`) always come from the **old row on the sheet**,
  never from the submitted form — this is a deliberate business rule
  (editing revises administrative details of an order, not its drug
  identity/dosing schedule; a real dosage change means discontinuing and
  creating a new order). The edit form (`order-form.tsx`) locks those same
  9 fields in the UI so staff aren't misled into thinking a change there
  saves. `order-actions.ts`'s `updateOrderAction` generates the new
  `RxOrderID` the same way `createOrderAction` does.
- Both `createOrder`/`updateOrder` call `syncOrderAndSummary_`, which
  retries `syncMedicationOrderAndSummaryNow` (from `MedicationSummary.gs`)
  a couple of times inline, then falls back to two automatic safety nets if
  it still fails: `MedicationSummary.gs`'s 1-minute heartbeat and
  `MedicationSync.gs`'s 24-hour reconciliation
  (`syncAllMedicationOrdersToSupabase`). Both must actually be installed
  (`setupMedicationSummaryTrigger()` / `setupMedicationReconciliationTrigger()`
  run once each) for "the sync must not fail" to actually hold — this is
  what makes a transient Supabase blip self-heal without a human noticing.
  A sync failure is also written to the visible `tbl_MedicationSyncLog`
  sheet, not just the Apps Script execution transcript.

## Core domain model (Postgres/Supabase)

- `tbl_branches` — one row per physical branch. **Primary key is `BranchID`
  (PascalCase), not `id`.** Always use `.eq("BranchID", ...)` when querying
  this table — `.eq("id", ...)` silently returns nothing and will cause
  hard-to-diagnose bugs (learned this when Telegram notifications were
  silently dropped because the branch lookup always came back empty).
  `telegram_chat_id` (text, nullable) stores the Telegram group chat ID for
  that branch; `TELEGRAM_BOT_TOKEN` stays a Vercel env var (one bot for all
  branches). To enable notifications for a new branch, just fill in its
  `telegram_chat_id` row — no code change needed.
  `Function` is `'NUR'`
  (residential/nursing branch), `'PHY'` (standalone physio hub, e.g. AMP),
  or `'HQ'`. A lot of access rules key off this rather than a hardcoded
  branch id.
  **`BranchCode = 'DEMO'` marks the demo/test branch** (currently
  `BranchID = 6`). Its residents (IDs 365–384), all physio assessments, and
  all OP patients are fake data used only for demonstrations via the `test`
  account. Because `BranchCode = 'DEMO'` has `Function = 'NUR'`, PHY hub
  accounts (whose allowed branch list includes every NUR branch) would also
  pick it up — so the exclusion must apply to **every user** whose own
  `branch_id` is not the DEMO branch, not just ADMIN. The canonical check is:
  ```ts
  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;
  ```
  Only the `test` / DEMO account itself (`isDemoUser === true`) may see demo
  data. Apply `.not("branch_id", "in", `(${excludedBranchIds.join(",")})`)` on
  every query that could return multi-branch data. The demo branch must NOT be
  excluded from the Accounts tab (the `test` account legitimately lives there
  and the admin needs to manage it).
  **NEVER gate `getDemoBranchIds()` behind an `account.rights === "ADMIN"`
  check.** The `test` account itself has `ADMIN` rights — gating it means
  `demoBranchIds` gets populated, then every query excludes the demo branch,
  and the demo account ends up unable to see any of its own residents or
  records. `getDemoBranchIds()` must always be called unconditionally; the
  `isDemoUser` check is what decides whether those IDs go into
  `excludedBranchIds` or not. The pattern is always three lines, always in
  this order, always unconditional:
  ```ts
  const demoBranchIds = await getDemoBranchIds();          // never gated on rights
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;
  ```
- `tbl_user_accounts` — logins. `rights` is `ADMIN | MODERATOR | STAFF`,
  scoped to one `branch_id` (except `ADMIN`, which sees everything). This
  is what RLS policies actually check (`auth_role()` / `auth_branch_id()`
  helper functions).
- `tbl_staff` — the clinical/audit roster of real people, separate from
  logins. `role` is also `ADMIN | MODERATOR | STAFF` but is a *different*
  enum from `id_rights` on purpose — don't merge them even though the
  labels currently match (git history has a cautionary tale about doing
  that).
- `tbl_residents` — one row per resident, branch-scoped.
- Clinical tables are generally `tbl_<thing>` for the record plus a
  `tbl_<thing>_<lookup>` for any dropdown whose options should live in the
  database rather than be hardcoded (e.g. `tbl_wound_body_parts`,
  `tbl_physio_treatment_types`). This "lookup lives in Supabase" pattern
  shows up repeatedly — when a dropdown's options might reasonably change
  without a code deploy, model it this way rather than as a TS enum/array.
- A written clinical record generally **freezes** any label it references
  at write time rather than joining live to the lookup table on every read
  (e.g. `tbl_wound_photos.body_part_label` is a plain text column, not
  re-derived from `body_part_id`). This is deliberate: a permanent
  clinical record must keep showing what was true the day it was written,
  even if an admin later renames or deactivates the lookup row.
- RLS is branch-scoped almost everywhere: `ADMIN`/`MODERATOR` bypass, a
  plain `STAFF` login only sees `branch_id = auth_branch_id()`.

## Known feedback / conventions to keep applying

- **Loading state on form submit — use `useTransition`, not `useState` + `setSubmitting`.**
  When a form calls a Server Action that ends with `redirect()`, the navigation happens before
  React can paint a `setState`-triggered re-render, so the user sees no loading indicator.
  The correct pattern is:
  ```tsx
  const [isPending, startTransition] = useTransition();
  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await action(formData);
      if (result?.error) setError(result.error);
    });
  }
  ```
  Use `isPending` (not a `submitting` state variable) to disable the button and show a spinner.
  The button should render a spinning SVG icon alongside "Saving..." while `isPending` is true.
  **Apply this pattern to every form in the project that calls a Server Action.**

- **DEMO branch exclusion** — demo data must be invisible to every user
  except the `test` / DEMO account itself (see canonical `isDemoUser` check
  in the domain model section above). The pattern is already applied in:
  - `residents/page.tsx` — resident list for ADMIN
  - `clinical/page.tsx` + `getWoundSessionHistory`, `getObservationCharts`,
    `getBehaviourCharts` — all clinical fetchers for ADMIN
  - `physiotherapy/page.tsx` — IP/OP patient picker and `AllPatientsReview`
    for ALL users (not just ADMIN, because DEMO is `Function='NUR'` and
    PHY hub accounts enumerate every NUR branch)
  - `physiotherapy/dashboard/page.tsx` — branch dropdown and both
    `fetchAssessments` calls (current + previous period) for ALL users
  - `staff/new/page.tsx` and `staff/[id]/edit/page.tsx` — branch picker
    in the staff registration and edit forms for ALL users
  If you add a new module or any dropdown / list that spans branches, apply
  the same exclusion — otherwise fake demo data will surface to real users.
- **Never import `lib/lookups.ts` (or any file that imports `lib/supabase/server.ts`) from a `"use client"` component** — `server.ts` uses `next/headers`, so the entire import chain gets pulled into the client bundle and Turbopack fails the production build with a "Pages Router" error. If a client component needs a pure helper that lives in `lookups.ts` (e.g. `formatBranch`), inline it or move it to a separate file with no server imports. `tsc --noEmit` will not catch this; only `next build` does.
- **Accounts tab UX** — rows are clickable (entire row, not just the
  username link). Clicking a row shows a confirmation modal ("Edit account
  for [username]?"); confirming navigates to `/accounts/[id]/edit`. The
  view page (`/accounts/[id]`) still exists but is no longer the primary
  entry point from the list. The modal is implemented in
  `accounts/accounts-table.tsx` (client component), keeping the list page
  itself a server component.
- **Medical Progress Notes** (`tbl_progress_notes`): `feeding_plan` and
  `monitoring_plan` are longtext, exactly like `physical_examination` and
  `medical_plan`. In forms, review grids, and table views, size them
  equally wide/tall as those two fields — clinical feeding/monitoring
  instructions are long, and narrow fields clip them. (Prior feedback,
  learned the hard way once.)
- Google-Drive-synced folders (like the `Z:\...` one) can misbehave with
  some tools — verify file existence before assuming a path is wrong.
- When a change touches the live Supabase database or Google Drive, treat
  it like any other production-affecting action: confirm before running,
  and clean up test rows/sessions/files created while verifying a feature
  once you're done (this has been necessary more than once with the Wound
  Photo module's test uploads).
- This app's UI/UX work has used the `ui-ux-pro-max` skill for layout and
  interaction decisions (button prominence, touch targets, field
  alignment) — reach for it again for similar polish requests rather than
  guessing at spacing/sizing from scratch.

## Modules at a glance

| Tab | Sub-tabs / notes |
|---|---|
| Residents | Resident roster + detail page (shows Resident ID); Medication Orders sub-tab (Google Sheet is source of truth — see `google-apps-script/medication-orders.gs` section above) |
| Clinical | Nursing Chart, Observation Chart, Behaviour Chart, Vital Signs, Wound Photo, Medical Progress Notes, Hospital Referral |
| Physiotherapy | IP/OP split, its own assessment form with a body-chart section, treatment types + credit hours (Supabase-driven), an Analytics dashboard |
| Staff | Roster (`tbl_staff`), separate from logins |
| Accounts | Logins (`tbl_user_accounts`); admin-only; clickable rows open an edit-confirmation modal |

Wound Photo is the most involved sub-tab: a front/back body-chart image
(`webapp/public/body-chart-wound.png`) with percentage-positioned tap
targets (round dots for most regions, elongated capsules for Hand/Leg
covering the distal ~60% of the limb), immediate per-photo upload to
Google Drive on "Use Photo" (not batched behind a later Save), and a
"Finish Session" step that waits for any in-flight uploads before
completing. See `webapp/src/app/(app)/clinical/wound-body-diagram.tsx` and
`new-wound-photo-form.tsx` for the current implementation and their inline
comments for the reasoning behind specific coordinate/UX choices.

## Login for testing

A demo login exists for manual testing in this app: username `test`,
password `test123`. Prefer it over inventing test data through the admin
UI when a task just needs "log in and look at something."
