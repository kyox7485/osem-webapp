# Database — detail

Core rules that apply to nearly every task already live in `CLAUDE.md`.
Read this file when a task needs the full domain model, the DEMO
exclusion checklist, or lookup-table conventions.

## Core tables

- `tbl_branches` — one row per physical branch. **Primary key is
  `BranchID` (PascalCase), not `id`.** Always `.eq("BranchID", ...)` —
  `.eq("id", ...)` silently returns nothing (past bug: Telegram
  notifications silently dropped because the branch lookup always came
  back empty). `telegram_chat_id` (text, nullable) stores the Telegram
  group chat ID for that branch; `TELEGRAM_BOT_TOKEN` is one Vercel env
  var shared by all branches — enabling notifications for a branch is
  just filling in its `telegram_chat_id`, no code change.
  `Function` is `'NUR'` (residential/nursing branch), `'PHY'` (standalone
  physio hub, e.g. AMP), or `'HQ'`. Access rules key off this a lot.
  `bed_capacity` (integer, nullable) — official bed count, used by
  Admission Analytics occupancy %; NULL means "not configured".
- `tbl_user_accounts` — logins. `rights` is `ADMIN | MODERATOR | STAFF`,
  scoped to one `branch_id` (except `ADMIN`, which sees everything). This
  is what RLS policies check via `auth_role()` / `auth_branch_id()`.
- `tbl_staff` — the clinical/audit roster of real people, separate from
  logins. `role` is also `ADMIN | MODERATOR | STAFF` but is a *different*
  enum from `id_rights` on purpose — don't merge them even though the
  labels currently match (git history has a cautionary tale about doing
  that).
- `tbl_residents` — one row per resident, branch-scoped.
- Clinical tables are generally `tbl_<thing>` for the record plus a
  `tbl_<thing>_<lookup>` for any dropdown whose options should live in the
  database rather than be hardcoded (e.g. `tbl_wound_body_parts`,
  `tbl_physio_treatment_types`). When a dropdown's options might
  reasonably change without a code deploy, model it this way rather than
  as a TS enum/array.
- A written clinical record generally **freezes** any label it references
  at write time rather than joining live to the lookup table on every read
  (e.g. `tbl_wound_photos.body_part_label` is a plain text column, not
  re-derived from `body_part_id`). Deliberate: a permanent clinical record
  must keep showing what was true the day it was written, even if an
  admin later renames or deactivates the lookup row.
- RLS is branch-scoped almost everywhere: `ADMIN`/`MODERATOR` bypass, a
  plain `STAFF` login only sees `branch_id = auth_branch_id()`.

## DEMO isolation — canonical check

`BranchCode = 'DEMO'` (currently `BranchID = 6`) marks the demo/test
branch. Its residents (IDs 365–384), all physio assessments, and all OP
patients are fake data used only for demonstrations via the `test`
account. Because it has `Function = 'NUR'`, PHY hub accounts (whose
allowed branch list includes every NUR branch) would also pick it up — so
the exclusion applies to **every user** whose own `branch_id` is not the
DEMO branch, not just ADMIN.

```ts
const demoBranchIds = await getDemoBranchIds();          // never gated on rights
const isDemoUser = demoBranchIds.includes(account.branch_id);
const excludedBranchIds = isDemoUser ? [] : demoBranchIds;
```

**Never gate `getDemoBranchIds()` behind an `account.rights === "ADMIN"`
check.** The `test` account has `ADMIN` rights — gating it means
`demoBranchIds` gets populated for the demo account too, every query then
excludes the demo branch, and the demo account ends up unable to see its
own residents/records. `getDemoBranchIds()` is always called
unconditionally; `isDemoUser` decides whether those IDs go into
`excludedBranchIds`. Apply
`.not("branch_id", "in", `(${excludedBranchIds.join(",")})`)` on every
query that could return multi-branch data. The Accounts tab is the one
exception — it must NOT exclude the demo branch, since the `test` account
legitimately lives there and admins need to manage it.

Already applied in:
- `residents/page.tsx` — resident list for ADMIN
- `clinical/page.tsx` + `getWoundSessionHistory`, `getObservationCharts`,
  `getBehaviourCharts` — all clinical fetchers for ADMIN
- `physiotherapy/page.tsx` — IP/OP patient picker and `AllPatientsReview`
  for ALL users (DEMO is `Function='NUR'`, so PHY hub accounts enumerate
  every NUR branch too)
- `physiotherapy/dashboard/page.tsx` — branch dropdown and both
  `fetchAssessments` calls (current + previous period) for ALL users
- `staff/new/page.tsx` and `staff/[id]/edit/page.tsx` — branch picker for
  ALL users

If you add a new module or any dropdown/list that spans branches, apply
the same exclusion — otherwise fake demo data surfaces to real users.

## Login for testing

A demo login exists for manual testing: username `test`, password
`test123`. Prefer it over inventing test data through the admin UI when a
task just needs "log in and look at something."
