# OSEM Webapp — Developer Quick-Start

Invoke this skill at the start of a new chat (`/osem-dev`) to load the project's
key conventions, skill triggers, and file map into context.

---

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router), React 19 |
| Styling | Tailwind CSS v4 |
| Language | TypeScript (strict) |
| Backend | Supabase (Postgres + Auth + RLS) |
| Storage | Google Drive (wound photos only) |
| Deploy | Vercel |

---

## Before calling any change done

```bash
# from webapp/
npx tsc --noEmit -p .
npm run lint
```

---

## Skill triggers — reach for these automatically

| Task type | Skill to invoke |
|-----------|----------------|
| Any UI layout, component design, spacing, or polish | `ui-ux-pro-max` |
| Planning a new feature or multi-step change | `writing-plans` |
| Pre-commit / pre-PR cleanup | `finishing-a-development-branch` |
| Systematic bug hunt | `systematic-debugging` |

---

## Translation pattern

All user-visible English strings go through `t("English text")`.  
Add missing keys to the matching `webapp/src/lib/i18n/dict-*.ts` file:

| Module | Dictionary file |
|--------|----------------|
| Common | `dict-common.ts` |
| Residents | `dict-residents.ts` |
| Clinical | `dict-clinical.ts` |
| Physiotherapy | `dict-physio.ts` |
| Staff | `dict-staff.ts` |
| Accounts | `dict-accounts.ts` |

Missing key = falls back to English, not a build error.  
For clinical/physio anatomical terms, prefer native clinical Bahasa Malaysia (e.g. "Fleksor", "Pinggul") over literal translations.

---

## Form conventions

- **New-entry forms**: hide fields that default on creation (e.g. Status = ACTIVE, admission_date = today).
- **Progress notes / clinical plans**: single-column layout at all screen sizes.
- **Staff role**: only show the Role selector if `isAdmin` — others auto-receive `STAFF`.
- **Lookup dropdowns**: if options might change without a code deploy, store them in Supabase (`tbl_*` lookup tables), not as TS enums.

---

## Production data warning

The live Supabase project is **real production data** for the ALMA branch.  
Confirm before running any `migration/scripts/*.py` file that is not clearly read-only.  
Clean up any test rows / Drive files created during verification.

---

## Key file map

```
webapp/src/
  app/(app)/
    residents/new/page.tsx          New resident page
    clinical/                       Clinical sub-modules (Nursing Chart, Vitals, Wound Photo, Progress Notes, Hospital Referral)
    physiotherapy/                  Physiotherapy module (assessment, analytics)
    staff/new/page.tsx              New staff page
    accounts/                       User-account management (admin only)
  components/
    resident-form.tsx               Shared resident create/edit form
    staff-form.tsx                  Shared staff create/edit form
    sidebar.tsx                     App shell sidebar (collapsible)
    sign-out-button.tsx             Sign-out action (collapsed/expanded variants)
  lib/
    supabase/{client,server,admin}  Supabase client factories
    current-user.ts                 Login account helper (NOT the clinical roster)
    i18n/dict-physio.ts             Physio BM translations (largest dict)
    physio-scoring.ts               EXAM_STRUCTURE + scoring scales
```

---

## Domain model reminders

- `tbl_user_accounts` = **logins** (branch-scoped, rights = ADMIN | MODERATOR | STAFF)
- `tbl_staff` = **clinical roster** (separate from logins — never conflate)
- Clinical records **freeze** lookup labels at write time (no live joins to lookup tables)
- RLS is branch-scoped; `ADMIN`/`MODERATOR` bypass; plain `STAFF` sees only their branch
