# Deployment — canonical reference

This is the current, authoritative deployment doc for this repo. The
root-level `DEPLOYMENT_INSTRUCTIONS.md` is a historical, feature-specific
snapshot (the Admission Analytics bed-capacity rollout) and should not be
treated as standing process — this file supersedes it.

## Web app (Vercel)

- The webapp deploys to Vercel from the `main` branch (standard Next.js
  Git-integration deploy — push to `main`, Vercel builds and promotes).
- Env vars live in Vercel project settings; server-only ones
  (`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_APPS_SCRIPT_*`, `OMNIROUTE_*`,
  `MEDICATION_ORDER_SCRIPT_SECRET`, `TELEGRAM_BOT_TOKEN`) must never be
  `NEXT_PUBLIC_`. See `webapp/.env.local.example` for the full list.
- Before pushing a change that should deploy: run `npm run lint` and
  `npx tsc --noEmit -p .` from `webapp/` (see `CLAUDE.md` for why these
  two, not `next build`, are the default checks) — but note `tsc` does
  **not** catch the client/server import footgun (see `CLAUDE.md`); only
  `next build` does, so run that too before anything that touches
  `lib/lookups.ts`-adjacent imports or new client components.

## Database (Supabase)

- Schema changes are hand-applied: write a numbered SQL file under
  `schema/` (e.g. `002_add_bed_capacity.sql`) for the historical record,
  then run it against the live Supabase project via the SQL Editor (or an
  MCP `execute_sql`/`apply_migration` call) — there is no automated
  migration runner for schema changes made after `001_init.sql`.
- **This is production data for ALMA.** Confirm with the user before
  running any schema change or data-affecting statement, the same as any
  other production-affecting action.
- After a schema change, update `schema/001_init.sql`'s surrounding
  commentary only if it meaningfully changes the "original design intent"
  story — otherwise leave `001_init.sql` alone and let the numbered
  migration file stand as the record (see `docs/architecture.md`).

## Google Apps Script (Drive + Medication Orders)

Apps Script changes are **never live from a git push** — see
`docs/integrations.md` and `docs/medication.md`. After editing a `.gs`
file, hand it to the user via `SendUserFile`; they paste it into the Apps
Script editor and redeploy (Deploy → Manage deployments → edit existing →
New version). Never report a `.gs` change as deployed without the user
confirming the redeploy.

## Post-deploy checklist (schema changes)

Adapted from the Admission Analytics rollout — reusable whenever a schema
change ships that a feature depends on:

1. Confirm the SQL ran against Supabase without error.
2. Confirm the webapp's Vercel deployment picked up the corresponding
   code (check the deployed commit).
3. Smoke-test the affected page/flow as a real (or the `test`/DEMO)
   account.
4. Clean up any test rows/sessions/Drive files created while verifying.
