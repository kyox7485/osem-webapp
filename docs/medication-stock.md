# Medication Stock + Family Medication Reminder — reference

Built 2026-09-25. Read this before touching anything under
`residents/medication/stock`, the stock sync, or the family reminder PDF.
Related: `docs/medication.md` (order rules), `docs/google-apps-script.md`
(both Apps Script projects in general).

## 1. What it is (and is not)

A **stock forecast + receiving/count audit trail**, not inventory.
Nurses sign doses on paper charts, so real consumption is unknown:

- **Count units** — balance is *forecast* from the medication order since the
  last stock event. A physical Stock Count replaces the forecast.
- **Estimate units** — balance is whatever a nurse last counted/estimated
  (+ anything received). Never reduced automatically.
- **PRN** — no forecast.

Never present a forecast as a guaranteed physical quantity (the UI labels it
"Forecast").

No warehouse, transfers, purchase orders or daily rows. The unrelated
`tbl_stock_*` / `tbl_product_stock` tables belong to the products module.

## 2. Data flow

```
Stock screen (Next.js)
  └─ stock-actions.ts recordStockEntryAction
       └─ medication-orders-script.ts createMedicationStockEntry
            └─ POST Apps Script "Sync to Supabase"  {action: "stockCreate", secret}
                 └─ Code.gs doPost → MedicationStock.gs createStockEntry
                      ├─ append row to Google Sheet tbl_MedicationStock   ← SOURCE OF TRUTH
                      └─ inline targeted sync → Supabase tbl_medication_stock (mirror)

AppSheet writes the same tab directly
  └─ medicationStockHeartbeat (1 min, fingerprint) + syncAllMedicationStockToSupabase (24 h)

Family Medication Reminder button (Stock screen)
  └─ opens MEDICATION_CHART_SCRIPT_URL?action=familyrequest&residentID=<ResidentID>
       └─ Apps Script "Appsheet PDF Generation": WebApp.gs doGet → Loading.html
            → generateReportForWeb → generateResidentFamilyReminderPdf
            (reads the Google Sheets, NOT Supabase)
```

Same rules as Medication Orders: **the webapp never writes
`tbl_medication_stock` directly**, one global `doPost` per Apps Script
project, `SHARED_SECRET` = Vercel `MEDICATION_ORDER_SCRIPT_SECRET`.

### Order status changes are Sheet-first too
`discontinueOrderAction` and `autoExpireOrdersAction` call Apps Script
`action: "setOrderStatus"` (`medication-orders.gs`). They used to write
Supabase directly, which never reached the Sheet/AppSheet and was reverted by
the next Sheet→Supabase sync. **Any webapp change to medication data must go
Sheet-first.** IDs missing from the Sheet fall back to a direct Supabase
update. Manual edits made in the Supabase dashboard are still **not**
mirrored to the Sheet (a DB webhook was deliberately not added because of
sync-loop risk).

## 3. File map

| Area | File | Role |
|---|---|---|
| Webapp page | `webapp/src/app/(app)/residents/medication/stock/page.tsx` | Loads residents, active orders, stock events, staff; computes current status |
| Webapp UI | `.../stock/stock-module.tsx` | Resident picker (Prev/Next), cards (mobile) / table (desktop), Count/Received/History modals, Family Reminder button |
| Server Action | `.../stock/stock-actions.ts` | `recordStockEntryAction` — validation, access + DEMO check, balance calculation |
| Forecast (pure) | `webapp/src/lib/medication-stock.ts` | Units, tracking, daily usage, dosing days, forecast, days remaining. Client-safe |
| Server helpers | `webapp/src/lib/medication-stock-server.ts` | StockID generation, latest event, `recordOrderChangedStock` (not a Server Action on purpose) |
| Apps Script bridge | `webapp/src/lib/medication-orders-script.ts` | `createMedicationStockEntry`, `setMedicationOrderStatus` |
| Order edits | `.../orders/order-actions.ts` | Order Changed on edit; Sheet-first discontinue / auto-expire |
| Tab | `.../medication/medication-tabs.tsx` | Orders · Stock · Charts |
| i18n | `webapp/src/lib/i18n/dict-medication.ts` | "Stock" section |
| DB | `migration/scripts/create_medication_stock_table.sql` | Table, checks, indexes, RLS (already applied to production) |
| Sync | `google-apps-script/Sync to Supabase/MedicationStock.gs` | `createStockEntry`, sync, heartbeat, reconciliation |
| Sync | `.../Sync to Supabase/Code.gs`, `Config.gs`, `medication-orders.gs` | `stockCreate` / `setOrderStatus` routes, tab config, `setOrderStatus` |
| PDF | `google-apps-script/Appsheet PDF Generation/Stock.gs` | `getLatestMedicationStock` → live forecast (`getLiveStockForecast_`) |
| PDF | `.../FamilyReminderResident.gs`, `FamilyReminder.gs`, `PurchaseReport.gs`, `Utilities.gs` | Reminder / purchase / summary consumers |

## 4. Data model

**Google Sheet `tbl_MedicationStock`** (exact name — the PDF project reads it
as `CONFIG.MEDICATION_STOCK_SHEET`; spreadsheet = Sync project
`CONFIG.MEDICATION_STOCK_SPREADSHEET_ID`, assumed to be the medication
spreadsheet `1HXT8…`):

`StockID | ResidentID | RxOrderID | Balance | Unit | Daily Usage | Days Remaining | StockDate | RegisteredBy | EntryType`

**Supabase `tbl_medication_stock`**: `external_ref_id` (StockID, unique),
`branch_id` (from resident, for RLS), `resident_id`, `medication_order_id`
(exact RxOrderID revision, `on delete cascade`), `balance`, `unit` (check:
15 units), `daily_usage`, `days_remaining`, `stock_date` (timestamptz),
`registered_by` (→ `tbl_staff.StaffID`), `entry_type` (check: 3 types),
`created_at`. RLS = same `branch_scope_*` policy as `tbl_medication_orders`.

## 5. Business rules

**Entry types** (exactly): `Stock Count`, `Stock Received`, `Order Changed`.
Rows are events only — never a daily row. `Balance` = balance *after* the event.

**Units**

| Count (forecast) | Estimate (never auto-reduced) |
|---|---|
| Tablet, Capsule, Sachet, Ampoule, mL, Puff, Unit | Bottle, Tube, Jar, Cannister, Pump, Drop, Pen, Application |

The same list lives in `medication-stock.ts` `STOCK_UNITS`, `MedicationStock.gs`
`MED_STOCK_UNITS`, the SQL check constraint, and the PDF project's
`tbl_StockUnit` sheet — change all four together.

**Stock Count** — Balance = what the nurse physically counted/estimated. New
forecast baseline.

**Stock Received** — nurse enters only the received quantity; server
computes `current forecast/known balance + received`. Must use the unit the
stock is already recorded in (changing unit = a Stock Count).

**Order Changed** — on order edit (`updateOrderAction` →
`recordOrderChangedStock`): if the old RxOrderID had stock, write an event on
the **new** RxOrderID carrying the balance the old order had reached.
RegisteredBy = Noted By if it is a real StaffID, else blank. Old history stays
on the old RxOrderID. A discontinued order with no replacement just drops off
the screen. Best-effort: never fails the order edit.

**RegisteredBy** — must be a `tbl_staff.StaffID`; picker offers ACTIVE staff
of the resident's branch + HQ. No free text. Never default to the logged-in
account (see CLAUDE.md: accounts ≠ staff).

**StockDate** — webapp sends `DD/MM/YYYY HH:mm:ss` (Asia/Kuala_Lumpur);
`createStockEntry` stores it as a real **date cell** formatted
`dd/MM/yyyy HH:mm:ss`. Readers must never `new Date("DD/MM/YYYY")` (MM/DD
misread) — use `medStockNormalizeDateTime_` / `parseStockDate_`.

**Stored Daily Usage / Days Remaining are snapshots at event time**; `0` =
not applicable (AppSheet convention). Never display them as current values.

## 6. Forecast algorithm (both implementations)

Implemented twice and **must stay identical**:
`webapp/src/lib/medication-stock.ts` and
`Appsheet PDF Generation/Stock.gs` `getLiveStockForecast_`.

- Not forecast (Daily Usage / Days Remaining = "—"/`""`): Estimate unit, PRN,
  or stock unit ≠ order dose unit (case-insensitive, so `ml` = `mL`).
- Daily usage = `Dose × number of Administration Times` (fallback by
  frequency: OD/OM/ON 1, BD 2, TDS 3, QID 4, EOD / Every 3 Days / Selected
  Days 1) — the quantity used on each **dosing day**.
- Dosing day = the chart's rule (`CalendarEngine.gs`
  `shouldPrepareMedicineOnDay`): not before Start Date, not after End Date,
  EOD / Every 3 Days counted from Start Date, Selected Days/Others by weekday.
- Current balance = latest event balance − usage × (dosing days strictly
  after the event date, up to and including today). Event day = recorded
  value. Floored at 0.
- Days Remaining = calendar days from tomorrow until the first dosing day
  whose dose can't be met (non-dosing days in between count). If End Date
  comes first → "—" (supply outlasts the order).
- Calendar days are Kuala Lumpur dates (webapp) / script timezone
  Asia/Singapore (+08:00, identical) in Apps Script.

`getLatestMedicationStock` (PDF project) replaces each latest row's
`Balance` / `Daily Usage` / `Days Remaining` with the live values
(`RecordedBalance` keeps the sheet value), so **every** PDF report —
`family`, `familyrequest`, `purchase`, `medsummary` — uses today's numbers.
Consumers treat `Days Remaining === ""` as "not forecastable", never 0.

## 7. Family Medication Reminder PDF

- Button: Stock screen, selected resident header. Opens the chart script URL
  (`webapp/src/config/medication-chart.ts`) in a new tab — same pattern as the
  resident medication chart. Opened without `noopener` (which makes
  `window.open` return null), then `win.opener = null`.
- Template and `Loading.html` were not changed.
- Included items: `Supplied By = Family`, Active, and
  Count unit with Days Remaining **≤ 14** (existing code; the template text
  says "less than 14" — left as-is, decide before changing) or Estimate unit
  with Balance ≤ 1. Non-forecastable Count items (PRN, unit mismatch) are not
  included; if shown elsewhere they display "📦 N Unit(s) In Stock".
- No matching items → Loading.html shows "This resident has no family
  medication requiring reminder." (no PDF created).
- PDFs go to the Drive `TemporaryPdfFolderID`; `cleanupTemporaryPdfs`
  removes them after 24 h.

## 8. Deployment checklist

Order matters — the webapp calls Apps Script actions that don't exist until
redeploy (Discontinue would break).

1. **Supabase** — `tbl_medication_stock` already exists (applied
   2026-09-25). Re-running the SQL is idempotent.
2. **Apps Script "Sync to Supabase"** — paste `MedicationStock.gs` (new),
   `Code.gs`, `Config.gs`, `medication-orders.gs`. Deploy → Manage
   deployments → edit → **New version**. Run once:
   `setupMedicationStockTriggers()`, then `testMedicationStockSync()`
   (backfills existing sheet rows). Check `tbl_MedicationSyncLog` (stock rows
   appear as `Stock <StockID>`).
3. **Apps Script "Appsheet PDF Generation"** — paste `Stock.gs`,
   `FamilyReminderResident.gs`, `FamilyReminder.gs`, `PurchaseReport.gs`,
   `Utilities.gs`. Redeploy (New version).
4. **Webapp** — deploy to Vercel.
5. Verify (section 9).

Editing a `.gs` file in this repo changes nothing until it is pasted and
redeployed. Never claim it is live without the user confirming.

## 9. Verification

Local, no production writes:
- `npx tsc --noEmit -p .`, `npm run lint`, `npm run check:i18n` (baseline:
  26 pre-existing duplicate-key errors), `next build`.
- Forecast cases (all passed 2026-09-25): 100 tabs BD → 100/98/96, 50 → 49
  days; Count 99→98 baseline; Received 98+10=108; Jar 0.5 and 0.5+1=1.5 never
  reduced; PRN "—"; Mon/Wed/Fri 6 tabs from a Friday → 16 days; EOD; ml/mL;
  End Date before run-out → "—"; KL midnight boundary.
- **Parity test**: run `Stock.gs` + `CalendarEngine.gs` + `Medication.gs` in
  Node (`vm` context with stubs for `Utilities.formatDate`, `Session`, and a
  fixed `Date`, `TZ=Asia/Singapore`) against `computeStockStatus` for the same
  cases. Any change to either forecast must re-run this and match exactly.

After deployment (touches production — clean up test rows):
- Record a Stock Count / Stock Received on the Stock screen → row appears in
  `tbl_MedicationStock` (date cell) and `tbl_medication_stock` within seconds.
- Edit an order that has stock → `Order Changed` on the new RxOrderID.
- Discontinue an order → Sheet `Status` = Discontinued, stays Discontinued
  after the next heartbeat.
- AppSheet entry → Supabase within ~1 minute.
- Family Medication Reminder button → Loading.html → PDF with live values.
- Check Light / Dark / System themes on the Stock screen.

## 10. Open items / known gaps

- **BMN-0002 produced no family reminder** on the pre-change deployed script
  although donepezil (`c1f76bec`, Family, 10 days) should qualify. Diagnose in
  the Apps Script editor: `getResidentFamilyReminder("BMN-0002")` /
  `testLatestMedicationStock()`. Likely causes: the example rows are not in
  the `tbl_MedicationStock` tab of the spreadsheet `MedicationModuleID` points
  to, or BMN-0002 is missing from `tbl_ResidentList`.
- `≤ 14` (code) vs "less than 14 days" (template text) — unresolved.
- PRN Count items are never included in the family reminder (no forecast).
- Stock screen not yet verified in a browser after login.
- `Appsheet PDF Generation/` was added untracked; the 5 edited files have no
  git baseline of the pre-change version.
- Pre-existing duplicate globals in the PDF project (`writeFamilyReminderRows`,
  `testFamilyReminderList`, `testFamilyReminderReport`, `isPRNMedication`,
  `cleanupTemporaryPdfs`, …) — last file loaded wins. `isPRNMedication`
  copies are identical; the two `writeFamilyReminderRows` differ only by
  progress reporting. Check every definition before editing one.
- Manual Supabase dashboard edits to orders/stock are not mirrored to the
  Sheet.
