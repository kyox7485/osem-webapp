# Consumables — reference

Built 2026-09-26. Residents → **Consumables** (after Medication), with two
sub-tabs: **Inventory** (weekly count + history) and **Restock** (family
reminder PDF / internal pick-up list PDF). Modelled on Medication Stock
(`docs/medication-stock.md`), but simpler: counts only — no receiving, no
forecast.

## 1. Data flow

```
Inventory screen ─ inventory-actions.ts recordConsumableCountAction
  └─ medication-orders-script.ts createConsumableCounts
       └─ POST Apps Script "Sync to Supabase" {action:"consumableCountCreate", secret}
            └─ Code.gs doPost → Consumables.gs createConsumableCounts
                 ├─ append rows to tbl_ResidentConsumable        ← SOURCE OF TRUTH
                 └─ sync tbl_ConsumableMaster + those rows → Supabase (mirror)

AppSheet writes the same tabs directly
  └─ consumableHeartbeat (1 min, fingerprint) + syncAllConsumablesToSupabase (24 h)
```

- Spreadsheet `1_P_pl06r964aa8zHnDw5h8f6kg8JfQWviJ_41FctCHU`
  (`CONFIG.CONSUMABLE_SPREADSHEET_ID`). It has **no Apps Script of its own**;
  the existing "Sync to Supabase" project opens it by ID. Tab names are
  matched case-insensitively.
- **The webapp never writes `tbl_consumable_master` or
  `tbl_resident_consumables` directly.** Same `SHARED_SECRET` /
  `MEDICATION_ORDER_SCRIPT_*` env vars as medication.
- Sync errors go to the medication spreadsheet's `tbl_MedicationSyncLog` as
  `Consumable <RecordID>` (nothing extra is written into the consumables
  spreadsheet).

## 2. Data model

**`tbl_ConsumableMaster`** (catalogue, maintained in the Sheet only):
`ConsumableID | Consumable | Unit | MaxStock | RestockRequired` →
Supabase `tbl_consumable_master` (`consumable_id` unique). Readable by every
signed-in account. Never deleted from Supabase (history references it).
The item whose name is `Other` takes a free-text name + unit per row.

**`tbl_ResidentConsumable`** (append-only count log):
`RecordID | ResidentID | ConsumableID | OtherConsumable | OtherUnit | Supplier | CurrentStock | LastCount | CountedBy`
→ Supabase `tbl_resident_consumables` (`external_ref_id` = RecordID,
`branch_id` from the resident for RLS, same `branch_scope_*` policy as
medication stock). SQL: `migration/scripts/create_consumables_tables.sql`.

- One **item line** per resident = `ConsumableID` (+ lower-cased
  `OtherConsumable` for Other). Its current stock = the row with the latest
  `LastCount`. Supplier is per row (the latest row's supplier is current), so
  switching Family ↔ OSEM is recorded with a count.
- `OtherConsumable`/`OtherUnit` are ignored on non-Other rows (AppSheet leaves
  stray `OtherUnit` values).
- **ID padding**: the Sheet's AppSheet rows use `AMN-138` / `AMN-1`; Supabase
  uses `AMN-0138` / `AMN-0001`. `consNormalizeId_` pads to 4 digits before
  lookup. The webapp writes the Supabase (padded) form.
- `LastCount` is written as a real date cell `dd/MM/yyyy HH:mm:ss`
  (Asia/Kuala_Lumpur); legacy date-only values parse too.
- `CountedBy` must resolve to `tbl_staff.StaffID` or the row fails to sync
  (logged). Picker = ACTIVE staff of the resident's branch + HQ; never the
  logged-in account.

## 3. Rules (`webapp/src/lib/consumables.ts`, client-safe)

- **Restock** (`suggestRestock`): `RestockRequired = Yes` with `MaxStock` →
  suggest `ceil(MaxStock − current)`, needed when > 0 (legacy
  `consumable.gs` rule). Everything else → needed when count
  `≤ LOW_STOCK_THRESHOLD` (1), suggest 1.
- **Count due**: a line whose last count is ≥ `COUNT_DUE_DAYS` (7) old.
- Counts accept decimals (1.5 tins of milk powder).
- Lines with a blank supplier never appear on either PDF until recounted
  with a supplier.

## 4. Screens

- **Inventory** (`residents/consumables/inventory`, `?resident=`): resident
  picker with Prev/Next (guarded), Count Date/Time (back-dating allowed, not
  future) + Counted By, one row per line with Family/OSEM toggle and a
  "New count" input (blank = skip), History modal, "Add item" (catalogue items
  the resident has no line for, or Other + name + unit). One save = one Sheet
  call with one row per counted item. Wired into the dirty-form guard.
- **Restock** (`residents/consumables/restock`, `?branch=`): choose **Family
  Reminder** (one resident required) or **OSEM Pick-up List** (all residents
  or one). Session-only review: edit qty, reset, remove, add another item for
  the chosen resident. Prepared By required. Nothing is written anywhere.
  Parent passes `key={branch}` (Purchase-tab trap 3).
- PDFs: `POST /api/reports/consumable-restock` (`audience` Family|OSEM),
  documents `lib/pdf/documents/consumable-family-reminder-document.tsx`
  (bilingual EN/中文, CJK font) and `consumable-pickup-list-document.tsx`
  (English, grouped by resident, "charge to resident", Taken tick box,
  signature lines). Resident names / staff name re-read server-side; never
  stored.

## 5. Deployment checklist

1. **Supabase** — run `migration/scripts/create_consumables_tables.sql`
   (idempotent). Not applied as of 2026-09-26.
2. **Apps Script "Sync to Supabase"** — paste `Consumables.gs` (new),
   `Code.gs`, `Config.gs`; Deploy → Manage deployments → edit → **New
   version**. Run `testConsumableSync()` once (backfills master + all
   existing rows; check `tbl_MedicationSyncLog` for `Consumable …` rows),
   then `setupConsumableTriggers()`.
3. **Webapp** — deploy to Vercel.
4. Verify: record a count → rows in `tbl_ResidentConsumable` and
   `tbl_resident_consumables` within seconds; AppSheet edit → Supabase within
   ~1 min; both PDFs; Light/Dark/System. Clean up any test rows.

## 6. Known gaps

- The legacy PDF project (`Appsheet PDF Generation/consumable.gs`) reads the
  Sheet directly and is not linked from the webapp.
- Catalogue item names print in English only on the family PDF.
- Manual Supabase edits are not mirrored to the Sheet (same as medication).
