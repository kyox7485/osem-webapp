# OSEM Web App — master rulebook

Auto-loaded on every Claude Code session under this repo. This file is
the **always-loaded** rulebook — keep it short; put anything task-specific
in `docs/*.md` and link it from here. When a rule here turns out wrong or
stale, fix it in the same commit that changes the behavior.

## What this is

OSEM is a Malaysian nursing home operator. This repo is a Next.js +
Supabase (Postgres) web app **replacing a legacy Microsoft Access
database** (`OSEM MS_be.accdb`) branch by branch. `ALMA` is the first
branch fully migrated; others still run on Access until their turn comes.

**The live Supabase project holds real production data for ALMA — treat
every write to it accordingly.** Confirm before running anything that
isn't clearly read-only (schema changes, migration scripts, bulk data
edits), and clean up any test rows/sessions/Drive files you create while
verifying a feature. Same caution applies to Google Drive (wound photos)
and the Google Sheet that backs Medication Orders — these are also live
operational data, not sandboxes.

Repo layout, `webapp/` internals, `migration/` scripts, and the
`schema/001_init.sql` snapshot are detailed in `docs/architecture.md`.

## Core database conventions

- `tbl_branches` primary key is **`BranchID`**, not `id` — `.eq("id", …)`
  silently returns nothing. `Function` is `NUR`/`PHY`/`HQ` and gates a lot
  of access logic. Full domain model (staff vs. accounts, lookup-table
  pattern, frozen-label pattern, RLS) in `docs/database.md`.
- `src/lib/current-user.ts`'s `getCurrentUser()` reads `tbl_user_accounts`
  (the **login**, branch/rights scope only), never `tbl_staff` (the real
  clinical roster). Anything attributing an action to a real person needs
  its own explicit staff-picker field — never assume `current_user.id` is
  the author. **`getCurrentUser()` takes zero arguments** — call it as
  `const account = await getCurrentUser();` then
  `const supabase = await createClient();`, not
  `getCurrentUser(supabase)` (TypeScript rejects that and breaks the
  Vercel build).
- **DEMO isolation**: `BranchCode = 'DEMO'` data must be invisible to
  everyone except the `test`/DEMO account. `getDemoBranchIds()` is always
  called **unconditionally** (never gated on `rights === "ADMIN"` — the
  `test` account itself is ADMIN). Canonical 3-line pattern, and the full
  list of places it's already applied, in `docs/database.md`:
  ```ts
  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;
  ```
  Apply this to any new module/dropdown/list spanning branches.

## Coding/build footguns

- **Never import `lib/lookups.ts` (or anything importing
  `lib/supabase/server.ts`) from a `"use client"` component** — pulls in
  `next/headers` and Turbopack fails the production build with a "Pages
  Router" error. Inline the pure helper or move it to a server-import-free
  file instead. `tsc --noEmit` will **not** catch this; only `next build`
  does.
- **Forms: use `useTransition`, not `useState` + a `submitting` flag.** A
  Server Action ending in `redirect()` navigates before a `setState`
  re-render can paint, so a plain state flag never shows a loading state.
  ```tsx
  const [isPending, startTransition] = useTransition();
  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await action(formData);
      if (result?.error) setError(result.error);
    });
  }
  ```
  Use `isPending` to disable the button and show a spinner (spinning SVG +
  "Saving..."). Apply to every form calling a Server Action.
- **Unsaved-changes guard is centralized, not per-form.** Every
  Create/Edit form wires into the single app-wide dirty-form guard (see
  `docs/unsaved-navigation.md`). Any **local `useState` tab/sub-tab
  toggle** (e.g. Review Notes ↔ New Entry, Inpatient ↔ Outpatient) must
  wrap its `setTab` call in `guardedAction(...)` from
  `useSafeNavigation()` — the global `<a>`-click interceptor cannot see a
  plain state toggle, so an unguarded tab switch silently discards dirty
  data.
- Google-Drive-synced folders can misbehave with some tools — verify file
  existence before assuming a path is wrong.
- **All user-visible text must go through the i18n system** (`t()` /
  `getServerTranslator()` — see `docs/i18n.md`). All user-visible option
  labels (`<select>`, custom dropdowns, filter menus, status badges) must
  be translated while the **stored value stays language-neutral** — never
  translate what gets saved to the database. Every new module adds its own
  `dict-<module>.ts` and uses the `{value, label}` + `t(label)` dropdown
  pattern from day one. Run `npm run check:i18n` before calling i18n-facing
  work done — it flags missing MS dictionary entries, duplicate keys with
  conflicting translations, and likely-untranslated dropdown options.

- **All new UI must support Light and Dark themes.** Prefer semantic theme
  tokens (`bg-surface`, `text-fg`, `border-line`, … — see
  `docs/theming.md`) for shared surfaces/text/borders instead of
  hard-coded light-only colours (`bg-white`, `text-gray-*`,
  `border-gray-*`); coloured status classes get the documented `dark:`
  partner. New modules must be tested in Light, Dark and System modes.

## Domain-specific detail (read only when relevant)

- `docs/database.md` — full core domain model, DEMO exclusion checklist.
- `docs/access-clinical-migration.md` — migrating the legacy Access clinical
  tables (NursingChart, ProgressNote, PhyIPProgressNote, HospReferral) into
  Supabase: the `AMN`-not-`ALMA` branch-code trap, IC-over-name identity
  resolution and its asserted overrides, cross-branch staff matching,
  part-time staff auto-creation, the contentless-row skip rule, dropped
  fields, and what's still blocking NursingChart/PhyIPProgressNote.
  `docs/access-clinical-migration-next-branch.md` — the pre-commit checklist for
  migrating a *different* branch: schema-drift guard, branch-scoped lookups
  that resolve nothing, write throughput, and which asserted overrides are
  AMN-only.
- `docs/medication-chart-dosing-days.md` — which day cells the preparation
  chart crosses off with `xxxx`: the single
  `shouldPrepareMedicineOnDay` rule in `CalendarEngine.gs` that the chart,
  the stock forecast and the family reminder PDF all share, and why
  `ON` + specific weekdays used to be silently ignored.
- `docs/medication.md` — Medication Orders: Google Sheet is the source of
  truth, never write `tbl_medication_orders` directly; `Noted By`
  single-column rule; `DD/MM/YYYY` date handling; edit-never-overwrites
  audit trail; Apps Script `doPost`/`doGet` single-entry-point rule;
  every order status change goes Sheet-first.
- `docs/medication-stock.md` — Medication Stock module + Family Medication
  Reminder PDF: Sheet-first stock events, Count vs Estimate units, the
  forecast (implemented twice — `lib/medication-stock.ts` and the PDF
  project's `Stock.gs` — must stay identical), deployment checklist.
- `docs/consumables.md` — Residents → Consumables (weekly count +
  restock PDFs): Sheet-first via the Sync to Supabase project (the
  consumables spreadsheet has no script of its own), ID padding
  (AMN-138 ↔ AMN-0138), restock rule, deployment checklist.
- `docs/google-apps-script.md` — the Apps Script folder: the two sync
  projects and their **opposite** directions (Supabase→Sheets mirror vs.
  Sheets→Supabase source of truth), all webhook routes, trigger cadences,
  the webapp↔script contract, redeploy requirement, and the known gaps
  (unauthenticated staff webhook, duplicate function definitions).
- `docs/integrations.md` — Google Drive (wound photos) and Apps Script
  redeploy mechanics; Telegram per-branch setup.
- `docs/clinical.md` — modules-at-a-glance, Wound Photo body-chart,
  Progress Notes field-sizing rule, Accounts tab UX, physiotherapy dirty
  bridge, Admission Analytics/bed-capacity feature.
- `docs/unsaved-navigation.md` — full dirty-form guard architecture and
  known footguns.
- `docs/deployment.md` — canonical, current deployment reference (Vercel,
  Supabase schema changes, Apps Script redeploy). Supersedes the
  historical root-level `DEPLOYMENT_INSTRUCTIONS.md`.
- `docs/admin-record-edit.md` — HQ-ADMIN Edit/Delete buttons on every
  record: `isHqAdmin()` gate (server-checked), field whitelist registry,
  service-role writes, Sheet-first routes in `AdminEdit.gs` (needs an Apps
  Script redeploy).
- `docs/theming.md` — Light/Dark/System architecture, token cheat-sheet,
  coloured-status `dark:` convention, testing checklist.
- `docs/architecture.md` — repo layout, `webapp/` internals, env vars,
  `migration/` scripts, `schema/001_init.sql`.
- `docs/i18n.md` — full i18n architecture: dictionary-key convention,
  interpolation, the dropdown/option rule, DB-driven lookup tables' known
  exception, `npm run check:i18n`, and current known gaps (Server Action
  error messages, PDF reports, physio score labels aren't translated yet).

Root-level `COMPLETION_SUMMARY.md` / `IMPLEMENTATION_SUMMARY.md` /
`DEPLOYMENT_INSTRUCTIONS.md` are **historical snapshots of one past
feature build**, not standing rules — don't treat them as authoritative;
the shipped code and `docs/*.md` are current truth.

## Claude Code workflow

1. Read `CLAUDE.md` (this file) first.
2. Identify the smallest relevant file set for the task.
3. Inspect those files and their direct dependencies first.
4. Read the relevant `docs/*.md` only when the task touches that area.
5. Search further call-sites only when the evidence requires it.
6. Reuse existing patterns (dirty-form guard, DEMO exclusion, lookup
   tables, Server Action + `useTransition`) before creating new ones.
7. Prefer the smallest safe change.
8. Do not refactor unrelated code.
9. Use the `ui-ux-pro-max` skill for UI/UX layout and interaction work.
10. Run the cheapest relevant validation (`npm run lint`,
    `npx tsc --noEmit -p .`, or `next build` when the client/server import
    footgun above is in play) before declaring a change done.

### Scope discipline

Do not scan the entire repository by default. Expand scope only when the
evidence in front of you requires it.

### Verification honesty

Never claim lint, TypeScript, build, runtime, database, or deployment
verification unless you actually ran it and saw the result.
