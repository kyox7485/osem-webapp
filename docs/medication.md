# Medication Orders — detail

> For the whole Apps Script side — including the other (Supabase→Sheets)
> sync project and the roster mirror the medication summary writes back
> into — see `docs/google-apps-script.md`.

The webapp **never writes directly to `tbl_medication_orders`**. Flow:
Next.js Server Action → Google Apps Script Web App → Google Sheet
`tbl_MedicationOrder` (source of truth) → a separate Apps Script sync
layer mirrors that sheet into Supabase `tbl_medication_orders` → and
rebuilds `tbl_residents.current_medication_list` for the affected
resident(s). If a future change is tempted to have the webapp upsert
`tbl_medication_orders` directly, don't — it would silently diverge from
the sheet.

## Where the code actually lives

**The Apps Script project's real source of truth is a separate repo,
`osemmedicare/test`, not this one.** This repo only tracks a copy of
`google-apps-script/medication-orders.gs` for reference/diffing — Claude
Code sessions here typically do **not** have push access to
`osemmedicare/test`. When `medication-orders.gs`, `MedicationSync.gs`,
`MedicationSummary.gs`, `Config.gs`, `Code.gs`, or `Utils.gs` need to
change, edit the local clone, then hand the changed file(s) to the user
via `SendUserFile` — they paste them into the Apps Script editor and
redeploy (Deploy → Manage deployments → edit existing → New version; a
plain save does not update the live `/exec` URL). Never claim a `.gs`
change is live without the user confirming they redeployed.

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

## Business rules — current as of last revision

- **`Noted By` is a single sheet column**, not two. It holds either an
  internal `tbl_staff.StaffID` (when the picker's staff list was used) or
  a free-text name (when "Others" was picked — e.g. a visiting doctor).
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
  row's `Status` to `"Discontinued"` and appends a brand-new row with a
  new `RxOrderID` and `PreviousRxOrderID` = the old `RxOrderID`, giving a
  full audit trail. `INHERITED_ON_REVISION` in `medication-orders.gs` is
  now **intentionally empty** — every field, including dosing,
  indication and instruction, comes from the submitted form, and the edit
  form (`order-form.tsx`) no longer locks them. The audit trail is carried
  by the `PreviousRxOrderID` chain alone. (An earlier revision inherited
  the 9 drug-identity/dosing fields from the old row; that restriction was
  lifted.) `order-actions.ts`'s `updateOrderAction` generates the new
  `RxOrderID` the same way `createOrderAction` does. The superseded row is
  excluded from `current_medication_list` because
  `medSummaryFilterActiveOrders_` drops any order some other order's
  `previous_order_id` points at.
- Both `createOrder`/`updateOrder` call `syncOrderAndSummary_`, which
  retries `syncMedicationOrderAndSummaryNow` (from `MedicationSummary.gs`)
  a couple of times inline, then falls back to two automatic safety nets
  if it still fails: `MedicationSummary.gs`'s 1-minute heartbeat and
  `MedicationSync.gs`'s 24-hour reconciliation
  (`syncAllMedicationOrdersToSupabase`). Both must actually be installed
  (`setupMedicationSummaryTrigger()` / `setupMedicationReconciliationTrigger()`
  run once each) for "the sync must not fail" to actually hold. A sync
  failure is also written to the visible `tbl_MedicationSyncLog` sheet,
  not just the Apps Script execution transcript.
