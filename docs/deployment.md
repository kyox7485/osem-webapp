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

### `NEXT_PUBLIC_APP_URL` — required for Auth email links

Set this Vercel env var to the app's **production** hostname, no trailing
slash: `https://osem-webapp.vercel.app`. It is not optional in practice:
without it, `createAccount()` and the forgot-password page fall back to the
incoming request's `Origin`/`Host`, so an admin working from a **preview
deployment** mints invite links off a `*.vercel.app` host that isn't
allow-listed in Supabase. Those invites are then dead on arrival.

`webapp/.env*` is gitignored; `webapp/.env.local.example` is force-added
(`git add -f`) so it documents the var, but the real value lives in Vercel.

`/reset-password` must consume the link's own session: admin invites
arrive as an implicit `#access_token` fragment, which the PKCE-mode
browser client ignores. Never fall back to whatever session is already in
the browser there — that once let an invitee's new password overwrite the
inviting admin's own password.

Two Supabase/Vercel dashboard settings must agree with it, or the invite
email still bounces the user off to Supabase's own applet (which then asks
for a phone number):

1. **Supabase → Authentication → URL Configuration**
   - *Redirect URLs*: must contain the production origin and
     `.../reset-password`. Add the preview pattern
     (`https://<project>-*.vercel.app/**`) only if preview invites are
     wanted.
   - *Site URL*: set to the production origin too. This is Supabase's
     silent fallback when a `redirectTo` misses the allow-list, so a
     correct Site URL turns a total failure into a working link.
2. **Vercel → Settings → Deployment Protection**: off, or at minimum
   `/reset-password` and `/login` excluded from the password/OTP gate —
   otherwise a genuine invitee hits Vercel's challenge screen instead of
   your password form.

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
