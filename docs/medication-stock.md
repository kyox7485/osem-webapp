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
| Tab | `.../medication/medication-tabs.tsx` | Orders · Stock · Charts · Purchase |
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

**Entry Date/Time (back-dating)** — both forms have an editable Entry
Date/Time (default now) that becomes StockDate. The server calculates
everything **as of that time**: the Received base balance is the forecast
from the latest event at or before it (`loadLatestStockEvent(…, asOf)`), and
the Daily Usage / Days Remaining snapshots use that date. Rejected if in the
future (5 min clock tolerance) or before the order's Start Date. Later
events are **not** recalculated (each row is a snapshot); the form warns how
many later entries exist. The latest-by-StockDate event still drives the
screen, so a back-dated entry older than the newest one changes history
only.

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
Rows written by `migration/scripts/seed_demo_medication.py` (DEMO seed) have
0/0 hard-coded — they are not computed; real webapp entries are.

## 6. Forecast algorithm (both implementations)

Implemented twice and **must stay identical**:
`webapp/src/lib/medication-stock.ts` and
`Appsheet PDF Generation/Stock.gs` `getLiveStockForecast_`.

- Not forecast (Daily Usage / Days Remaining = "—"/`""`): Estimate unit, PRN,
  or stock unit ≠ order dose unit (case-insensitive, so `ml` = `mL`).
- Usage per dosing day = `Dose × number of Administration Times` (fallback
  by frequency: OD/OM/ON 1, BD 2, TDS 3, QID 4, EOD / Every 3 Days / Selected
  Days 1). This is what the forecast deducts on each **dosing day**.
- **Daily Usage** (shown on screen and stored in the sheet) = the **average
  per calendar day** = usage per dosing day × share of dosing days
  (EOD ½, Every 3 Days ⅓, N weekdays N/7). 1 Tablet EOD → `0.5`;
  1 Tablet Mon/Wed/Fri → `0.43`. Display only — never used to deduct.
- Dosing day = the chart's rule (`CalendarEngine.gs`
  `shouldPrepareMedicineOnDay`): not before Start Date, not after End Date,
  EOD / Every 3 Days counted from Start Date, Selected Days/Others by weekday.
- Current balance = latest event balance − usage × (dosing days strictly
  after the event date, up to and including today). Event day = recorded
  value. Floored at 0.
- Walk the schedule from tomorrow, deducting usage per dosing day, to find
  the **last dose the balance still covers** (`lastDoseDate`).
  **Days Remaining = balance ÷ Daily Usage (the displayed, 2-dp average),
  always rounded DOWN to the nearest 0.5 day** — 19 ÷ 0.43 = 44.19 → 44;
  44.7 → 44.5; 9 ÷ 0.5 → 18. 0 when the walk finds no dose left after today.
  Because it's an average, the last dose date can be a day or two past
  today + Days Remaining (e.g. 44 days vs last dose Mon 09/11 = 45 days out).
- If End Date comes first → Days Remaining "—" (supply outlasts the order;
  the screen shows "Enough until order ends" + the end date).
- The Stock screen shows the badge ("18 days left") with "Last dose
  Tue 13/10/2026" under it. The PDF project computes only Days Remaining.
- Calendar days are Kuala Lumpur dates (webapp) / script timezone
  Asia/Singapore (+08:00, identical) in Apps Script.

`getLatestMedicationStock` (PDF project) replaces each latest row's
`Balance` / `Daily Usage` / `Days Remaining` with the live values
(`RecordedBalance` keeps the sheet value), so **every** PDF report —
`family`, `familyrequest`, `purchase`, `medsummary` — uses today's numbers.
Consumers treat `Days Remaining === ""` as "not forecastable", never 0.

## 7. Family Medication Reminder PDF

- **No longer linked from the webapp** (replaced by 7b). Was: Stock screen
  button that opened the chart script URL
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

### 7b. "Family Medicine Reminder (PDF)" — Next.js PDF (current)

The **only** reminder button on the Stock screen since it replaced the Apps
Script button above (that flow still works via its URL but has no button).

- Route `webapp/src/app/api/reports/family-reminder/route.tsx`
  (`?resident=<tbl_residents.id>`), document
  `webapp/src/lib/pdf/documents/family-reminder-document.tsx`, standard
  `ReportPage` header (logo + branch name/address/tel).
- **Never stored**: rendered in memory with `renderToBuffer` and streamed
  inline with `Cache-Control: no-store` — no file on the server, no Drive
  copy. One-off printable PDF.
- Same access rules as the other reports + DEMO exclusion.
- Items: Active + `supplied_by = 'Family'`, live `computeStockStatus`
  (identical numbers to the Stock screen). Grouping:
  - **Countable → Restock Needed** (red block): forecast Days Remaining
    `< LOW_STOCK_DAYS` (14), incl. out of stock. Sorted by days.
  - **Countable → Sufficient Supply**: ≥ 14 days, or "Enough until order
    ends". (Unlike the Apps Script flow, these ARE listed.)
  - **Uncountable → Current Quantity**: Estimate units, PRN, never recorded
    ("Not recorded yet"), and Count stock in a unit ≠ the dose unit. Always
    listed.
- Header: standard shell, no subtitle; identity strip = Resident + Generated
  On (no Resident ID). Footnote states the date of the newest stock entry
  behind any countable balance (omitted when there is none).
- Bilingual English / 中文. Helvetica has no Chinese glyphs, so Chinese Text
  nodes use the bundled **Noto Sans SC** (`webapp/public/fonts/`, SIL OFL,
  from Google Fonts, ~10.5 MB each for Regular/Bold), registered by
  `lib/pdf/cjk-font.ts` `registerCjkFont()`. Only glyphs used are embedded,
  so a PDF is ~90 KB. Any new Chinese string must be in a Text node styled
  with `CJK_FONT`, never mixed into a Helvetica Text node.
- Grouping/forecast logic lives in `webapp/src/lib/medication-stock-report.ts`
  `buildStockReport(supabase, residentId, suppliedBy, now)`, shared with 7c.

### 7c. "OSEM Medicine Purchase List (PDF)" — internal

Menu item next to 7b. Same route pattern, access rules, never-stored rendering
and grouping as 7b, but for `supplied_by = 'OSEM'`, and English-only with
no family notice (internal use: what OSEM must buy for the resident).

- Route `webapp/src/app/api/reports/osem-purchase-list/route.tsx`, document
  `webapp/src/lib/pdf/documents/osem-purchase-list-document.tsx`, title
  "Medication Purchase List".

### 7d. "Stock Summary" — every medicine, one table

Route `webapp/src/app/api/reports/stock-summary/route.tsx`, document
`webapp/src/lib/pdf/documents/stock-summary-document.tsx`, builder
`buildStockSummary` in `lib/medication-stock-report.ts`. All active orders
(any supplier), ordered like the Stock screen (regular first, PRN last).
Columns: Medicine (+ dose · frequency · dosing days), Balance, Daily Usage,
Days Remaining (cell tinted red = out, amber = `< LOW_STOCK_DAYS`, green =
≥ that or enough until order ends — same thresholds as the screen badge;
the text carries the meaning too, for B/W prints), Supplied By, Last Count
(latest **`Stock Count`** entry only — a `Stock Received` is not a count;
"Never counted" if none).

### 7e. "Purchase" tab — branch-wide restock order sheet

**One PDF per branch**, not per resident. Management gets a single sheet for
the whole branch; it is *not* a replacement for 7c, which stays as the
per-resident view.

- Route `webapp/src/app/(app)/residents/medication/purchase/` (after Charts),
  API `webapp/src/app/api/reports/purchase-list/route.tsx`, document
  `webapp/src/lib/pdf/documents/purchase-list-document.tsx`.
- Builder `webapp/src/lib/medication-purchase.ts` (server-only). The pure
  rules and types — `suggestOrderQty`, `needsRestock`, `groupPurchaseRows`,
  `summarize` — live in **`medication-purchase-core.ts`**, which is
  client-safe, so the review screen never imports the server module (the
  Turbopack footgun in CLAUDE.md). The server file re-exports them.
- Branch chosen with **`?branch=`** (like Stock's `?resident=`), so the tab is
  bookmarkable. Branch scoping + DEMO exclusion copied from `charts/page.tsx`.

**Selection** (active, `supplied_by = 'OSEM'`, `external_ref_id` not null):
- Countable → `daysRemaining < LOW_STOCK_DAYS`, out of stock included.
- Uncountable → balance `<= 0.5`.
- Never-recorded orders are **excluded** (no quantity to reorder against), as
  is anything whose supply outlasts the order's End Date.

**Suggested quantity** = `30 × dailyUsage`, rounded up to a whole unit. The
current balance is deliberately **not** deducted — it is the buffer stock, so
we order a full cover period on top of it. Uncountable rows suggest `1`.

**Layout** — grouped by resident (name order, one heading per resident with
its own item count and subtotal), every medicine on its **own line** under
that resident, and a grand total across the branch. Every line, including
manually added ones, **must belong to exactly one resident** — there is no
"unassigned" bucket, so the add-item control requires a resident first and
the route rejects a row without one.

**Review step (session-only)** — the user can edit Balance and Qty per row,
reset a row or the whole list to the calculated values, and add an item from
the branch's own stock medicines or as free text ("Other…"). Editing here
**never writes to `tbl_medication_stock` or any other table**; the draft is
`useState` only and is discarded on navigation (the app-wide dirty-form guard
warns first, and the branch switch goes through `navigateTo`).

**PDF hand-off** — unlike every other report route, this one is **POSTed**: the
reviewed rows are sent to the route, which re-reads resident names from the DB
(so the grouping can't be spoofed) and renders exactly what was approved. It
is still rendered in memory and streamed, never stored.

**Three traps this tab already hit** (all fixed 2026-09-26; keep them in mind
before "simplifying" this code):

1. **Never embed `tbl_residents` with a bare `!inner(...)`.** PostgREST has to
   auto-detect the FK, and when it can't the *whole* query errors — which
   looked exactly like "no medicine needs restocking". Resident names are
   fetched in a second query and joined in memory. Every other embed in the
   codebase carries an explicit hint (`tbl_residents!resident_id(...)`,
   `tbl_staff!created_by(...)`); an inner join also compounds
   `tbl_residents`' RLS on top of the orders' own RLS.
2. **Never let a failed query render as an empty list.** `buildPurchaseList`
   returns `{ error }` and the page passes `loadError` through to a visible
   error panel. A silent `?? []` here hides real outages as "nothing to do".
3. **A `?branch=` switch does not remount the client component.** `useState`'s
   initialiser only runs on first mount, so switching branch kept showing the
   *previous* branch's rows while the URL said otherwise. The parent passes
   `key={selectedBranch.id}` to force a remount per branch — don't "optimise"
   that away. Branch switching goes through `useNavPush()` so the app-wide
   loading overlay shows (a bare `router.push` gives no feedback), wrapped in
   `guardedAction` so a dirty review is confirmed before being discarded.

### Stock screen: "Print PDF" menu

The three PDFs sit behind one **Print PDF ▾** menu button (in
`stock-module.tsx`, `PrintPdfMenu`) rather than three long-labelled
buttons: each item has a short title + one-line description, 44px targets,
full-width on phones, Escape/outside-click closes, arrow keys move focus.

**Nothing to generate (all three PDFs):** when the resident has no active order
for that supplier, the Stock screen shows an info notice instead of opening
a tab (checked client-side from each row's `suppliedBy`). If the route is
opened anyway (stale page, direct URL) it returns a small translated HTML
message via `nothingToGenerateResponse`, not an empty PDF.

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
