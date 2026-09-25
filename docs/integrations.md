# Integrations — detail

> For the full `google-apps-script/` picture — both sync projects, all
> webhook routes, trigger cadences and their gotchas — see
> `docs/google-apps-script.md`. This page stays the short entry point.

## Google Drive (wound photo storage)

Wound photo binaries live in Google Drive, not Supabase Storage, because
OSEM's Drive is a personal (non-Workspace) `osemmedicare@gmail.com`
account — no Shared Drive for a service account to use.
`google-apps-script/wound-photo-drive.gs` runs *as that real account* via
Apps Script's Web App deployment, called from
`webapp/src/lib/google-drive.ts`. **Editing this file does nothing by
itself** — Apps Script needs a manual redeploy (Deploy → Manage
deployments → edit existing → New version) under that Google account,
which only the user can do. After editing this file, say so explicitly
rather than assuming the change is live.

## Apps Script — shared mechanics

`google-apps-script/` contains multiple `.gs` files that are all merged
into one Apps Script project namespace at deploy time — only one
`doPost`/`doGet` can exist project-wide (see `docs/medication.md` for the
specific routing rule that came out of a real bug here). The general
rule: any `.gs` file edited here needs the user to paste it into the Apps
Script editor and redeploy before it's live; a plain save in the Apps
Script editor does not update the `/exec` URL Vercel calls.

## Telegram

One bot (`TELEGRAM_BOT_TOKEN` Vercel env var) serves all branches.
Per-branch notifications are enabled by setting that branch's
`tbl_branches.telegram_chat_id` — no code change needed. See
`docs/database.md` for the `tbl_branches` primary-key footgun that has
broken this before.
