# HQ-ADMIN record Edit / Delete

An **ADMIN login based at an HQ-function branch** (`isHqAdmin()` in
`webapp/src/lib/current-user.ts`) gets Edit and Delete buttons on every
clinical, physiotherapy, medication and consumables record. Nobody else
sees them, and nobody else can use them:

- **Visibility** — `(app)/layout.tsx` wraps pages in
  `<AdminRecordProvider enabled={isHqAdmin(account)}>`;
  `<AdminRecordControls>` renders nothing otherwise.
- **Authority** — every Server Action in `(app)/admin-record-actions.ts`
  re-checks `isHqAdmin()` itself. Hiding the buttons is cosmetic; the
  server check is the real gate. A branch-level ADMIN (incl. DEMO `test`)
  does **not** qualify. DEMO isolation is enforced on the target row.

## Pieces

| File | Role |
|---|---|
| `lib/admin-records.ts` | Pure registry: record kinds, editable columns (a **whitelist**), option lists, KL-time helpers. Client-safe. |
| `app/(app)/admin-record-actions.ts` | `adminGetRecordAction` / `adminUpdateRecordAction` / `adminDeleteRecordAction` / `adminStaffOptionsAction`. |
| `components/admin-record-controls.tsx` | Buttons + edit dialog + delete confirmation. Loads the row from the server on open and submits **only changed fields**. Wired into the global dirty-form guard. |
| `lib/i18n/dict-admin.ts` | MS translations. |
| `google-apps-script/Sync to Supabase/AdminEdit.gs` | Sheet-first edit/delete. |

Usage: `<AdminRecordControls kind="progress_note" id={note.id} />`
(`compact` = icon-only for tables). New record type → add a kind to
`ADMIN_RECORDS` + `TABLES`, then drop the component into its list.

## Where the database is written

- **Plain Supabase records** (progress notes, nursing chart, vitals,
  observation/behaviour charts, wound sessions/photos, hospital referrals,
  physio assessments) are written with the **service-role client**, because
  `tbl_observation_charts` / `tbl_behaviour_charts` have INSERT/SELECT RLS
  policies only. Child rows cascade (nursing-chart meals/hygiene/
  elimination, behaviour episodes, physio assessment sections, wound
  photos). Wound photo Drive files are **trashed**, not destroyed.
- **Sheet-first records** go through Apps Script (Sheet first, then the
  normal targeted Supabase sync): `adminOrderDelete`, `adminStockUpdate`,
  `adminStockDelete`, `adminConsumableUpdate`, `adminConsumableDelete`.
  Medication order *edit* keeps using the existing revision flow (order
  form); only Delete is added. Deleting an order also deletes that exact
  revision's stock rows, and is refused while a later revision chains to it
  via `PreviousRxOrderID` (delete newest first).

## Deployment

The Sheet-first actions need `AdminEdit.gs` + the updated `Code.gs` pasted
into the **Sync to Supabase** Apps Script project and a **new deployment
version** (Deploy → Manage deployments → edit → New version). Until then
those buttons return "Apps Script request failed"; the plain-database
record types work immediately.

## Not covered

- Array lookup-id columns (nursing-chart activity/complaint ids, meals,
  hygiene) and physio exam/body-chart sections aren't editable in the
  dialog — delete and re-enter instead.
- Observation chart entries only appear (and so only get buttons) under
  **active** observation episodes; completed episodes don't list entries.
- `tbl_physio_progress_notes` has no UI in the webapp, so no buttons.
