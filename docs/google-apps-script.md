# Google Apps Script — architecture reference

`google-apps-script/` holds the Apps Script code for the three Google-side
integrations. It is a **mirror/reference copy** — Apps Script is deployed
separately (by the user, under `osemmedicare@gmail.com`), so **editing a
`.gs` file here changes nothing at runtime.** See
[Deployment](#deployment) below.

The folder was reorganised into two named projects. The names describe
**direction of data flow**, and the distinction is the single most
important thing to get right when adding a new sync:

| Folder | Apps Script project | Direction | What the Google Sheet is |
|---|---|---|---|
| `Sync From Supabase/` | one project (staff + residents) | Supabase → Sheet | a **read-only mirror** for staff who still work in Sheets |
| `Sync to Supabase/` | one project (medication orders) | Sheet → Supabase | the **source of truth** |
| `wound-photo-drive.gs` | standalone project | webapp → Drive | n/a (binary storage) |

**The two directions are deliberately opposite.** Do not unify them.

- In **Sync From Supabase**, Supabase is the master. Google is a copy that
  can be rebuilt at any time. Editing a cell in the Sheet does *not* flow
  back.
- In **Sync to Supabase**, the Sheet is the master. Supabase is a derived
  read cache, rebuilt from the Sheet. A Sheet edit is the real change.

---

## Spreadsheets

Three distinct spreadsheets, referenced by hard-coded ID.

| Constant | ID | Used by |
|---|---|---|
| System / roster | `18yXlG0YjSkkCCx1pTWOYQYZMCeU8QM7Fo6i77zoMQV4` | `Sync From Supabase` (`CONFIG.SPREADSHEET_ID`) — **also** holds `tbl_ResidentList`, which the medication project writes back to |
| Clinical | `1hoXIYtE4Q4MydbgYHiTsSO9OBYUxbPqcbhsT7VDeYQM` | `Sync to Supabase` (`CONFIG.CLINICAL_SPREADSHEET_ID`) — `tbl_Vital` |
| Medication | `1HXT8HFjjjBakaZiLeU9FggM8cKLZJDBrUjnNqRK3goA` | `Sync to Supabase` (`CONFIG.MEDICATION_SPREADSHEET_ID`) — `tbl_MedicationOrder` |

Note the roster spreadsheet is touched by **both** projects:
`Sync From Supabase` mirrors residents *into* `tbl_ResidentList`, and
`Sync to Supabase` writes the computed `CurrentMedList` cell *back into*
that same tab. This is a real, load-bearing coupling — see
[Why the summary writes back to Sheets](#why-the-summary-writes-back-to-sheets).

### Sheet tabs

| Tab | Spreadsheet | Owner |
|---|---|---|
| `tbl_ResidentList` | Roster | mirrored from Supabase; `CurrentMedList` column written back by the medication project |
| `tbl_StaffList` | Roster | mirrored from Supabase |
| `tbl_Branch` | Roster | lookup: `BranchLocale` ↔ `BranchCode` |
| `tbl_RoleMapping`, `tbl_DepartmentMapping` | Roster | lookup, **legacy Access-era paths only** |
| `tbl_Vital` | Clinical | read-only (`VitalUpdates` GET consumer) |
| `tbl_MedicationOrder` | Medication | **source of truth** for medication orders |
| `tbl_MedicationSyncLog` | Medication | auto-created; `Timestamp`, `Row`, `RxOrderID`, `Error` (stock rows log `Stock <StockID>` in the RxOrderID column) |
| `tbl_MedicationStock` | Medication (`CONFIG.MEDICATION_STOCK_SPREADSHEET_ID`) | **source of truth** for medication stock events; also written by AppSheet |

---

## 1. `Sync From Supabase/` — Supabase → Sheets

One project containing two syncs (residents, staff). No `doGet`; **everything
is POST + JSON**. Responses are **always HTTP 200** — `ContentService` cannot
set a status code — so callers must inspect the `success` field in the body.

### How it is invoked

Two ways, and **not** by the Next.js webapp:

1. **Supabase Database Webhooks** (configured in the Supabase dashboard) —
   the fast path, fires on write.
2. **Time-driven installable triggers** — the reconciliation safety net.
3. Manually, from the Apps Script editor.

There is no committed webapp code calling these routes. The only Apps Script
URLs the webapp holds are the medication ones, the wound-photo one, and
five unrelated standalone macros in `src/config/external-links.ts`.

### `doPost` routing

| Body | Branch | Auth |
|---|---|---|
| `table: "tbl_staff"`, `type: INSERT\|UPDATE\|DELETE` | `syncStaffFromSupabaseWebhook` | ⚠️ **none — see Gotchas** |
| `table: "tbl_residents"`, `type: INSERT\|UPDATE` | `syncResidentFromSupabaseWebhook` | Script Property `OSEM_RESIDENT_WEBHOOK_TOKEN` vs **`e.parameter.token`** (query string, not body) |
| `table: "tbl_ResidentList"`, `action: "updateField" \| "updateFields"` | `syncResidentField(s)` | none |
| `table: "tbl_ResidentList"`, no action | `syncResident` (legacy push) | none |
| `table: "tbl_StaffList"` | `syncStaff` (legacy push) | none |
| `table: "tbl_ProgressNote"` | `syncProgressNote` — **undefined**, dead route | none |

Resident `DELETE` is deliberately **not** handled — a resident deleted in
Supabase lingers in `tbl_ResidentList` until someone removes the row by
hand. Staff `DELETE` *is* handled.

### Triggers

| Trigger | Function | Cadence | Setup function |
|---|---|---|---|
| Staff reconciliation | `syncStaffListFromSupabase` | every **6 hours** | `setupStaffSyncTrigger()` |
| Resident catch-up | `syncNewResidentsFromSupabase` | every **6 hours** | `setupResidentSyncTrigger()` |

### Write patterns differ per entity — this is intentional

- **Staff — full mirror, clear-and-rewrite.** Reads *all* Google-only columns
  into memory keyed by `StaffID`, `clearContent()`s the data block, then
  `setValues()` the whole sorted block. The in-memory read is what preserves
  columns Supabase does not own.
- **Residents — append-only catch-up.** `syncNewResidentsFromSupabase` inserts
  **only** residents not already present; it never corrects existing rows.
  Only a webhook updates an existing resident. Labelled LEGACY in the code.

There is **no incremental cursor** anywhere — no `lastSync` watermark, no
`updated_at >` filter. Both 6-hour jobs are full-table scans. The
`SupabaseUpdatedAt` / `CloudLastUpdated` columns are *written* but never
*read* for filtering. Convergence is idempotent; cost scales with table size,
not change volume.

### Managed vs. Google-owned columns

For `tbl_StaffList`, `getManagedStaffHeaders_()` defines what Supabase
overwrites: `StaffID`, `StaffName`, `Branch`, `Department`, `Position`,
`Role`, `Status`, `BranchID`, `PositionID`, `SupabaseUpdatedAt`,
`CloudLastUpdated`. Every other column is Google-owned and survives both the
full rewrite and a single-row upsert. The resident path does the same for
unmanaged columns by reading the existing row back before overwriting.

`Branch` and `Position` are **not** raw FKs — they resolve through
`tbl_branches.BranchLocale` and `tbl_positions.name` for display.

### The ResidentID invariant

> Supabase owns and generates `ResidentID`. Google copies it **exactly** and
> must never rebuild it from branch code + numeric database id.

This reverses the legacy Access-era `syncResident`/`syncResidentFields`,
which still build `branchCode + "-" + ResidentID`. If an Access-era numeric
id and a Supabase id ever meet in the same sheet they will not match. The
modern Supabase paths honour the invariant; the legacy ones do not.

---

## 2. `Sync to Supabase/` — Sheets → Supabase (Medication Orders)

**The Google Sheet `tbl_MedicationOrder` is the source of truth.** The webapp
never writes `tbl_medication_orders` directly — a Server Action calls the
Apps Script Web App, which writes the Sheet, which then mirrors to Supabase.
Writing Supabase directly from the webapp would silently diverge from the
Sheet. This is also the rule in `docs/medication.md`.

### `Code.gs` — the single entry point

`doPost` / `doGet` are defined **once, here, for the whole project**. Apps
Script merges every `.gs` file into one namespace, so only one global
`doPost` can exist project-wide; a second definition silently discards the
first depending on file load order. `medication-orders.gs` therefore exports
only `createOrder`/`updateOrder` and must **never** define
`doPost`/`doGet`/`jsonResponse` again.

`doPost` actions:

| `action` | Auth | Does |
|---|---|---|
| `create` / `update` | `SHARED_SECRET` constant vs Vercel `MEDICATION_ORDER_SCRIPT_SECRET` | appends a row (see below) |
| `setOrderStatus` | same `SHARED_SECRET` | sets `Status` on existing order rows (webapp Discontinue / auto-expiry), then targeted sync |
| `stockCreate` | same `SHARED_SECRET` | `MedicationStock.gs` `createStockEntry` — appends a `tbl_MedicationStock` row (idempotent on StockID), then syncs it to `tbl_medication_stock` |
| `adminOrderDelete` / `adminStockUpdate` / `adminStockDelete` / `adminConsumableUpdate` / `adminConsumableDelete` | same `SHARED_SECRET` | `AdminEdit.gs` — HQ-ADMIN edit/delete, Sheet row first, then targeted Supabase sync/delete (see `docs/admin-record-edit.md`) |
| `SyncMedicationOrder` | Script Property `MEDICATION_WEBHOOK_TOKEN` | targeted one-row sync + summary rebuild |
| `RebuildMedication` | same token | full `current_medication_list` rebuild for a resident |

`doGet` actions: `MedicationByResident`, `MedicationUpdates`,
`VitalUpdates` (the last reads `tbl_Vital` from the Clinical spreadsheet and
joins resident names from `tbl_ResidentList`). **`doGet` has no auth at
all** — those routes are open to anyone with the URL. They currently have
no caller in the webapp; they are legacy/API-consumer endpoints.

The `create`/`update` branch is checked **before** the
`MEDICATION_WEBHOOK_TOKEN` gate — it has its own `SHARED_SECRET` auth. Note
the token gate is **conditional on the property being set**: if
`MEDICATION_WEBHOOK_TOKEN` is unset, it is skipped entirely.

### `medication-orders.gs` — what a webapp write actually does

`createOrder` appends one row, placing each value via a **live header map**
built from row 1 (`buildColumnMap`) rather than hard-coded positions, so
adding columns to the Sheet later does not break writes. Unmapped payload
keys are ignored.

`updateOrder` **never overwrites in place.** It sets the old row's `Status`
to `"Discontinued"`, then appends a brand-new row with a new `RxOrderID` and
`PreviousRxOrderID` pointing at the old one — a full audit trail.
`INHERITED_ON_REVISION` is **intentionally empty**: all fields are editable
from the form now, and the audit trail is carried by `PreviousRxOrderID`
alone. (An earlier revision inherited drug-identity/dosing columns; the edit
form in `order-form.tsx` no longer locks them either.)

### Dates

The webapp always sends `YYYY-MM-DD`. The Sheet stores **`DD/MM/YYYY`**.
`formatDateForSheet_` converts on write; `normalizeMedicationDate_` parses
it back for Supabase. Never let a `DD/MM/YYYY` string fall through to
`new Date(text)` — that misreads it as `MM/DD/YYYY`.

### `Noted By` is one column

It holds either an internal `tbl_staff.StaffID` (staff picked from the list)
or a free-text name (an external person typed via "Others").
`resolveMedicationNotedBy_` looks the value up against `tbl_staff` to decide:
match → Supabase `noted_by` (FK); no match → `noted_by_external_name` (text).
Supabase keeps both columns; only the Sheet is single-column.

### The Supabase sync layer

`tbl_MedicationOrder` → PostgREST → `tbl_medication_orders`, plus a rebuild
of `tbl_residents.current_medication_list`.

Entry points:

- `syncMedicationOrderAndSummaryNow(rxOrderID, residentID)` — the immediate
  targeted path called by the webapp bridge. Syncs one row, and rebuilds the
  summary for the current resident *and* the previous one if `ResidentID`
  changed. If the row is gone from the Sheet, it mirrors the deletion.
- `syncAllMedicationOrdersToSupabase()` — full 24-hour reconciliation,
  also deletes orders in Supabase that are missing from the Sheet.
- `rebuildCurrentMedication(residentID)` / `rebuildAllCurrentMedications()`.

### How deletions are detected

`onEdit`/`onChange` cannot read a deleted row, so deletion is handled by a
hidden snapshot sheet `_MedicationSyncSnapshot` (a single `RxOrderID`
column). `deleteMedicationIdsMissingFromSheet_` diffs it against the current
Sheet and DELETEs any previously-known `RxOrderID` that has vanished —
covering a deleted row, a cleared `RxOrderID`, and an `RxOrderID` changed
from OLD to NEW.

**The snapshot is only advanced when a pass completes with zero failures.**
If any row errored, no deletions run and the snapshot is retained, so the
next reconciliation retries everything. This is a deliberate anti-data-loss
design — do not "optimise" it by advancing the snapshot unconditionally.

Reconciliation is **sequential, not batched** (`BATCH_SIZE` and
`RECONCILIATION_MINUTES` are declared but unused dead constants). This is
required: `PreviousRxOrderID` must resolve to real Supabase ids, so a
revision row may force a recursive sync of its predecessor, guarded by an
`options.visited` cycle check that throws on a circular chain.

### Required fields at sync time

`validateResolvedMedicationRecord_` hard-requires `external_ref_id`,
`resident_id`, `branch_id`, **`active_ingredient`** and **`start_date`** — a
row missing any of them throws and is logged. A blank `RxOrderID` is
silently *skipped*, not an error.

Writes go through
`POST /rest/v1/tbl_medication_orders?on_conflict=external_ref_id` with
`Prefer: resolution=merge-duplicates,return=minimal` — an upsert keyed on
the sheet's `RxOrderID`.

### Triggers

| Trigger | Function | Cadence | Setup |
|---|---|---|---|
| Sheet edit | `onMedicationEdit` (`MedicationSync.gs`) | on edit | `setupMedicationSupabaseTrigger()` |
| Sheet change | `onMedicationChange` | on change | same |
| Summary edit | `onMedicationSummaryEdit` | on edit | `setupMedicationSummaryTrigger()` |
| Summary change | `onMedicationSummaryChange` | on change | same |
| Summary heartbeat | `medicationSummaryHeartbeat` | every **1 minute** | same |
| Reconciliation | `syncAllMedicationOrdersToSupabase` | every **24 hours** | `setupMedicationReconciliationTrigger()` |
| Stock heartbeat | `medicationStockHeartbeat` (`MedicationStock.gs`) | every **1 minute**, works only when the stock tab's fingerprint changed | `setupMedicationStockTriggers()` |
| Stock reconciliation | `syncAllMedicationStockToSupabase` | every **24 hours**; mirrors deletions only after a zero-failure pass | same |

**The 1-minute heartbeat exists because Apps Script `onEdit`/`onChange` do
not fire for programmatic writes** — bots, AppSheet, and the webapp's own
direct calls all bypass them. It fingerprints the Sheet and only does work
when the fingerprint changed.

**The 24-hour reconciliation + 1-minute heartbeat are what actually make
"s sync must not fail" true.** The fast path in `syncOrderAndSummary_` is
only a fast path. If those triggers are not installed, nothing retries.

### Failure handling

`syncOrderAndSummary_` retries the targeted sync twice inline (800 ms apart),
then on failure writes to the visible `tbl_MedicationSyncLog` sheet — not
just the Apps Script transcript — and returns `willRetryAutomatically: true`.
A failed sync does **not** roll back the Sheet write: the Sheet stays
authoritative, and the two triggers pick the row up.

The Next.js side (`src/lib/medication-orders-script.ts`) mirrors this: it
retries the HTTP call 3× with backoff (Apps Script under a personal account
returns spurious 404/5xx), throws only if `success` is false, and
`console.error`s — but does **not** fail the user — when `supabaseSync`
fails, because the Sheet write already succeeded.

### `current_medication_list` — how the summary is built

`medSummaryFilterActiveOrders_` keeps only orders that are `ACTIVE`, have a
non-empty `external_ref_id`, and are **not superseded** — an order is
superseded if some other order's `previous_order_id` points at it. This is
what makes the discontinue-then-append edit model work.

`medSummaryBuildSummaryFromOrders_` renders each order to a line
(`dosage_form brand_name dose unit frequency (instruction)`), sorts by
`getMedicationPriority` then alphabetically, and groups under bracketed
section headers. Priority (`MedicationPriority.gs`), lower sorts first:

| Section | Priority | Rule |
|---|---|---|
| `REGULAR MEDICATION` | 10–60 | by frequency: `OD`/`OM` 10, `BD` 20, `TDS` 30, `QID` 40, `EOD` 45, `ON` 60, default 50 |
| `EXTERNAL MEDICATION` | 300 | dosage form in `CREAM, OINTMENT, GEL, LOTION, PATCH, SPRAY` |
| `EYE / EAR / NASAL` | 400 | dosage form contains `EYE`/`EAR`/`NASAL` |
| `INHALATION` | 500 | contains `INHAL`/`TURBUHALER`/`RESPIMAT`/`NEB` |
| `INJECTION` | 600 | contains `INJECTION`, or exactly `SC`/`IM`/`IV` |
| `PRN MEDICATION` | 900 | frequency contains `PRN` or `WHEN REQUIRED` — always last |

`getMedicationPriority` is defined once, in `MedicationPriority.gs`, and
consumed by `MedicationSummary.gs`. It is **presentation ordering only** —
never written to Supabase, and not a clinical-urgency judgement. Two
consequences of the rule order: the exact-match external-forms table is
checked *before* the substring rules, and **PRN wins over everything
regardless of dosage form** (an inhaled PRN still sorts into
`PRN MEDICATION` at 900).

The summary is compiled **from Supabase**, not from the Google resident
list — the Sheet is synced first, then read back. Supabase is written
first (`tbl_residents.current_medication_list` PATCH), the Google mirror
second. In the bulk path a Supabase write happens only when the trimmed
text actually changed. If a Supabase resident has no Google mirror row,
the summary deliberately does **not** create one — the resident sync owns
resident rows.

### Why the summary writes back to Sheets

`medSummaryUpdateGoogleResidentSummary_` writes the computed list into the
`CurrentMedList` column of `tbl_ResidentList` in the **roster** spreadsheet
(together with `MedicationLastUpdated`). So that tab is written by both
projects, and the two paths do not fight:

- The **6-hour resident catch-up is append-only** — it inserts missing
  residents and never rewrites an existing row, so it cannot clobber
  `CurrentMedList`.
- The **resident webhook** does map `CurrentMedList` from Supabase
  `current_medication_list` — but the medication summary is itself the
  writer of that Supabase column, so the two agree.

`MedicationLastUpdated` is a **Google-only** column: there is no matching
Supabase timestamp, so the summary writes it directly.

The practical consequence is that both projects must agree on the
`ResidentID` format, and that a resident deleted from the Sheet summary's
point of view still keeps a row in the roster tab — the medication side
leaves the resident record alone ("the resident sync owns that").

---

## 3. `wound-photo-drive.gs` — webapp → Google Drive

A **standalone** project, separate from both folders above.

Wound photo binaries live in Drive, not Supabase Storage, because OSEM's
Drive is a personal (non-Workspace) `@gmail.com` account: service accounts
have no personal storage quota, and Shared Drives are Workspace-only. Apps
Script running *as that account* sidesteps both.

| `action` | Does |
|---|---|
| `upload` | find-or-create the folder chain, write the file |
| `read` | return the file as base64 |
| `delete` | **trash** the file (`setTrashed(true)`), not destroy it |

Auth is a `SHARED_SECRET` constant vs Vercel `GOOGLE_APPS_SCRIPT_SECRET`.
The deployment must be "Anyone" (Next.js calls over plain HTTPS with no
Google login), so the secret is the only real access control.

Folder layout — flattened from an original 4-level chain because each level
is a sequential Drive API call, and an upload was measured taking several
seconds even when every folder already existed:

```
OSEM Clinical Photos / {ResidentID} - {ResidentName} ({BranchCode}) / {YYYY-MM-DD}
```

The caller passes `folderId` once it knows it (`knownFolderId`), so every
photo after the first in a session skips resolution entirely.

**Note the different helper name:** this file uses `jsonResponse`, *not*
`jsonResponse_`. It is a separate project, so there is no collision — but do
not copy that name into either folder above, where it would be a second
global definition.

---

## The webapp side

| Consumer | Script project | Env vars |
|---|---|---|
| `src/lib/medication-orders-script.ts` | Sync to Supabase | `MEDICATION_ORDER_SCRIPT_URL`, `MEDICATION_ORDER_SCRIPT_SECRET` |
| `src/lib/google-drive.ts` | wound-photo-drive | `GOOGLE_APPS_SCRIPT_URL`, `GOOGLE_APPS_SCRIPT_SECRET` |
| `src/config/medication-chart.ts` | **a chart generator not in this folder** | hard-coded public `/exec` URL, no secret |
| `src/config/external-links.ts` | 5 unrelated standalone macros | n/a |

The medication-chart script (`?residentID=&year=&month=`,
`?action=branchchart&branch=`, `?action=familyrequest&residentID=`) is the
**`Appsheet PDF Generation/`** project (added to this repo as a reference
copy; same paste-and-redeploy rule). It is opened directly in a browser tab
and is public (`ANYONE_ANONYMOUS`). `WebApp.gs` `doGet` renders
`Loading.html`, which calls `generateReportForWeb(action, …)` and polls
progress; supported actions: `chart`, `branchchart`, `purchase`, `family`,
`familyrequest`, `familyconsumable`, `medsummary`. It reads spreadsheet IDs
from its own `Config` sheet (`MedicationModuleID`, `SystemSettingsID`) and
the stock tab `tbl_MedicationStock` + unit lookup `tbl_StockUnit`. It has
its own duplicate-global-name hazards (e.g. `writeFamilyReminderRows` and
`testFamilyReminderList` are defined in both `FamilyReminder.gs` and
`FamilyReminderResident.gs` with different signatures).

---

## Deployment

> **Editing a `.gs` file in this repo does nothing until the user pastes it
> into the Apps Script editor and redeploys.**
>
> Deploy → Manage deployments → edit the existing deployment → **New version.**
> A plain save in the editor does **not** update the `/exec` URL. Only the
> user can do this. Never claim a `.gs` change is live without them
> confirming the redeploy.

Per project:

- **Sync From Supabase** — set Script Properties `SUPABASE_URL`,
  `SUPABASE_API_KEY`, `OSEM_RESIDENT_WEBHOOK_TOKEN`; run
  `setupStaffSyncTrigger()` and `setupResidentSyncTrigger()` once each.
- **Sync to Supabase** — set `MEDICATION_WEBHOOK_TOKEN` and the medication
  Supabase properties (`setMedicationSupabaseProperties`); run
  `setupMedicationSupabaseTrigger()`,
  `setupMedicationSummaryTrigger()`,
  `setupMedicationReconciliationTrigger()`, and
  `setupMedicationStockTriggers()`.
- **wound-photo-drive** — paste as `Code.gs`, replace `SHARED_SECRET`, deploy
  as "Me" / "Anyone".

The Apps Script project's real source of truth is the separate
`osemmedicare/test` repo; this folder is the reference copy used for
diffing.

---

## Gotchas

Ordered roughly by how likely they are to bite.

1. **The staff webhook is unauthenticated.** `Code.gs` guards it with
   `if (typeof validateStaffWebhookToken_ === "function")` — and no such
   function exists in the project. The check is silently skipped, so anyone
   who can reach the `/exec` URL can trigger an INSERT/UPDATE/**DELETE**
   against `tbl_StaffList`. The resident webhook *is* properly token-checked,
   which makes this look like an oversight rather than a decision. Adding the
   missing function is the fix.

2. **Never derive `tbl_residents.id` from the numeric suffix of
   `ResidentID`.** The code is emphatic about this and ships a test to prove
   it: `BMN-0145` → `id 356`, `BMN-0148` → `id 359`. The ids do not track
   the suffix. Always look the code up by `ResidentID` in `tbl_residents`
   (`getMedicationResidentByGoogleID_` enforces it). `branch_id` likewise
   comes from the resident row, not from the code's branch prefix.

3. **Duplicate global function names — Apps Script allows one, last file
   wins, silently.** Confirmed in the source:
   - `supabaseGetById_` is defined in **both** `ResidentSync.gs` and
     `StaffSync.gs` with different implementations and different error text.
   - `getMedicationUpdates` and `getMedicationByResident` are each defined in
     **both** `MedicationSync.gs` and `MedicationSummary.gs` — and the two
     versions read from *different sources* (Google sheet vs Supabase).

   Whichever file loads last wins and the other is dead code. A change made
   in the losing file has no effect. Before editing any of these, find every
   definition. This is the same failure class as the historical
   `medication-orders.gs` `doPost` collision documented in
   `docs/medication.md`.

4. **`ResidentSync.gs` depends on `StaffSync.gs`.** Despite the names,
   `StaffSync.gs` is the base library: `ResidentSync.gs` relies on
   `getSupabaseConfig_`, `supabaseGetAll_`, `buildSupabaseLookup_`,
   `normalizeKey_`, `cleanText_` from it. Deleting or renaming anything in
   `StaffSync.gs` breaks resident sync.

5. **`ALLOW_STAFF_COUNT_REDUCTION = false` is a migration tripwire.** The
   full staff mirror refuses to run if Supabase returns fewer rows than the
   Sheet holds, and a zero-row response is an unconditional throw — a
   truncated or mis-scoped PostgREST query (a `select` typo, or an RLS-scoped
   anon key returning `[]`) would otherwise wipe the roster. Do not "fix" it
   by flipping the flag until the migration is genuinely complete. The full
   mirror is also **non-atomic** — `clearContent()` then `setValues()` are
   separate calls, and a failure between them leaves headers with no data.

6. **Lock contention throws rather than queues.** The long paths take
   `LockService.getScriptLock().tryLock(30000)` and **throw** on failure. A
   webhook firing during the 6-hour full mirror fails, and Supabase does not
   retry webhooks by default — so that single change is lost until the next
   full mirror. The lock is script-scoped, so resident and staff syncs block
   each other too.

7. **Sheet config drift between the two medication files.**
   `MedicationSync.gs` reads tab names from `CONFIG.SHEETS`;
   `MedicationSummary.gs` **hardcodes** `"tbl_ResidentList"` and
   `"tbl_MedicationOrder"`. Renaming a tab in `Config.gs` alone breaks the
   summary path silently. Prefer routing both through `CONFIG`.

8. **`tbl_ProgressNote` is a dead route.** `Code.gs` routes it to
   `syncProgressNote`, which is not defined anywhere. Calling it returns
   `{success: false, error: "syncProgressNote is not defined"}`. Progress
   notes are **not** mirrored by this project.

9. **Two paths can write the same cell with different rules.** In the
   resident sync, `Nationality` prefers `country_name` in the 6-hour catch-up
   but `nationality_label` in the webhook — the same Supabase row can land
   differently depending on which path wrote it. `Languages` is written by
   the webhook path only, so catch-up-inserted residents get a blank cell.

10. **Resident dates are written as raw ISO strings** into
   `tbl_ResidentList` `AdmissionDate`/`DischargeDate` — no `DD/MM/YYYY`
   conversion, unlike the medication Sheet. Sheets will coerce and display
   them per the sheet's own locale. Do not assume the medication date rule
   applies here.

11. **The resident webhook does no header validation** — it locates only
    `ResidentID`. Against a malformed sheet it writes a row of blanks rather
    than erroring. The catch-up path's 28-header check is the safe one.

12. **PostgREST calls use the `apikey` header only — no `Authorization:
    Bearer`.** This works only because the anon key's RLS is permissive. If
    RLS is tightened, every sync path in that project breaks at once. Worth
    confirming DEMO rows are not leaking into the mirror sheet.

13. **Pagination is offset-based with no `Prefer: count=exact`**, terminating
    when a page returns fewer than 1000 rows. Correct for a static table;
    can skip or duplicate rows if the table is written mid-scan.

14. **Secret handling is inconsistent across the three projects.**
    `medication-orders.gs` contains a **real, working, hard-coded**
    `SHARED_SECRET` in source — it is committed to git and must match Vercel's
    `MEDICATION_ORDER_SCRIPT_SECRET`. `wound-photo-drive.gs` still carries
    the unfilled placeholder `REPLACE_WITH_SHARED_SECRET` (fine — it is
    meant to be edited in the Apps Script editor before deploy, but do not
    be misled into thinking it is configured). The Supabase API keys are
    handled properly, living only in Script Properties via
    `setMedicationSupabaseProperties`, with an explicit "do NOT hard-code
    the secret key into source code" comment. Treat the medication
    `SHARED_SECRET` as compromised-by-necessity, not as a pattern to copy;
    if this repo is ever made public, rotate that value.

15. **Dead config to ignore:** `CLINICAL_SPREADSHEET_ID` in
    `Sync From Supabase/Config.gs` (unused copy — only the *other* project
    opens it), `SHEETS.USER_ACCESS` / `REPORT` / `REPORT_LAUNCHER`,
    `CONFIG.STATUS`, `CONFIG.ROLE` (the same values are hard-coded in
    `validateStaffMirrorRows_`), and `CONFIG.STAFF_SYNC.WEBHOOK_ENABLED`
    (the webhook branch is unconditional). `MED_SUPABASE_CONFIG.BATCH_SIZE`
    and `RECONCILIATION_MINUTES` are declared but never read, and
    `rebuildAllCurrentMedicationsUnlocked_` is defined but never called.
    `tbl_RoleMapping` / `tbl_DepartmentMapping` are read only by the legacy
    Access-era `syncStaff`/`syncResident` paths, so they are effectively
    frozen. Test helpers hard-code real resident codes (`AMN-138`,
    `BMN-0145`) and a live `/exec` URL — useful, but do not copy them into
    new code.

---

## Verifying a change took effect

Editing here does not deploy. After the user pastes a file into the Apps
Script editor and redeploys, sanity-check with the diagnostics the scripts
already ship, run from the Apps Script editor:

- `testMedicationSupabaseConnection()` — Supabase reachable, table writable
- `testMedicationResidentLookupByID()` — proves the resident-FK lookup
- `testFirstMedicationRowSync()` — one row end to end
- `testRebuildMedication()` / `testRebuildAllMedications()` — summary rebuild
- `testMedicationSupabaseConnection` + `testVitalUpdates()` for the clinical path
- `testStaffWebhookSync()`, `testResidentSyncFields()` for the roster project

The **visible** `tbl_MedicationSyncLog` sheet is the thing to check first
when something looks wrong — it is written for a human, not just the
execution transcript. Note that these tests hit real production data; the
"webhook test" helpers create/remove `DEMO-0001` rows in the mirror sheet.

