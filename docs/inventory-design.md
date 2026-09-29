# General Inventory module: design (rev 3)

Status: **Phase 1 (database + RLS + core engine) written as `schema/007`–`011` and tested locally on PGlite. Nothing is applied to production.**
- **Rev 1:** 2026-09-28.
- **Rev 2:** 2026-09-28, answering the POS/inventory audit in `docs/inventory-design-audit.md` (F1–F30).
- **Rev 3:** 2026-09-29, recording the business owner's answers to §11 (§0.1, D-134–D-148) and the Phase 1 implementation (§13). Where rev 3 and older text disagree, **§0.1 and the D-134+ decisions win**.
- **Rev 3.1:** 2026-09-29, fixes for the Phase 1 implementation audit (`docs/inventory-design-audit.md` P1-1…P1-20): D-149–D-155, §13.5 (finding → fix), §13.6 (go-live gate), §13.7 (apply checklist).
- **Rev 3.2:** 2026-09-29, fix-verification findings V-1…V-4: every migration file is safe on its own (D-156), the FOC valuation policy is an owner question (Q-33).

Sources: a read of the repo, read-only queries against the live Supabase project (`kopmxzdzbvjcqaejviyh`), and a read-only profile of the legacy Access backend (`access/alma/OSEM MS_be.accdb`).

Decisions are numbered `D-n`. Numbers are stable: new decisions are appended from D-100 upward, and a replaced decision is kept and marked **SUPERSEDED by D-x**. The full register is in Appendix A. Open questions (`Q-n`) with recommended defaults are in §11.

Conventions:
- "Account" means a `tbl_user_accounts` login, which carries scope and rights.
- "Staff" means a `tbl_staff` person, used for attribution only.
- "Base qty" is the quantity expressed in the product's base UOM.
- KL = `Asia/Kuala_Lumpur`. The DB `TimeZone` is `UTC`.
- The single KL "today" is `fn_inv_today()` (D-129).

---

## 0. Audit resolution

Status key:
- **Adopted**: taken as proposed.
- **Adopted-modified**: the problem is fixed, but by a different mechanism (the reason is noted).
- **Deferred**: out of scope for this doc or for V1, with the reason.
- **Rejected**: not taken, with the reason. No whole finding was rejected; the parts of findings not taken are called out in the notes.

| ID | Sev | Status | Where | Note |
|---|---|---|---|---|
| F1 | CRIT | Adopted | D-102, §3.1, §8.3–8.6 | Org-wide master data can be changed only by an HQ ADMIN that isn't a demo account (`fn_inv_is_hq_admin`). `owner_branch_id` gives the demo its own products and suppliers. The demo account gets read-only access to the global catalogue. There's a test for this. |
| F2 | HIGH | Adopted-modified | D-103, §4.4, §5.7 | A correction is netted per pool and applied once, and the negative-stock check runs on the net result. For a cost-only change, the part attributable to consumed units goes to `revaluation_value` on the correcting line. **Not taken:** a separate `COST_CORRECTION` txn type (not needed; `qty_base <> 0` stays). |
| F3 | HIGH | Adopted | D-60, D-104, §3.6 | A `START` step records `snapshot_line_id` (posting order) while the location row is locked. Expected qty is calculated as of that line, and the sheet has a "posted since start" column. Counts are blind. An optional STORE freeze is on by default (Q-30). The ambiguous `snapshot_at` is replaced by a display-only `started_at`. |
| F4 | HIGH | Adopted-modified | D-105 (supersedes D-41), §3.6, §4.2 | Receipt doc types are DO, INVOICE and CASH_BILL. Header totals cover discount, tax, charges and rounding, and landed cost is allocated pro-rata. Lines take `foc_qty`, provisional cost on a DO, "attach invoice later", and normalised duplicate keys. **Changed:** a mismatch over RM 1 doesn't block receiving at the door. The receipt is flagged UNRECONCILED and blocks the period lock until a MODERATOR acknowledges it. |
| F5 | HIGH | Adopted | D-106, §3.1 | `base_uom_id` can't change once lines exist. `factor_to_base` can't change once the product+UOM is used anywhere. The base UOM is the smallest issuable unit (factor ≥ 1). A wrong-base procedure is documented. |
| F6 | HIGH | Adopted | D-107, §6 | Outflows from an existing Transit bucket are authorised by the bucket's branch, not the resident's current branch. The guard on `tbl_residents` branch changes is designed in, pending owner approval (Q-12). The design still works without it. |
| F7 | HIGH | Adopted-modified | D-108, §8.4, §7.3 | TRANSIT_RELEASE is Head Nurse or above. Write-offs above a per-branch threshold become approval requests. A month-end exception review is required before lock. Postings from a shared login are labelled. Individual Head Nurse logins are a go-live prerequisite (Q-1). |
| F8 | HIGH | Adopted (business decision) | D-3, Q-27 | System of record per class of goods. The default is designed so that no product can be billed in two systems, which is also a go-live checklist item. |
| F9 | HIGH | Adopted | D-109, §9.6, §4.7 | A global scanner-burst detector, a qty length cap, and sanity guards returning `SANITY_CONFIRM`. The RPC enforces hard caps. Cost is shown per purchase UOM and per base UOM. |
| F10 | MED | Adopted-modified | D-110 (supersedes D-16), §3.4, §4.5 | New `tbl_inv_idempotency` table storing a request hash. Child txns share the request key. **Changed:** only successful results are stored, and confirmation flags are excluded from the hash, so the negative-stock re-submit still works. |
| F11 | MED | Adopted-modified | D-111 (supersedes D-17 ordering), §4.6 | Each RPC builds a lock plan and locks everything in one canonical order. **Changed:** the two-session test is a Node script against the local stack, because `dblink` isn't installed. |
| F12 | MED | Adopted-modified | D-112, §3.4, §4.3 | Ids are pre-allocated with `nextval` (identity `generated by default`) and circular FKs are deferred, so no UPDATE after insert is needed. The document status UPDATEs are an explicit whitelist. |
| F13 | MED | Adopted-modified | D-31/D-32/D-33 (defined), D-113, §3.6 | Branch receipts are append-only. **Changed:** receiving is all-or-nothing in V1 (the auditor's simplification). A shortage or overage becomes an adjustment request at the destination, linked to the transfer, so every value stays in the ledger. **Not taken:** `TRANSFER_LOSS` at the source (Q-3 asks which branch bears the loss). |
| F14 | MED | Adopted | D-114, §3.6, §8.6, §8.8 | Every child table has `branch_id`. Policy helpers are `inv_*` and granted to `authenticated`. Idempotency columns were removed from documents (D-110). The roles policy uses the HQ-admin helper. |
| F15 | MED | Adopted | D-115, §3.4, §8.6 | Policies use `branch_id = any ((select inv_accessible_branch_ids()))`. `txn_date` and `txn_type` are denormalised onto lines with report indexes. Reports are capped. |
| F16 | MED | Adopted-modified | D-116, §3.3, §7.2 | A closing snapshot is taken at lock, computed by `txn_date ≤ end of month`. Lock verifies the caches and refuses if they've drifted, and requires the previous month to be locked. There's a postgres-only cache rebuild. |
| F17 | MED | Adopted | D-117 (supersedes §4.2 row 1 rule) | Opening balance is allowed only in a window around go-live, dated on go-live, for any location while the pool holds only opening lines. |
| F18 | MED | Adopted | D-118, §5.3 | `PENDING_COST` (W* = 0) replaces the `NO_COST_BASIS` rejection for outflows, and is listed on the exception review. |
| F19 | MED | Adopted | D-101, D-119, §3.9 | Default max is split by STORE/FLOOR. Suggestions are shown in the purchase UOM. Lines can be closed short with a `CLOSED` status. There's a Floor top-up suggestion. Subtracting open requests is pending Q-18. |
| F20 | MED | Adopted | D-120 | Optional `batch_no`/`expiry_date` on receipt lines, with a near-expiry report. Lot-level stock is deferred to V2 (Q-29). |
| F21 | MED | Adopted-modified | D-121 (supersedes D-71 block rule), §7.1 | A missing price gives PRICE_PENDING. A MODERATOR prices it with a `PRICING` charge row, which blocks the lock until done. `is_chargeable = false` blocks RESIDENT issues. **Changed:** a dedicated `PRICING` kind rather than `MANUAL_ADJUSTMENT`, so the pending state is derivable. |
| F22 | MED | Adopted-modified | D-122, §3.7, §7.3 | A resident billing-code side table and export batches. **Changed:** an append-only `tbl_inv_charge_export_items` join table instead of a fill-once `export_batch_id` on charges, which stay fully immutable. The Bukku template is still to be confirmed (Q-25). |
| F23 | MED | Adopted | D-61, D-123 | The counter vs. adjustment-requester check warns, and the sheet scope is defined. D-60 and D-61 are written out. |
| F24 | MED | Adopted-modified | D-124, §6 | Release needs Head Nurse+ with fixed reason codes, and reversing a receipt cascades to its allocation. **Changed:** the 7-day re-allocation cooldown is *detected* (on the exception list) rather than blocked. Fungible stock can't be traced reliably to "the released units". The charging model is Q-28. |
| F25 | LOW | Adopted | D-125, §8.8 | Revokes cover views and sequences, and the read-back checks relkinds `r`, `v` and `S`. |
| F26 | LOW | Adopted | D-126, §8.5 | `search_path = ''`, no calls to `auth_*()`, `session_user` in the purge guard, payload validation, and the branch is always derived server-side. |
| F27 | LOW | Adopted | D-127, §3.2 | A Head Nurse grant is bound to a branch and is valid only while the account's branch matches. |
| F28 | LOW | Adopted-modified | D-128, §3.1, §9.6 | Barcodes use a partial unique index, and EAN/UPC codes are normalised. **Changed:** a Head Nurse can *attach* a new barcode to an existing product, but reassigning or deactivating one is HQ ADMIN only (F1). |
| F29 | LOW | Adopted | D-129 | `fn_inv_today()`. The counter year follows the KL year of `posted_at`. |
| F30 | LOW | Adopted | Appendix A, D-130–D-133, §8.4 | Every cited D-n is now defined. The D-70/D-72 number collisions are resolved (D-100/D-101). One verify-function name. Reversal and correction date rules. Who may cancel a dispatch. Returns from an OSEM-expense issue. The demo key rule. Service charges are Q-32. |
| §C | CRIT (org) | Deferred | Q-23 | RLS is off on `tbl_audit_log` and `tbl_nursing_chart_elimination_episodes`. Both confirmed. Out of scope here and needs a separate urgent task. |
| F1 aside | n/a | Deferred | Q-23 | The demo password is in plain text in `docs/database.md`. Moving it is a separate task; this doc may only edit itself. |
| §B note 1 | n/a | Adopted | D-113 | No partial branch receipts in V1. |
| §B note 2 | n/a | Adopted | D-58 | The scaled-bigint TS mirror of the WAC maths is dropped. The DB is authoritative and the UI only formats. |

**Counts:** 18 Adopted, 12 Adopted-modified, 0 Rejected (whole findings), 2 Deferred (§C and the demo password), plus 2 adopted scope notes.

### 0.1 Owner answers (rev 3): what changed

The owner answered §11 on 2026-09-29. The effect on the audit rows above:

| Row | Effect of the owner's answers |
|---|---|
| F4 | **Narrowed by D-138.** Receipts need the supplier invoice (INVOICE or CASH_BILL, number + date mandatory). No DO receipts, no PROVISIONAL cost, no attach-invoice-later, no finalise-cost RPC. Landed-cost allocation and FOC stay. **No reconciliation handling at all** (no UNRECONCILED status, no MODERATOR acknowledgement, no lock blocker); the UI may later show computed vs. paper total for information only. |
| F7 | **Changed by D-134.** No individual Head Nurse logins in V1, so they are **not** a go-live prerequisite. Head-Nurse-tier actions are allowed to the branch's shared login, attributed to a senior staff member picked from `tbl_staff`. The write-off threshold, fixed release reasons and month-end exception review stay. |
| F8 | **Resolved by D-136.** Inventory is the only stock and billing system for goods OSEM buys. Medication Stock and Consumables are reminder tools; no integration, no `goods_class`. |
| F14 (roles table), F27 | **Superseded by D-134.** No `tbl_inv_account_roles` in V1. |
| F20 | **Superseded by D-139.** No batch/expiry columns in V1. |
| F24 | Q-28 confirmed: Transit purchases are charged at issue, at the catalogue price. Release/cascade rules stay. |
| F28 | "HN attaches barcode" becomes "branch login, senior staff attributed" (D-134). |
| F30 (Service) | **Resolved by D-137.** Service products are in scope as non-stock items. |
| Scope | **D-135.** Only NUR branches use Inventory. PHY branches have no access at all; HQ has cross-branch review/management; DEMO stays pinned. |

---

### 0.2 Owner answers, round 2 (2026-09-29) — these win over anything older

- **Applied to live** 2026-09-29: `schema/007`–`013` in one transaction (§13.7), DEMO the only enabled branch. Real branches stay gated by §13.6.
- **D-148 confirmed:** the shared branch login may read resident charges in its own branch.
- **D-158 (supersedes D-108, D-152, Q-7):** no write-off limit and no approval for uncosted items. `fn_inv_writeoff_problem()` always returns null (kept as a hook); `tbl_inv_branch_settings.writeoff_threshold` is unused.
- **Q-12 dropped:** no guard on resident branch changes.
- **Owner UI requests (2026-09-29):**
  - *Built now:* Transfers → one "Internal Transfer" tab (Store / Floor Stock / Transit as three equal locations; Store↔Floor, allocate to Transit and release from Transit all go through it). Operational forms (receive, issue, transfer, returns, write-off) find products **only by barcode or exact SKU — no name search** (similar names cause wrong-product errors); setup pages keep name search.
  - *Deferred to Phase 7 (reports), recorded here as owner requirements:* the **Stock** and **Transactions** pages need **PDF export** of the filtered view. **Transactions** filters: product by barcode or name, date range, storage location (Store / Floor Stock / Transit), transaction type. **Stock** filters: category, product by name or barcode, product status (active / inactive), supplier (product's default supplier).
- **Phase 3 applied to live** 2026-09-29: `014` + `015` + re-run `013` in one transaction. DEMO `opening_window_days` set to 31 (opening balance testable until ~2026-10-02).
- **D-157 (answers Q-33, supersedes D-149):** any inflow into a pool at Q ≤ 0 writes off the negative value and takes the incoming unit cost as the new WAC. Owner example: −10 @ RM 10 then +10 @ RM 11 → WAC RM 11. A FOC inflow therefore sets WAC to 0; an unknown WAC (PENDING_COST) stays unknown.

## 1. Existing inventory-related architecture

### 1.1 Three live stock-like features. None of them is inventory, and none gets reused (D-1)

| Feature | Where | How it works | Why the new module doesn't build on it |
|---|---|---|---|
| Medication Stock | `webapp/src/app/(app)/residents/medication/stock/*`, `lib/medication-stock*.ts`, `migration/scripts/create_medication_stock_table.sql`, `docs/medication-stock.md` | Per-resident **forecast** from medication orders. The Google Sheet `tbl_MedicationStock` is the source of truth, mirrored to `tbl_medication_stock` (29 rows). | Sheet-first, has no cost or locations, and is a forecast rather than a ledger. |
| Consumables | `(app)/residents/consumables/{inventory,restock}`, `lib/consumables*.ts`, `create_consumables_tables.sql`, `docs/consumables.md` | Weekly per-resident **count log**. The Sheet is the source of truth, mirrored to `tbl_consumable_master` (8) and `tbl_resident_consumables` (27). | Sheet-first and count-only. |
| Medication Purchase | `(app)/residents/medication/purchase`, `lib/medication-purchase{,-core}.ts`, `api/reports/purchase-list` | A session-only review that produces a PDF. **Nothing is written.** | It's a PDF generator. |

Which physical goods each system owns is decision **D-3** (§6.5, Q-27). The two existing Sheet-based modules stay unchanged in V1.

Patterns worth reusing:
- The server-action shape: `getCurrentUser()`, then the scope check, then the DEMO check, then `revalidatePath` (`residents/consumables/inventory/inventory-actions.ts`).
- `useTransition` with `useDirtyForm`/`markDirty`/`markClean`, and `guardedAction(() => push(href))` (`inventory-module.tsx`, `medication-tabs.tsx`).
- `key={selected}` to remount on a `?branch=` switch.
- A load error is never rendered as an empty list.
- Staff pickers take ACTIVE staff of the branch plus HQ, re-read server-side (`lib/consumables-server.ts`).
- Pure rules in `*-core.ts`, loaders in `*-server.ts`.

### 1.2 A dormant inventory schema already exists in `schema/001_init.sql` (§9–10, 13–14)

All of it is live but **empty**, and the webapp doesn't reference it (verified 2026-09-28):
- tables: `tbl_products` 0, `tbl_suppliers` 0, `tbl_storage_locations` 0, `tbl_product_stock` 0, `tbl_stock_movements` 0, `tbl_stock_transfers` 0, `tbl_stock_requests`/`_details` 0, `tbl_charging_summary` 0, `tbl_uoms` **10**, `tbl_product_categories` **5**
- enums: `stock_movement_type`, `stock_transfer_status`, `stock_request_status`
- views: `v_stock_balance`, `v_product_branch_stock`, `v_pending_transfers`
- triggers: `trg_apply_stock_movement`, `trg_transfer_*`, `trg_charging_deduct_stock`, `trg_audit_tbl_*`

**D-2: don't reuse or alter these objects.** They have no WAC, no header/lines, no idempotency and no immutability. Transfers are driven by UPDATE triggers, charges silently deduct stock as "sales", and the balance table can be written by users. Because they're empty, a separately approved drop later is safe (Q-15). New objects use the `tbl_inv_` / `fn_inv_` / `inv_` / `v_inv_` prefixes.

### 1.3 Legacy Access backend: business-rule reference only (read-only `pyodbc`)

| Access table | Rows | Rule learned |
|---|---|---|
| `tbl_ProductList` | 502 | One barcode per product (0 blanks, 0 duplicates). **Cost ≠ charge price** (SellingPrice > UnitPrice for 473). Units include `STRIP`, `JOB`, `PAIR`. Categories: Others 255, Consumables 130, Medicine 65, Dressing 37, **Service 15 (non-stock, unit JOB)** |
| `tbl_ProductStock` | 509 | Storage is one of Store, Floor Stock, Transit. **Max qty is per product per storage.** 5 negative balances |
| `tbl_StockMovement` | 6,810 | `Sales[: Floor Stock/Store/Transit]`, `Receive at Store/Floor Stock/Transit`, `Stock Take: …`. Legacy received straight into Transit/Floor, and stock-take overwrote stock. 117 negative and 9 fractional quantities. **Of 956 receive rows, 118 (12%) have zero or no unit price** (FOC or unpriced) **and 115 (12%) have no invoice number** (the placeholder `N/A` also appears) |
| `tbl_StockTransfer` | 550 | Store→Floor 346. Inter-branch moves go to bagan/PERMAI/BM/BG, and **2 go to physio** |
| `tbl_RequestDetail` | 2,365 | Request = max − current **per storage**. Pseudo-suppliers appear (`From: BAGAN`, `patient discharge`, `NIL`) |
| `tbl_ChargingSummary` | 7,021 | About 585 charges a month at ALMA. 185 residents. 1,490 rows have no unit |

What this means: the Store/Floor/Transit model is confirmed; the legacy direct-to-Transit receiving is replaced by *receive & allocate*; counts must never overwrite stock; delivery without an invoice and FOC stock are real (D-105); there's **no history import**, only an opening balance.

### 1.4 Auth, scope, RLS and platform facts (verified live)

- `lib/current-user.ts` provides `getCurrentUser()` (zero args), `isAdmin`, `isHqAdmin` (ADMIN at an HQ-function branch) and `canAccessAllBranches` (ADMIN or Function HQ/PHY). The SQL mirrors are `auth_is_all_branch_account()`/`auth_is_demo_account()`.
- The live `auth_*()` helpers are all SECURITY DEFINER with **no `search_path`**, and none checks `status = 'ACTIVE'`. Inventory doesn't call them (D-126).
- Branches: 1 `AMN` Alma NUR · 2 `AMP` physio PHY · 3 `BMN` Kota Permai NUR · 4 `BGN` Bagan NUR · 5 `HQ` HQ · 6 `DEMO` NUR `is_demo=true`.
- **Logins:** each NUR branch and AMP has exactly **one** active STAFF login, and it's shared. HQ has 2 ADMIN and 2 MODERATOR. DEMO has 1 ADMIN (`test`), whose password appears in `docs/database.md`.
- `tbl_positions` has Head Nurse / Assist. Head Nurse / Nursing Director. Active holders: AMN 1 HN; BMN 1 HN + 1 AHN; BGN 1 HN + 1 AHN; HQ 1 ND. All have `tbl_staff.role = MODERATOR`.
- `pg_default_acl`: new `public` tables, **views and sequences** grant ALL (rwU) to `anon`/`authenticated`, and new functions grant EXECUTE to `anon`.
- Statement timeouts: `authenticated` 8s, `anon` 3s.
- Extensions: `pgcrypto`, `uuid-ossp`, `pg_trgm`. **No `pg_cron`, no `dblink`.** Postgres 17.6.
- `tbl_audit_log` and `tbl_nursing_chart_elimination_episodes` have RLS **disabled** with full `anon` grants (see Q-23). `fn_audit_trigger` isn't SECURITY DEFINER.
- `webapp/src` has no `.rpc(` usage yet. The service-role client is used only in `accounts/actions.ts` and `admin-record-actions.ts`.
- `residents/actions.ts` writes `branch_id` from the form with no guard (F6). `accounts/actions.ts` `updateAccount` can move a login to another branch (F27).

---

## 2. Conflicts: names, routes, nav slots, i18n

| Kind | Existing | Decision |
|---|---|---|
| Tables/enums/views/functions | the §1.2 objects | Every new name is prefixed `tbl_inv_*`, `fn_inv_*` (internal), `inv_*` (RPC and policy helpers) or `v_inv_*`. Vocabularies are `text` + CHECK (D-10). |
| Route | nothing under `/inventory` | `/inventory/**` is free. |
| Route (confusable) | `/residents/consumables/inventory`, a sub-tab labelled "Inventory" | Left alone in V1. Relabelling is Q-22. |
| Nav | `layout.tsx` items (Residents, Clinical, Physiotherapy, Staff, External Links, Accounts), with icons from the `ICONS` map in `components/sidebar.tsx` | Insert Inventory after Physiotherapy, add `Package` to `ICONS`, and use the orange tint (unused). |
| API | `/api/reports/*` (PDF) | `/api/inventory/export/[report]` (CSV). |
| i18n | `dict-consumables.ts` already has `Inventory: "Inventori"`, `Restock`, `Stock balance`; `dict-medication.ts` has `Stock`, `Purchase`, `Supplier` | New `dict-inventory.ts`. Never redefine an existing key with different Malay text (`check:i18n` errors on that). |
| "Transit" | legacy category Others shows as "Transit Items" | In V1 Transit is a **location kind**. A branch shipment is "**Awaiting receipt**", never "in transit" (D-33). |
| "Sale" | legacy `SaleID`, `SaleDate`, `Sales:` | Never used. The words are **Issue** and **Charge**. |
| Demo detection | app `getDemoBranchIds()` keys on `BranchCode = 'DEMO'`; SQL keys on `tbl_branches.is_demo` | D-133: SQL uses `is_demo`, and pages use the existing `getDemoBranchIds()` (CLAUDE.md pattern). The Phase 1 migration **asserts the two sets are equal** and aborts otherwise. |

---

## 3. Proposed schema (DDL sketch; not a migration)

Common rules:
- Quantities `numeric(18,4)`; unit cost and WAC `numeric(18,6)`; cost values `numeric(18,4)`; resident money `numeric(12,2)` (unit price `numeric(12,4)`).
- `created_at timestamptz not null default now()` on every table.
- **Every** branch-scoped table, child tables included, carries `branch_id`, filled by the engine (D-114).
- Tables the engine writes use `bigint generated by default as identity`, so ids can be pre-allocated with `nextval(pg_get_serial_sequence(…))`. Clients can never INSERT (D-112).
- Circular FKs are `deferrable initially deferred`.
- Forward references in these sketches (e.g. receipts → stock requests) are resolved in the migration by creating tables first and adding those FKs with `alter table … add constraint` afterwards.

### 3.1 Master data (org-wide; demo-owned rows allowed, D-102)

> **Rev 3:** §3 is the rev-2 sketch. The DDL actually written differs as listed in §13.2 (no roles table, no `goods_class`, no batch/expiry, invoice-only receipts, Service flags).

```sql
create table tbl_inv_uoms (
  id bigint generated by default as identity primary key,
  code text not null unique check (code ~ '^[A-Z0-9_]{1,12}$'),
  name text not null, name_ms text,
  allow_fraction boolean not null default false,
  is_active boolean not null default true
);

create table tbl_inv_categories (
  id bigint generated by default as identity primary key,
  code text not null unique check (code ~ '^[A-Z0-9_]{1,24}$'),
  name text not null, name_ms text,
  sort_order int not null default 0, is_active boolean not null default true
);

create table tbl_inv_suppliers (
  id bigint generated by default as identity primary key,
  owner_branch_id bigint references tbl_branches("BranchID"),   -- NULL = global; non-null only for demo branches (trigger)
  name text not null check (length(btrim(name)) between 1 and 120),
  name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  contact_person text, phone text, email text, address text, notes text,
  is_active boolean not null default true,
  created_by_account bigint not null references tbl_user_accounts(id),
  updated_at timestamptz not null default now(), updated_by_account bigint references tbl_user_accounts(id)
);
create unique index uq_inv_suppliers_name on tbl_inv_suppliers(coalesce(owner_branch_id, 0), name_key);

create table tbl_inv_products (
  id bigint generated by default as identity primary key,
  owner_branch_id bigint references tbl_branches("BranchID"),   -- NULL = global; demo branches only (D-102)
  sku text not null check (sku ~ '^[A-Za-z0-9._-]{1,40}$'),
  name text not null check (length(btrim(name)) between 1 and 160),
  description text,
  category_id bigint not null references tbl_inv_categories(id),
  goods_class text not null check (goods_class in                   -- D-3 system-of-record guard
    ('OSEM_MEDICINE','OSEM_CONSUMABLE','DRESSING','NUTRITION','GENERAL')),
  base_uom_id bigint not null references tbl_inv_uoms(id),          -- immutable once used (D-106)
  purchase_uom_id bigint not null references tbl_inv_uoms(id),
  default_supplier_id bigint references tbl_inv_suppliers(id),
  standard_unit_cost numeric(18,6) check (standard_unit_cost >= 0), -- per base; fallback only (§5.3)
  is_chargeable boolean not null default true,                      -- false: RESIDENT issue blocked (D-121)
  charge_price numeric(12,4) check (charge_price >= 0),             -- per base; NULL + chargeable → PRICE_PENDING
  default_max_store numeric(18,4) check (default_max_store >= 0),   -- D-101 (split per F19)
  default_max_floor numeric(18,4) check (default_max_floor >= 0),
  is_active boolean not null default true,
  created_by_account bigint not null references tbl_user_accounts(id),
  updated_at timestamptz not null default now(), updated_by_account bigint references tbl_user_accounts(id)
);
create unique index uq_inv_products_sku on tbl_inv_products(coalesce(owner_branch_id, 0), sku);
create index idx_inv_products_name_trgm on tbl_inv_products using gin (name gin_trgm_ops);

create table tbl_inv_product_uoms (
  product_id bigint not null references tbl_inv_products(id),
  uom_id bigint not null references tbl_inv_uoms(id),
  factor_to_base numeric(18,6) not null check (factor_to_base >= 1),   -- base = smallest issuable unit (D-106)
  is_active boolean not null default true,
  primary key (product_id, uom_id)
);
-- fn_inv_guard_product_uoms (constraint trigger, deferred):
--   the base row exists with factor = 1, the purchase row exists, only the base has factor = 1;
--   an UPDATE of factor_to_base is rejected once (product, uom) appears in tbl_inv_txn_lines,
--   tbl_inv_receipt_lines or tbl_inv_product_barcodes (D-106).
-- fn_inv_guard_products: an UPDATE of base_uom_id is rejected once any txn line exists for the product;
--   an owner_branch_id change is always rejected; a non-null owner must be an is_demo branch.

create table tbl_inv_product_barcodes (
  id bigint generated by default as identity primary key,
  barcode text not null check (barcode ~ '^[\x21-\x7E]{3,64}$'),
  product_id bigint not null, uom_id bigint not null,
  owner_branch_id bigint references tbl_branches("BranchID"),   -- copied from the product
  is_active boolean not null default true,
  created_by_account bigint not null references tbl_user_accounts(id),
  foreign key (product_id, uom_id) references tbl_inv_product_uoms(product_id, uom_id)
);
create unique index uq_inv_barcode_active on tbl_inv_product_barcodes(coalesce(owner_branch_id, 0), barcode)
  where is_active;                                                     -- reassignable after deactivation (D-128)
```

### 3.2 Locations, branch settings, stock levels, roles

```sql
create table tbl_inv_branch_settings (
  branch_id bigint primary key references tbl_branches("BranchID"),
  is_enabled boolean not null default false,
  go_live_date date,
  opening_window_days int not null default 7 check (opening_window_days between 0 and 31),   -- D-117
  writeoff_threshold numeric(12,2) not null default 50.00,          -- D-108, Q-7
  osem_issue_review_threshold numeric(12,2) not null default 100.00,
  updated_at timestamptz not null default now(), updated_by_account bigint references tbl_user_accounts(id)
);

create table tbl_inv_locations (
  id bigint generated by default as identity primary key,
  branch_id bigint not null references tbl_branches("BranchID"),
  kind text not null check (kind in ('STORE','FLOOR','TRANSIT')),
  name text not null,
  count_frequency_days int check (count_frequency_days > 0),   -- STORE 30, FLOOR 7, TRANSIT null
  is_active boolean not null default true,
  unique (branch_id, kind)
);

create table tbl_inv_stock_levels (                  -- per-location override of product defaults (D-101)
  location_id bigint not null references tbl_inv_locations(id),
  product_id bigint not null references tbl_inv_products(id),
  branch_id bigint not null references tbl_branches("BranchID"),
  max_qty numeric(18,4) not null check (max_qty >= 0),
  updated_at timestamptz not null default now(), updated_by_account bigint not null references tbl_user_accounts(id),
  primary key (location_id, product_id)
);

create table tbl_inv_account_roles (                 -- Head Nurse capability (D-80, D-127)
  id bigint generated by default as identity primary key,
  account_id bigint not null references tbl_user_accounts(id),
  branch_id bigint not null references tbl_branches("BranchID"),   -- valid only while the account's branch = this
  role text not null check (role in ('HEAD_NURSE')),
  is_active boolean not null default true,
  granted_by_account bigint not null references tbl_user_accounts(id), granted_at timestamptz not null default now(),
  revoked_by_account bigint references tbl_user_accounts(id), revoked_at timestamptz
);
create unique index uq_inv_account_roles_active on tbl_inv_account_roles(account_id, role) where is_active;

create table tbl_inv_resident_billing (              -- D-122; avoids altering tbl_residents
  resident_id bigint primary key references tbl_residents(id),
  branch_id bigint not null references tbl_branches("BranchID"),
  billing_code text not null,                        -- Bukku customer/contact code
  updated_at timestamptz not null default now(), updated_by_account bigint not null references tbl_user_accounts(id),
  unique (billing_code)
);
```

### 3.3 Periods, closing snapshots, counters, idempotency

```sql
create table tbl_inv_billing_periods (
  id bigint generated by default as identity primary key,
  branch_id bigint not null references tbl_branches("BranchID"),
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  status text not null default 'OPEN' check (status in ('OPEN','LOCKED')),
  exceptions_reviewed_at timestamptz, exceptions_reviewed_by_account bigint references tbl_user_accounts(id),
  exceptions_reviewed_by_staff text references tbl_staff("StaffID"),
  locked_at timestamptz, locked_by_account bigint references tbl_user_accounts(id),
  locked_by_staff text references tbl_staff("StaffID"),
  reopen_count int not null default 0,
  unique (branch_id, period_month),
  check ((status = 'LOCKED') = (locked_at is not null))
);

create table tbl_inv_period_closing (                -- D-116; written once per lock, replaced on re-lock
  billing_period_id bigint not null references tbl_inv_billing_periods(id),
  branch_id bigint not null references tbl_branches("BranchID"),
  lock_seq int not null,                             -- = reopen_count at time of lock (history kept)
  product_id bigint not null references tbl_inv_products(id),
  location_id bigint references tbl_inv_locations(id),   -- NULL row = pool total (qty, value)
  resident_id bigint references tbl_residents(id),
  qty numeric(18,4) not null,
  value numeric(18,4)                                -- pool rows only (value is pool-level)
);
create unique index uq_inv_period_closing on tbl_inv_period_closing
  (billing_period_id, lock_seq, product_id, location_id, resident_id) nulls not distinct;

create table tbl_inv_counters (
  branch_id bigint not null references tbl_branches("BranchID"),
  doc_type text not null,            -- 'TXN','RCV','TRF','REQ','CNT','ADJ','EXP'
  year int not null,                 -- KL year of posted_at (D-129)
  last_no int not null default 0,
  primary key (branch_id, doc_type, year)
);  -- number format <BranchCode>-<DOC>-<YYYY>-<000123>

create table tbl_inv_idempotency (                   -- D-110
  key uuid primary key,
  rpc text not null,
  account_id bigint not null references tbl_user_accounts(id),
  request_hash bytea not null,       -- digest(payload-without-confirmation-flags::text, 'sha256')
  result jsonb not null,             -- successful results only
  created_at timestamptz not null default now()
);
```

### 3.4 Ledger: the source of truth

```sql
create table tbl_inv_txns (
  id bigint generated by default as identity primary key,
  txn_no text not null unique,
  txn_type text not null check (txn_type in (
    'OPENING_BALANCE','RECEIPT','ISSUE','INTERNAL_TRANSFER','TRANSIT_ALLOCATE','TRANSIT_RELEASE',
    'BRANCH_TRANSFER_OUT','BRANCH_TRANSFER_IN','RETURN_FROM_ISSUE','RETURN_TO_SUPPLIER',
    'DAMAGED_EXPIRED','ADJUSTMENT','REVERSAL')),     -- RETURN_FROM_ISSUE supersedes RETURN_FROM_RESIDENT (D-131)
  branch_id bigint not null references tbl_branches("BranchID"),
  txn_date date not null,                             -- business date (KL)
  billing_period_id bigint not null references tbl_inv_billing_periods(id),
  posted_at timestamptz not null default clock_timestamp(),
  performed_by_staff text not null references tbl_staff("StaffID"),
  posted_by_account bigint not null references tbl_user_accounts(id),
  approved_by_account bigint references tbl_user_accounts(id), approved_by_staff text references tbl_staff("StaffID"),
  reason_code text check (reason_code in ('DAMAGED','EXPIRED','COUNT_VARIANCE','FOUND','LOST','TRANSFER_DISCREPANCY',
    'DATA_ENTRY','WRONG_RESIDENT','WRONG_PRODUCT','WRONG_QTY','WRONG_COST','DISCHARGED','DECEASED',
    'NO_LONGER_REQUIRED','WRONG_ALLOCATION','OTHER')),
  remarks text check (length(remarks) <= 500),
  negative_stock_confirmed boolean not null default false,
  inactive_resident_confirmed boolean not null default false,
  sanity_confirmed boolean not null default false,    -- D-109
  reverses_txn_id bigint unique references tbl_inv_txns(id),
  correction_of_txn_id bigint references tbl_inv_txns(id),
  cascade_of_txn_id bigint references tbl_inv_txns(id),   -- e.g. an allocation reversed because its receipt was (D-124)
  source_doc_type text check (source_doc_type in ('RECEIPT','BRANCH_TRANSFER','ADJUSTMENT')),
  source_doc_id bigint,
  request_key uuid not null references tbl_inv_idempotency(key) deferrable initially deferred,   -- shared by all txns of one RPC call
  check ((txn_type = 'REVERSAL') = (reverses_txn_id is not null))
);
create index idx_inv_txns_branch_date on tbl_inv_txns(branch_id, txn_date desc, id desc);
create index idx_inv_txns_period on tbl_inv_txns(billing_period_id);
create index idx_inv_txns_source on tbl_inv_txns(source_doc_type, source_doc_id);
create index idx_inv_txns_request on tbl_inv_txns(request_key);

create table tbl_inv_txn_lines (
  id bigint generated by default as identity primary key,
  txn_id bigint not null references tbl_inv_txns(id) deferrable initially deferred,
  line_no smallint not null check (line_no > 0),
  branch_id bigint not null references tbl_branches("BranchID"),
  txn_date date not null,                             -- denormalised (immutable, D-115)
  txn_type text not null,                             -- denormalised
  location_id bigint not null references tbl_inv_locations(id),
  resident_id bigint references tbl_residents(id),    -- NOT NULL iff location kind = TRANSIT
  product_id bigint not null references tbl_inv_products(id),
  qty_base numeric(18,4) not null check (qty_base <> 0),
  uom_id bigint not null references tbl_inv_uoms(id), uom_code text not null,
  qty_entered numeric(18,4) not null check (qty_entered > 0),    -- paid + FOC for receipts
  factor_to_base numeric(18,6) not null check (factor_to_base >= 1),
  unit_cost numeric(18,6) not null check (unit_cost >= 0),       -- per base uom
  value numeric(18,4) not null,
  revaluation_value numeric(18,4) not null default 0,
  cost_source text not null check (cost_source in
    ('INPUT','LANDED','PROVISIONAL','WAC','ORIGINAL','TRANSFER','MASTER_FALLBACK','PENDING_COST')),
  bucket_qty_after numeric(18,4) not null,
  pool_qty_after numeric(18,4) not null, pool_value_after numeric(18,4) not null, pool_wac_after numeric(18,6),
  pair_line_id bigint references tbl_inv_txn_lines(id) deferrable initially deferred,   -- both directions, pre-allocated ids (D-112)
  source_line_id bigint references tbl_inv_txn_lines(id),   -- reversal → original; return → issue; transfer-in → transfer-out
  unique (txn_id, line_no),
  check (abs(qty_base - sign(qty_base) * qty_entered * factor_to_base) < 0.00005)   -- factors ≥ 1 (D-106)
);
create index idx_inv_lines_pool on tbl_inv_txn_lines(branch_id, product_id, id);
create index idx_inv_lines_bucket on tbl_inv_txn_lines(location_id, product_id, resident_id, id);
create index idx_inv_lines_date on tbl_inv_txn_lines(branch_id, txn_date, id);
create index idx_inv_lines_prod_date on tbl_inv_txn_lines(branch_id, product_id, txn_date);
create index idx_inv_lines_txn on tbl_inv_txn_lines(txn_id);
create index idx_inv_lines_source on tbl_inv_txn_lines(source_line_id) where source_line_id is not null;
create index idx_inv_lines_resident on tbl_inv_txn_lines(resident_id) where resident_id is not null;
```

### 3.5 Balance caches

```sql
create table tbl_inv_cost_pools (       -- branch × product (D-50)
  branch_id bigint not null references tbl_branches("BranchID"),
  product_id bigint not null references tbl_inv_products(id),
  qty numeric(18,4) not null default 0, value numeric(18,4) not null default 0, wac numeric(18,6),
  last_line_id bigint references tbl_inv_txn_lines(id), updated_at timestamptz not null default now(),
  primary key (branch_id, product_id)
);
create table tbl_inv_balances (         -- location × product × resident
  id bigint generated by default as identity primary key,
  branch_id bigint not null references tbl_branches("BranchID"),
  location_id bigint not null references tbl_inv_locations(id),
  product_id bigint not null references tbl_inv_products(id),
  resident_id bigint references tbl_residents(id),
  qty numeric(18,4) not null default 0,
  last_line_id bigint references tbl_inv_txn_lines(id), updated_at timestamptz not null default now(),
  unique nulls not distinct (location_id, product_id, resident_id)
);
create index idx_inv_balances_branch on tbl_inv_balances(branch_id, product_id);
create index idx_inv_balances_resident on tbl_inv_balances(resident_id) where resident_id is not null;
create index idx_inv_balances_negative on tbl_inv_balances(branch_id) where qty < 0;
```

### 3.6 Documents

```sql
-- Receipts (D-105)
create table tbl_inv_receipts (
  id bigint generated by default as identity primary key,
  receipt_no text not null unique,
  branch_id bigint not null references tbl_branches("BranchID"),
  location_id bigint not null references tbl_inv_locations(id),        -- the branch STORE
  supplier_id bigint not null references tbl_inv_suppliers(id), supplier_name text not null,
  doc_type text not null check (doc_type in ('INVOICE','DO','CASH_BILL')),
  supplier_doc_no text not null check (length(btrim(supplier_doc_no)) between 1 and 60),   -- DO / invoice / bill no.
  doc_key text generated always as (upper(regexp_replace(supplier_doc_no, '[^A-Za-z0-9]', '', 'g'))) stored,
  invoice_no text, invoice_key text generated always as (upper(regexp_replace(invoice_no, '[^A-Za-z0-9]', '', 'g'))) stored,
  invoice_date date,
  received_date date not null,
  received_by_staff text not null references tbl_staff("StaffID"),
  item_count int not null check (item_count > 0),
  lines_total numeric(14,2) not null,             -- Σ line_total (as invoiced, paid qty only)
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),              -- SST paid: non-recoverable → cost
  other_charges_total numeric(14,2) not null default 0 check (other_charges_total >= 0),   -- delivery etc.
  rounding_adj numeric(14,2) not null default 0 check (abs(rounding_adj) <= 1.00),
  grand_total numeric(14,2) check (grand_total >= 0),     -- NULL while AWAITING_INVOICE
  cost_status text not null check (cost_status in ('FINAL','PROVISIONAL')),
  reconciliation_status text not null check (reconciliation_status in
    ('RECONCILED','WITHIN_TOLERANCE','UNRECONCILED','ACKNOWLEDGED','AWAITING_INVOICE')),
  reconciliation_ack_by_account bigint references tbl_user_accounts(id), reconciliation_ack_note text,
  stock_request_id bigint references tbl_inv_stock_requests(id),
  txn_id bigint not null unique references tbl_inv_txns(id) deferrable initially deferred,
  is_voided boolean not null default false, voided_by_txn_id bigint references tbl_inv_txns(id),
  superseded_by_receipt_id bigint references tbl_inv_receipts(id),   -- set when a correction replaces it
  remarks text,
  check (doc_type <> 'INVOICE' or (invoice_no is not null and invoice_date is not null))
);
create unique index uq_inv_receipts_doc on tbl_inv_receipts(supplier_id, doc_type, doc_key) where not is_voided;
create unique index uq_inv_receipts_inv on tbl_inv_receipts(supplier_id, invoice_key) where not is_voided and invoice_key is not null;
-- Whitelisted UPDATEs (trigger): attach invoice (invoice_no/date/grand_total from NULL, once),
-- reconciliation_status + ack fields, cost_status PROVISIONAL→FINAL (only with superseded_by…),
-- is_voided/voided_by_txn_id false→true, superseded_by_receipt_id NULL→value.

create table tbl_inv_receipt_lines (
  id bigint generated by default as identity primary key,
  receipt_id bigint not null references tbl_inv_receipts(id),
  branch_id bigint not null references tbl_branches("BranchID"),
  line_no smallint not null,
  product_id bigint not null references tbl_inv_products(id), product_name text not null,
  uom_id bigint not null references tbl_inv_uoms(id), factor_to_base numeric(18,6) not null,
  qty_entered numeric(18,4) not null check (qty_entered > 0),        -- paid qty
  foc_qty numeric(18,4) not null default 0 check (foc_qty >= 0),     -- free/bonus, same uom
  qty_base numeric(18,4) not null,                                   -- (paid + foc) × factor
  unit_cost_entered numeric(18,6) not null check (unit_cost_entered >= 0),   -- per entered uom, as invoiced
  line_total numeric(14,2) not null,                                 -- round(qty_entered × unit_cost_entered, 2)
  landed_value numeric(18,4) not null,                               -- ledger value (D-105 allocation)
  batch_no text, expiry_date date,                                   -- informational (D-120)
  request_line_id bigint references tbl_inv_stock_request_lines(id),
  allocate_resident_id bigint references tbl_residents(id),          -- receive & allocate (D-40)
  txn_line_id bigint not null references tbl_inv_txn_lines(id) deferrable initially deferred,
  unique (receipt_id, line_no)
);
create index idx_inv_receipt_lines_expiry on tbl_inv_receipt_lines(branch_id, expiry_date) where expiry_date is not null;

-- Branch transfers (D-31…D-33, D-113)
create table tbl_inv_branch_transfers (
  id bigint generated by default as identity primary key,
  transfer_no text not null unique,
  from_branch_id bigint not null references tbl_branches("BranchID"),
  to_branch_id bigint not null references tbl_branches("BranchID"),
  status text not null check (status in ('DISPATCHED','RECEIVED','CANCELLED')),
  dispatch_txn_id bigint not null unique references tbl_inv_txns(id) deferrable initially deferred,
  cancel_txn_id bigint unique references tbl_inv_txns(id),
  dispatched_by_staff text not null references tbl_staff("StaffID"),
  check (from_branch_id <> to_branch_id)
);   -- whitelisted UPDATEs: DISPATCHED→RECEIVED, RECEIVED→DISPATCHED (IN reversed), DISPATCHED→CANCELLED(+cancel_txn_id)
create table tbl_inv_branch_transfer_lines (
  id bigint generated by default as identity primary key,
  transfer_id bigint not null references tbl_inv_branch_transfers(id),
  branch_id bigint not null references tbl_branches("BranchID"),     -- = from_branch_id
  product_id bigint not null references tbl_inv_products(id),
  qty_base numeric(18,4) not null check (qty_base > 0),
  unit_cost numeric(18,6) not null, value numeric(18,4) not null,
  out_line_id bigint not null references tbl_inv_txn_lines(id) deferrable initially deferred
);
create table tbl_inv_branch_transfer_receipts (       -- append-only; one row per receive (re-receive allowed)
  id bigint generated by default as identity primary key,
  transfer_id bigint not null references tbl_inv_branch_transfers(id),
  branch_id bigint not null references tbl_branches("BranchID"),     -- = to_branch_id
  receive_txn_id bigint not null unique references tbl_inv_txns(id),
  received_by_staff text not null references tbl_staff("StaffID"),
  discrepancy_adjustment_id bigint references tbl_inv_adjustments(id)
);

-- Stock requests (D-100, D-119)
create table tbl_inv_stock_requests (
  id bigint generated by default as identity primary key,
  request_no text not null unique,
  branch_id bigint not null references tbl_branches("BranchID"),
  status text not null check (status in ('DRAFT','SUBMITTED','APPROVED','REJECTED','ORDERED',
                                          'PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  requested_by_staff text not null references tbl_staff("StaffID"),
  created_by_account bigint not null references tbl_user_accounts(id),
  submitted_at timestamptz,
  reviewed_by_account bigint references tbl_user_accounts(id), reviewed_by_staff text references tbl_staff("StaffID"),
  reviewed_at timestamptz, review_note text,
  ordered_at timestamptz, ordered_by_account bigint references tbl_user_accounts(id),
  external_ref text, expected_delivery_date date,
  updated_at timestamptz not null default now()
);
create table tbl_inv_stock_request_lines (
  id bigint generated by default as identity primary key,
  request_id bigint not null references tbl_inv_stock_requests(id),
  branch_id bigint not null references tbl_branches("BranchID"),
  product_id bigint not null references tbl_inv_products(id),
  supplier_id bigint references tbl_inv_suppliers(id),
  current_qty_snapshot numeric(18,4) not null, max_qty_snapshot numeric(18,4),
  suggested_qty numeric(18,4) not null check (suggested_qty >= 0),
  requested_qty numeric(18,4) not null check (requested_qty > 0),    -- base
  approved_qty numeric(18,4) check (approved_qty >= 0),
  closed_short_at timestamptz, closed_short_by_account bigint references tbl_user_accounts(id), closed_short_reason text,
  remarks text,
  unique (request_id, product_id)
);  -- received qty is derived from receipt lines of non-voided receipts
create table tbl_inv_stock_request_events (          -- append-only
  id bigint generated by default as identity primary key,
  request_id bigint not null references tbl_inv_stock_requests(id),
  branch_id bigint not null references tbl_branches("BranchID"),
  event text not null check (event in ('CREATED','SUBMITTED','APPROVED','REJECTED','ORDERED','FOLLOW_UP',
                                       'RECEIPT_LINKED','LINE_CLOSED_SHORT','CLOSED','CANCELLED')),
  note text, account_id bigint not null references tbl_user_accounts(id), staff_id text references tbl_staff("StaffID"),
  created_at timestamptz not null default now()
);

-- Counts (D-60, D-104, D-123)
create table tbl_inv_counts (
  id bigint generated by default as identity primary key,
  count_no text not null unique,
  branch_id bigint not null references tbl_branches("BranchID"),
  location_id bigint not null references tbl_inv_locations(id),
  count_type text not null check (count_type in ('MONTHLY_STORE','WEEKLY_FLOOR','AD_HOC')),
  status text not null check (status in ('DRAFT','IN_PROGRESS','SUBMITTED','INVESTIGATED','CLOSED','CANCELLED')),
  freeze_location boolean not null default false,    -- default true for MONTHLY_STORE (Q-30)
  snapshot_line_id bigint,                           -- max(tbl_inv_txn_lines.id) at START; expected is as-of this
  started_at timestamptz,                            -- display only
  counted_by_staff text not null references tbl_staff("StaffID"),
  submitted_at timestamptz,
  investigated_by_staff text references tbl_staff("StaffID"), investigated_by_account bigint references tbl_user_accounts(id),
  investigation_summary text, closed_at timestamptz,
  created_by_account bigint not null references tbl_user_accounts(id),
  updated_at timestamptz not null default now()
);
create unique index uq_inv_counts_active on tbl_inv_counts(location_id) where status = 'IN_PROGRESS';
create table tbl_inv_count_lines (
  id bigint generated by default as identity primary key,
  count_id bigint not null references tbl_inv_counts(id),
  branch_id bigint not null references tbl_branches("BranchID"),
  product_id bigint not null references tbl_inv_products(id),
  resident_id bigint references tbl_residents(id),
  is_found_item boolean not null default false,      -- added during the count (not on the generated sheet)
  expected_qty numeric(18,4),                        -- filled at SUBMIT, as of snapshot_line_id
  posted_since_start numeric(18,4),                  -- filled at SUBMIT, Σ bucket lines with id > snapshot_line_id
  physical_qty numeric(18,4) check (physical_qty >= 0),
  variance_qty numeric(18,4) generated always as (physical_qty - expected_qty) stored,
  investigation_note text
);
create unique index uq_inv_count_lines on tbl_inv_count_lines(count_id, product_id, resident_id) nulls not distinct;

-- Adjustments (D-61)
create table tbl_inv_adjustments (
  id bigint generated by default as identity primary key,
  adjustment_no text not null unique,
  branch_id bigint not null references tbl_branches("BranchID"),
  location_id bigint not null references tbl_inv_locations(id),
  count_id bigint references tbl_inv_counts(id),
  branch_transfer_id bigint references tbl_inv_branch_transfers(id),   -- transfer discrepancy (D-33)
  status text not null check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  reason_code text not null,
  justification text not null check (length(btrim(justification)) >= 5),
  requested_by_staff text not null references tbl_staff("StaffID"),
  requested_by_account bigint not null references tbl_user_accounts(id),
  decided_by_staff text references tbl_staff("StaffID"), decided_by_account bigint references tbl_user_accounts(id),
  decided_at timestamptz, decision_note text,
  txn_id bigint unique references tbl_inv_txns(id),   -- set once at PENDING→APPROVED (whitelisted)
  check (decided_by_account is null or decided_by_account <> requested_by_account)
);
create table tbl_inv_adjustment_lines (
  id bigint generated by default as identity primary key,
  adjustment_id bigint not null references tbl_inv_adjustments(id),
  branch_id bigint not null references tbl_branches("BranchID"),
  product_id bigint not null references tbl_inv_products(id),
  resident_id bigint references tbl_residents(id),
  qty_delta_base numeric(18,4) not null check (qty_delta_base <> 0),
  count_line_id bigint references tbl_inv_count_lines(id)
);
```

### 3.7 Charges and exports

```sql
create table tbl_inv_charges (
  id bigint generated by default as identity primary key,
  branch_id bigint not null references tbl_branches("BranchID"),
  billing_period_id bigint not null references tbl_inv_billing_periods(id),
  charge_date date not null,
  charge_kind text not null check (charge_kind in
    ('ISSUE','RETURN_CREDIT','REVERSAL','PRICING','MANUAL_ADJUSTMENT')),
  target text not null check (target in ('RESIDENT','OSEM_EXPENSE')),
  resident_id bigint references tbl_residents(id),
  expense_note text check (length(expense_note) <= 200),
  txn_id bigint references tbl_inv_txns(id),
  txn_line_id bigint references tbl_inv_txn_lines(id),
  related_charge_id bigint references tbl_inv_charges(id),
  product_id bigint references tbl_inv_products(id), product_name text not null, sku text not null, uom_code text not null,
  qty_base numeric(18,4) not null,                   -- signed; 0 for PRICING/MANUAL_ADJUSTMENT
  unit_charge_price numeric(12,4),                   -- NULL on a PRICE_PENDING issue or OSEM_EXPENSE
  charge_amount numeric(12,2) not null,              -- signed; 0 for OSEM_EXPENSE
  cost_amount numeric(18,4) not null,                -- signed; 0 for PRICING/MANUAL_ADJUSTMENT
  reason text,
  created_by_account bigint not null references tbl_user_accounts(id),
  created_by_staff text not null references tbl_staff("StaffID"),
  created_at timestamptz not null default now(),
  check ((target = 'RESIDENT') = (resident_id is not null)),
  check (target = 'RESIDENT' or charge_amount = 0),
  check ((charge_kind in ('PRICING','MANUAL_ADJUSTMENT')) = (txn_line_id is null)),
  check (charge_kind = 'ISSUE' or related_charge_id is not null),
  check (charge_kind <> 'PRICING' or reason is not null)
);
create unique index uq_inv_charges_line on tbl_inv_charges(txn_line_id) where txn_line_id is not null;
create unique index uq_inv_charges_pricing on tbl_inv_charges(related_charge_id) where charge_kind = 'PRICING';
create index idx_inv_charges_period on tbl_inv_charges(branch_id, billing_period_id);
create index idx_inv_charges_resident on tbl_inv_charges(resident_id, charge_date desc);
-- PRICE_PENDING (derived): an ISSUE charge, target RESIDENT, unit_charge_price NULL, with no PRICING child.

create table tbl_inv_charge_exports (                 -- D-122
  id bigint generated by default as identity primary key,
  export_no text not null unique,
  branch_id bigint not null references tbl_branches("BranchID"),
  billing_period_id bigint not null references tbl_inv_billing_periods(id),
  layout text not null check (layout in ('ITEMISED','SUMMARY')),
  exported_by_account bigint not null references tbl_user_accounts(id),
  row_count int not null, total_amount numeric(14,2) not null, file_sha256 bytea not null,
  created_at timestamptz not null default now()
);
create table tbl_inv_charge_export_items (            -- append-only
  export_id bigint not null references tbl_inv_charge_exports(id),
  charge_id bigint not null references tbl_inv_charges(id),
  branch_id bigint not null references tbl_branches("BranchID"),
  primary key (export_id, charge_id)
);
```

### 3.8 Audit

```sql
create table tbl_inv_audit_log (
  id bigint generated by default as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  action text not null, entity text not null, entity_id text not null,
  branch_id bigint references tbl_branches("BranchID"),       -- NULL for global master data
  owner_branch_id bigint references tbl_branches("BranchID"), -- set for demo-owned master data
  account_id bigint not null references tbl_user_accounts(id), auth_user_id uuid not null,
  staff_id text references tbl_staff("StaffID"),
  txn_id bigint references tbl_inv_txns(id), request_key uuid,
  reason text, before_data jsonb, after_data jsonb
);
create index idx_inv_audit_entity on tbl_inv_audit_log(entity, entity_id, occurred_at desc);
create index idx_inv_audit_branch on tbl_inv_audit_log(branch_id, occurred_at desc);
```

### 3.9 Views (all `security_invoker = true`)

- **`v_inv_stock_balance`:** balances joined with product, category, location and effective max, plus pool WAC and `qty × wac`.
  - Effective max is `stock_levels.max_qty`, else `default_max_store` for STORE / `default_max_floor` for FLOOR, else NULL.
- **`v_inv_suggested_order`** (D-119), per branch × product:
  - `max_total = eff_max(STORE) + eff_max(FLOOR)`, each default applied once (fixes the 2× bug).
  - `current = on hand STORE + FLOOR`.
  - `open_req = Σ(approved − received)` over lines not closed short on requests in APPROVED/ORDERED/PARTIALLY_RECEIVED. Whether to subtract it is Q-18.
  - `suggested_base = greatest(max_total − current − open_req, 0)`, and `suggested_purchase = ceil(suggested_base / purchase_factor)`.
- **`v_inv_floor_topup`:** `greatest(eff_max(FLOOR) − on_hand(FLOOR), 0)`, capped at STORE on hand.
- **`v_inv_goods_awaiting_receipt`:** DISPATCHED transfers with line values.
- **`v_inv_request_progress`**, **`v_inv_price_pending`**, **`v_inv_exceptions`** (§7.3).

---

## 4. Transaction model

### 4.1 Structure
- **D-10:** Header + lines, one line per location leg per product. Vocabularies are `text` + CHECK.
- **D-11:** A positive `qty_base` enters the bucket and a negative one leaves it. `value` has the same sign. A bucket's qty is `Σ qty_base`. A pool's qty is `Σ qty_base` and its value is `Σ(value + revaluation_value)`.
- **D-12:** Every txn belongs to one branch. A branch transfer is two txns.
- **D-13 — SUPERSEDED by D-107:** "resident's branch must equal the line's branch on every Transit line".
- **D-14:** Documents hold workflow state, and txns hold stock and value.
- **D-15:** `txn_date` is the business date (period, reports). `posted_at` is when it was written (WAC order, D-57).

### 4.2 Event → ledger mapping (S = STORE, F = FLOOR, T[r] = TRANSIT bucket of resident r)

| # | Event (txn_type) | Lines | Cost basis | Other effects | Who (§8.4) |
|---|---|---|---|---|---|
| 1 | Opening Balance `OPENING_BALANCE` | +q at S, F or T[r] | `INPUT` (entered cost, required) | Only within the opening window, dated `go_live_date`, and only while the pool holds just opening lines (D-117) | ADMIN |
| 2 | Purchase Receipt `RECEIPT` | +q at **S** | `LANDED`, or `PROVISIONAL` on a DO without prices (D-105) | Receipt doc. With "receive & allocate" ticked, a linked `TRANSIT_ALLOCATE` in the same RPC (D-40) | HEAD_NURSE+ |
| 3 | Issue `ISSUE` | −q at S, F or T[r] | `WAC` (else `MASTER_FALLBACK`, else `PENDING_COST`) | One charge per line (RESIDENT or OSEM_EXPENSE, chosen per issue). From T[r], the target must be RESIDENT r | STAFF+ |
| 4 | OSEM Operational Expense | `ISSUE` with target OSEM_EXPENSE | `WAC` | Charge with amount 0 and `cost_amount = value` | STAFF+ |
| 5a | Store↔Floor `INTERNAL_TRANSFER` | −q / +q (paired) | out `WAC`, in `TRANSFER` | Pool unchanged | STAFF+ |
| 5b | `TRANSIT_ALLOCATE` | −q at S or F / +q at T[r] | as 5a | r must be ACTIVE and in the branch | STAFF+ |
| 5c | `TRANSIT_RELEASE` | −q at T[r] / +q at S | as 5a | Fixed reasons DISCHARGED, DECEASED, NO_LONGER_REQUIRED, WRONG_ALLOCATION (D-124) | **HEAD_NURSE+** |
| 6 | Branch→Branch | `BRANCH_TRANSFER_OUT` −q at source S or F. Later `BRANCH_TRANSFER_IN` +q (the **full** dispatched qty) at the destination S | out `WAC`, in `TRANSFER` (dispatched unit cost) | A discrepancy becomes an adjustment request at the destination (D-33) | STAFF+ |
| 7a | Return from issue `RETURN_FROM_ISSUE` | +q at S, F or T[r] | `ORIGINAL` (issue line cost) | `source_line_id` = the issue line. q ≤ issued − returned. A `RETURN_CREDIT` charge at the original price for RESIDENT, or a cost-only credit for OSEM_EXPENSE (D-131) | STAFF+ |
| 7b | `RETURN_TO_SUPPLIER` | −q at S | `WAC` | Optional receipt-line link; supplier credit value is recorded as info | HEAD_NURSE+ |
| 8 | `DAMAGED_EXPIRED` | −q at S, F or T[r] | `WAC` | Allowed only if the value at WAC is ≤ the branch threshold. Otherwise the RPC returns `WRITE_OFF_NEEDS_APPROVAL` and the UI turns it into an adjustment request (D-108) | STAFF+ (≤ threshold) |
| 9 | `ADJUSTMENT` | ±q at the adjustment's location | −: `WAC`; +: `WAC` / `MASTER_FALLBACK` / `PENDING_COST` | Posted at approval (D-61) | request HEAD_NURSE+ (STAFF for write-offs), approve MOD/ADMIN (≠ requester) |
| 10 | Wrong-entry correction | `REVERSAL` (mirrors every original line) + a new txn of the original type with `correction_of_txn_id`. Pool effects are **netted** (D-103) | §5.7 | One RPC, one DB transaction | MOD/ADMIN; HEAD_NURSE for finalising the cost of a PROVISIONAL receipt (D-105) |

No event UPDATEs or DELETEs a txn or line.

### 4.3 Transfer pairing and id allocation (D-112)
- **Pre-allocated ids.** The engine pre-allocates every header and line id with `nextval(pg_get_serial_sequence('tbl_inv_txn_lines','id'))` before inserting. That lets it write `pair_line_id` in both directions, `source_line_id` on transfer-in lines, `tbl_inv_receipts.txn_id` ↔ `tbl_inv_txns.source_doc_id`, and `receipt_lines.txn_line_id` in the same statement batch. The FKs are deferrable, so ordering doesn't matter. **No UPDATE after insert.**
- **Same branch:** one txn with two paired lines. The engine asserts `Σ qty = 0` and `Σ value = 0`.
- **Cross branch:**
  - The in-line's `source_line_id` points to the out-line.
  - `tbl_inv_branch_transfer_receipts` is append-only, one row per receive.
  - Reversing a receive (MOD/ADMIN) moves the transfer RECEIVED→DISPATCHED. It can then be received again (a new receipt row) or cancelled.
  - Cancelling reverses the OUT txn and moves DISPATCHED→CANCELLED. Who may cancel: D-32.

### 4.4 Reversal / correction (D-103, D-130)
- **A reversal** has `reverses_txn_id` (UNIQUE), one line per original line with `qty = −orig`, `value = −orig.value`, `ORIGINAL`, and `source_line_id` set.
  - A reversal can't be reversed.
  - `OPENING_BALANCE` reversal is ADMIN only.
  - Reversing an ISSUE creates `REVERSAL` charges, plus a reversal of any `PRICING` child at the same amount.
  - Reversing a RECEIPT sets `is_voided` and **cascades** (D-124): any linked `TRANSIT_ALLOCATE` is reversed first in the same RPC (`cascade_of_txn_id`). If the allocated qty was already issued, D-18 blocks it with `TRANSIT_STOCK_USED` (rev 3.1 name; the stock may have been issued, released or written off), and that movement has to be reversed first.
- **Dates (D-130):**
  - A reversal's `txn_date` is chosen within an OPEN period (default `fn_inv_today()`). The original may be in a LOCKED period.
  - The corrected txn's `txn_date` is the original's date if that period is still OPEN, otherwise the reversal's date.
  - The §8.4 wording "reverse/correct" means *the reversal posts into an open period*.
- **Correction.** `inv_correct_txn(p_original_txn_id, p_reason, p_new jsonb, p_key)` builds both txns in one lock plan (D-111) and applies the **net** pool effect once (§5.7). The negative-stock check runs on the **net** bucket result.
- **Finalising a PROVISIONAL receipt** (`inv_finalise_receipt_cost`, HEAD_NURSE+) is a restricted correction.
  - It's allowed only while the receipt is PROVISIONAL and its period is OPEN.
  - Products, quantities and FOC must be identical; only costs and header totals may change.
  - It goes through the same netted path (D-103). The new receipt row gets `cost_status = FINAL`, and the old one gets `superseded_by_receipt_id`.
  - Any quantity change needs a full MOD/ADMIN correction.
- **Derived states.** "Is reversed" and "is correction" are derived. Headers are never updated.

### 4.5 Idempotency (D-110; supersedes D-16)
- Every mutating RPC takes `p_key uuid`. The client creates it with `crypto.randomUUID()` when the form mounts, and regenerates it after a success or after the user edits the form following an error.
- Inside the RPC:
  1. Take `pg_advisory_xact_lock(hashtextextended(p_key::text, 0))`.
  2. Look up `tbl_inv_idempotency`. If the key is found with the same `rpc` and `request_hash`, return the stored `result` with `replayed: true`. If the hash or rpc differs, return `IDEMPOTENCY_KEY_REUSED`.
  3. On success, insert the idempotency row (result included) in the same transaction.
- The hash is `digest(p_payload - '{allow_negative,sanity_confirmed,inactive_resident_confirmed}'::text[] ::text, 'sha256')`. Confirmation flags are excluded, so the confirm round-trip reuses the key.
- Soft rejections (confirm-required and validation codes) are **not** stored.
- Every txn written by the call carries `request_key = p_key`. Documents have no idempotency columns.
- Retention: keep forever. The volume is tiny.

### 4.6 Concurrency and the lock plan (D-111; supersedes the ordering in D-17)
Each RPC first builds a **plan**: the union across *all* txns it will write of the documents, return source lines, periods, locations, pools, buckets and counters. It then locks them once, in this canonical order, before writing anything:

1. document headers `FOR UPDATE`, sorted by (table name, id)
2. advisory locks `('inv_ret', issue_line_id)`, sorted
3. billing periods, sorted by (branch, month): `FOR SHARE` for postings, `FOR UPDATE` for lock or reopen
4. locations `FOR SHARE`, sorted by id (count START takes `FOR UPDATE` on its location, D-104)
5. cost pools (`insert … on conflict do nothing`, then `FOR UPDATE`), sorted by (branch, product)
6. buckets, the same way, sorted by (location, product, coalesce(resident, 0))
7. counters `UPDATE … RETURNING`, sorted by (branch, doc_type, year)

The isolation level is READ COMMITTED. Negative-stock and freeze checks read locked rows. On `40P01` or `40001` the Server Action retries once with the same key. The test is a two-session Node script against the local stack with crossed product sets, because there's no `dblink`.

### 4.7 Validation, negative stock and sanity
- RPCs return `jsonb {ok, code, message, data}`. Business rejections are returned **before any write**. Anything that fails after the first write RAISEs, which rolls everything back. The Server Action maps `code` to an i18n message.
- **Payload shape (D-126):** types, string lengths, arrays of at most 200 lines, and qty and cost ranges are all validated first. The branch is always derived from the location, document or resident row, never taken from a `p_branch` argument.
- **Negative stock:** `NEGATIVE_STOCK_CONFIRM` with a per-bucket before/after list. A re-submit with `allow_negative` sets `negative_stock_confirmed`.
- **D-18:** Transit buckets never go negative. This is a hard block.
- **Sanity (D-109):**
  - It returns `SANITY_CONFIRM` when any of these is true:
    - a line's `qty_base > max(10 × effective max, 1000)`
    - receipt unit cost per base deviates more than 50% from both the last receipt cost and the WAC (when either exists)
    - `line_total > 5000.00`
  - A re-submit with `sanity_confirmed` is accepted, and the UI requires the flagged value to be typed again.
  - Hard caps with no confirm: `qty_base ≤ 1,000,000` and `unit_cost ≤ 100,000`.
- **Other hard checks:**
  - the product is active and not owned by another branch
  - a UOM conversion exists
  - the quantity is integral when the UOM doesn't allow fractions
  - `txn_date` ≤ `fn_inv_today()`, ≥ `go_live_date`, and in an OPEN period
  - the location isn't frozen by an IN_PROGRESS count (`LOCATION_COUNT_IN_PROGRESS`)
  - the staff member is ACTIVE and belongs to the branch or HQ
  - the resident is in the branch for new allocations and resident issues from S/F; a non-ACTIVE resident needs `inactive_resident_confirmed`
- **Duplicates** within one payload (same product, location and resident on two lines) are merged in the UI and rejected by the RPC.

### 4.8 Immutability (D-19)
- `BEFORE UPDATE OR DELETE` triggers `fn_inv_block_mutation()` on the append-only tables:
  - `tbl_inv_txns`, `tbl_inv_txn_lines`, `tbl_inv_charges`
  - `tbl_inv_charge_export_items`, `tbl_inv_charge_exports`
  - `tbl_inv_audit_log`, `tbl_inv_idempotency`
  - `tbl_inv_receipt_lines`, `tbl_inv_branch_transfer_lines`, `tbl_inv_branch_transfer_receipts`
  - `tbl_inv_stock_request_events`, `tbl_inv_period_closing`
  - `tbl_inv_adjustment_lines` once the parent isn't PENDING
- A statement trigger blocks `TRUNCATE` on all of them.
- **Document tables** allow UPDATE only through `fn_inv_guard_transition()`, an explicit per-table whitelist of `(OLD.status → NEW.status, changed columns)` (listed in §3.6 comments). DELETE is always blocked.
- **Cache tables** (`tbl_inv_cost_pools`, `tbl_inv_balances`) accept writes only when `current_setting('inv.posting', true) = 'on'` (transaction-local).
- **DEMO purge:** `fn_inv_purge_demo()` sets `inv.demo_purge = 'on'`. The block trigger then allows DELETE only for rows of `is_demo` branches **and** only when `session_user = 'postgres'`. It's not granted to any API role (D-126, Q-21).
- **Caches:** `inv_verify_balances(branch)` (ADMIN) reports drift. `fn_inv_rebuild_caches(branch)` (postgres only, audited) recomputes pools and buckets from lines in id order (D-116).

---

## 5. WAC model

### 5.1 Scope (D-50)
There's one WAC per **product × branch**, shared by STORE, FLOOR and TRANSIT (Q-4 asks the owner to confirm).

### 5.2 Stored state and invariants
The pool stores `Q`, `V` and `W`.
- **I1:** `Q = Σ qty_base` and `V = Σ(value + revaluation_value)` over the branch×product lines.
- **I2:** If `Q ≤ 0`, then `V = round(Q × W, 4)`.
- **I3:** `W = round(V/Q, 6)` is recomputed on inflows and on netted corrections. Outflows keep `W`, and the last unit out clears any residue.

### 5.3 Rules (`fn_inv_apply_pool`)
**Inflow** (`dq > 0`, `c = pv/dq`):
- If `Q > 0` before: `V' = V + pv`, `W' = V'/Q'`.
- If `Q ≤ 0` before: `W' = c`, `V' = round(Q' × c, 4)`, and `reval = V' − (V + pv)`. This is the negative-stock true-up (D-55).

**Outflow at WAC**. The effective cost `W*` is chosen in this order:
- `W` if it isn't NULL
- else `standard_unit_cost` (`MASTER_FALLBACK`)
- else **0 with `PENDING_COST`** (D-118). The negative-stock confirmation is still required when Q goes below 0, and the line appears on the exception list.

Then:
- `Q' > 0`: `value = −round(|dq| × W*, 4)`.
- `Q' = 0`: `value = −V`.
- `Q' < 0`: `V' = round(Q' × W*, 4)` and `value = V' − V`.
- `W' = W*`. No revaluation.
- A later first inflow at cost `c` trues up a PENDING_COST outflow automatically through the `Q ≤ 0` path. The reported variance is the consumed cost.

**Outflow at a specified cost** (a reversal of an inflow):
- If `Q' > 0` and `V + pv > 0`: `V' = V + pv` and `W' = V'/Q'`.
- Otherwise: `V' = round(Q' × W, 4)` (0 if `Q' = 0`), `W' = W`, and `reval = V' − (V + pv)`.

**Internal legs:** the net is 0 (`dq = 0`, `dv = 0`) and `W` is unchanged.

**Netted correction:** see §5.7.

### 5.4 Worked examples (AMN, one product, base EA)

| Step | Event | Line qty / value / reval | Q | V | W |
|---|---|---|---|---|---|
| 1 | RECEIPT 100 @ 1.00 | +100 / +100.0000 | 100 | 100.0000 | 1.000000 |
| 2 | RECEIPT 100 @ 1.20 | +100 / +120.0000 | 200 | 220.0000 | **1.100000** |
| 3 | INTERNAL S→F 50 | −50/−55.0000; +50/+55.0000 | 200 | 220.0000 | 1.100000 |
| 4 | ISSUE 30 from F | −30 / −33.0000 | 170 | 187.0000 | 1.100000 |
| 5 | BRANCH_TRANSFER_OUT 20 | −20 / −22.0000 | 150 | 165.0000 | 1.100000 |
| 6 | BGN (Q 40, V 52, W 1.30): BRANCH_TRANSFER_IN 20 | +20 / +22.0000 | 60 | 74.0000 | 1.233333 |
| 7 | AMN RETURN_FROM_ISSUE 5 (orig 1.10) | +5 / +5.5000 | 155 | 170.5000 | 1.100000 |
| 8 | AMN RETURN_TO_SUPPLIER 10 | −10 / −11.0000 (supplier credit info 12.00) | 145 | 159.5000 | 1.100000 |

- **100 @ 1.00 + 100 @ 1.20 = 1.10** is step 2.
- **Rounding.** Q 3, V 10.0000, W 3.333333. The issues take −3.3333, then −3.3333, and the last one takes −3.3334, so V ends at exactly 0.
- **Negative, then receipt.**
  - Q 5, V 5.50, W 1.10. ISSUE 8 (confirmed): Q −3, V −3.30.
  - RECEIPT 10 @ 1.30 gives W 1.30, Q 7, V 9.10, with reval −0.60.
  - Check: 5.50 − 8.80 + 13.00 − 0.60 = 9.10 ✓.
- **PENDING_COST.**
  - A new product has W NULL and no standard cost. ISSUE 3 (confirmed): value 0, Q −3, V 0, W 0.
  - RECEIPT 10 @ 2.00: W 2.00, Q 7, V 14.00, reval −6.00. That −6.00 is the consumed cost, reported as variance.
- **Opening.** 40 @ 0.85 into an empty pool gives Q 40, V 34.0000, W 0.850000.
- **FOC.** RECEIPT 10 paid @ 1.20 + 1 FOC gives qty 11 and value 12.00, so the unit cost is 1.090909 and the WAC is diluted.
- **Landed cost.**
  - Lines A 100.00 and B 50.00, tax 9.00, delivery 6.00, discount 3.00. The net is +12.00, allocated pro-rata by line_total: A +8.00, B +4.00.
  - Landed values: A 108.00, B 54.00. Any remainder cent goes to the largest line.

### 5.5 Variances (D-55)
`revaluation_value ≠ 0` comes only from the `Q ≤ 0` paths, PENDING_COST true-ups and netted corrections. It's reported as "Cost variance" per branch × product × period, and appears in the OSEM-expense report footnote. I1 always holds.

### 5.6 Costing decisions
- **D-51:** A return from an issue comes back at the original issue cost.
- **D-52:** A return to supplier goes out at WAC, with the credit difference recorded as info.
- **D-53:** Write-offs and negative adjustments go out at WAC. Positive adjustments come in at WAC, then standard cost, then PENDING_COST.
- **D-54:** Branch transfers move at the source WAC, carrying the exact value.

### 5.7 Reversals and netted corrections (D-56, D-103)
- **D-56:** A reversal mirrors the original value.
- **D-103: a correction is applied to each pool once, as a net.**
  - Let the original txn's lines in a pool be `(q0, v0)` and the new txn's lines `(q1, v1)`.
  - Both the reversal and the new txn are written in full (audit), but the pool receives one update.
- **Inflow-type originals** (RECEIPT, OPENING, TRANSFER_IN, RETURN_FROM_ISSUE, +ADJUSTMENT), decomposed:
  - **Quantity part:** `dq = q1 − q0`, valued at `c1` if `dq > 0`, else at `c0`. It's applied through the normal inflow path, or the outflow-at-specified-cost path.
  - **Cost part:** `Δ = min(q0, q1) × (c1 − c0)`.
    - `share = min(1, Q_now / pool_qty_after_of_original_line)`.
    - `share × Δ` goes to pool V.
    - `(1 − share) × Δ` is excluded from V and recorded as `revaluation_value = −(1 − share) × Δ` on the correcting line. This is consumed-cost variance.
    - The share is proportional, which approximates FIFO-free consumption.
- **Outflow-type originals** (ISSUE, DAMAGED, TRANSFER_OUT, RETURN_TO_SUPPLIER, −ADJUSTMENT): `dq = q0_abs − q1_abs` (units coming back) and `dv = |v0| − q1 × W_now`. They're applied as one inflow (or outflow) at the specified cost, with W recomputed.
- **Worked (auditor F2).**
  - R1 100 @ 1.00, R2 100 @ 1.20, ISSUE 150 leaves Q 50, V 55, W 1.10.
  - Correct R2 to 100 @ 1.25: Δ = 100 × 0.05 = 5.00, share = 50/200 = 0.25.
  - V → 56.25 and W → 1.125. The new line has reval −3.75, the consumed-cost variance.
  - Net bucket qty change is 0, so there's **no negative-stock prompt** ✓.
- **Qty fix.** R2 corrected to 90 @ 1.20 gives a quantity part of −10 at 1.20 = −12.00, so Q 40, V 43.00, W 1.075.

### 5.8 Posting order and back-dating (D-57)
WAC follows posting order. Back-dating is allowed within an OPEN period, not before go-live, with a UI warning beyond 3 days. The Movement report recomputes running qty in `txn_date, id` order.

### 5.9 Precision (D-58)
- Quantities `numeric(18,4)`, unit cost and WAC `numeric(18,6)`, values `numeric(18,4)`.
- Receipt `line_total = round(qty_entered × unit_cost_entered, 2)`. The ledger value is `landed_value`, and `unit_cost = round(landed_value / qty_base, 6)`.
- Charges: `round(qty_base × unit_charge_price, 2)`.
- Postgres rounds half away from zero.
- **The TS layer does no cost maths.** It formats DB results and previews charge amounts only (§0 note 2).

---

## 6. Location model

- **D-20:** Each inventory branch has exactly one STORE, one FLOOR and one TRANSIT location. They're seeded for AMN, BMN, BGN and DEMO. HQ and AMP get none in V1 (Q-2).
- **D-21:** Transit is one location per branch, and its buckets are keyed by resident.
- **D-22 (revised by D-107 and D-124). Transit rules:**
  - **In:** `TRANSIT_ALLOCATE` (from S/F, resident ACTIVE and in the branch), receive & allocate, `RETURN_FROM_ISSUE` of that resident's issue, OPENING, or an approved +ADJUSTMENT on a counted T[r] bucket.
  - **Out:** an ISSUE with target RESIDENT = the bucket's resident, `TRANSIT_RELEASE` → STORE (HEAD_NURSE+, fixed reasons), `DAMAGED_EXPIRED`, or an approved −ADJUSTMENT.
  - **Never:** a generic internal transfer or branch transfer out of Transit, an issue to another resident, an issue to OSEM expense, or a negative balance (D-18).
- **D-23:** Receipts land in STORE only.
- **D-24:** Suggested order and max levels cover STORE + FLOOR only.
- **D-40 (defined): receive & allocate.** A receipt line with `allocate_resident_id` posts RECEIPT +q at S. The same RPC then posts one `TRANSIT_ALLOCATE` txn (−q at S, +q at T[r]) with `source_doc` = the receipt. They share one `request_key` and one lock plan. The receipt's reversal cascades (D-124).
- **D-107 (supersedes D-13): who owns a Transit bucket.**
  - The resident-in-branch check applies to **new allocations** and to issues from S/F.
  - For **outflows from an existing T[r] bucket**, the bucket's location, and so its branch, is authoritative whatever the resident's current branch. A resident moved to another branch never strands their Transit stock.
  - An issue from such a bucket still charges that resident, in the bucket's branch.
  - **Guard on the existing `tbl_residents`** (Q-12, needs owner approval): a `BEFORE UPDATE OF branch_id, status ON tbl_residents` trigger that raises `RESIDENT_HAS_TRANSIT_STOCK` on a branch change while any non-zero T[r] bucket exists. It doesn't block status changes.
  - Without that approval, the design still holds through the bucket-authoritative rule plus the exception list.
- **D-124 (Transit hardening):**
  - Release is HEAD_NURSE+ with the fixed reasons above.
  - Receipt reversal cascades to its allocation.
  - A `TRANSIT_ALLOCATE` of product P to resident B in the same branch within 7 days after a `TRANSIT_RELEASE` of P from resident A is **flagged** on the exception list. It's not blocked, because stock is fungible and "the released units" can't be traced reliably.
  - Transit buckets of residents who aren't ACTIVE, or have had no movement for 30 days, are listed on the dashboard and the exception list.

### 6.5 System of record per class of goods (D-3; business decision Q-27)

> **Rev 3: SUPERSEDED by D-136.** The owner answered Q-27: everything OSEM buys and charges back goes in Inventory; Medication Stock and Consumables are reminder tools only; no integration and no `goods_class`. The table below is kept for history.

This is the default, and the design works under it:

| Goods class | System of record | Inventory `goods_class` | Billable in Inventory |
|---|---|---|---|
| Family-supplied medication | **Medication Stock** (Sheet) | not stocked | no |
| OSEM-purchased medicine (floor/ward stock, OSEM-supplied resident meds) | **Inventory** | `OSEM_MEDICINE` | yes |
| Dressings | **Inventory** | `DRESSING` | yes |
| General consumables (gloves, wipes, diapers bought by OSEM) | **Inventory** | `OSEM_CONSUMABLE` | yes |
| Family-supplied consumables tracked per resident (weekly counts, family reminder) | **Consumables** (Sheet), unchanged | not stocked | no |
| Milk/feeds bought by OSEM | **Inventory** | `NUTRITION` | yes |
| Non-stock services (legacy `Service`, JOB) | **not in V1** (Q-32) | n/a | n/a |

- **Go-live checklist item:** no product is billable in both systems. Where Consumables tracks OSEM-supplied lines (`supplier = 'OSEM'`), billing for those items moves to Inventory from go-live, and Consumables keeps counting them for the family reminder only.

---

## 7. Charge model and billing periods

### 7.1 Charges
- **D-70:** Charges are created only by the engine:
  - `ISSUE` from issue lines
  - `RETURN_CREDIT` from RETURN_FROM_ISSUE
  - `REVERSAL` from reversals
  - `PRICING` from the MOD pricing of a PRICE_PENDING line (D-121)
  - `MANUAL_ADJUSTMENT` from a management correction (D-75)

  The target is chosen per issue. Never "sale".
- **D-71 (block rule SUPERSEDED by D-121):** price, name, SKU and UOM are frozen onto the charge. The amount is based on the issued base qty.
- **D-121: pricing rules.**
  - `is_chargeable = false` means a RESIDENT issue is blocked with `NOT_CHARGEABLE`, and the item goes to OSEM expense.
  - Chargeable with `charge_price` NULL means the issue is allowed, with `unit_charge_price` NULL and amount 0, which is PRICE_PENDING.
  - A MOD/ADMIN prices it in the Charges screen: a `PRICING` row with `related_charge_id`, `qty_base = 0`, `unit_charge_price = price`, `charge_amount = round(orig.qty × price, 2)` and a reason. There's at most one per original.
  - The period can't be locked while PRICE_PENDING rows exist.
  - Effective amount of a line = Σ over it and its children.
- **D-72:** A return credit uses the original frozen price, or the PRICING price if one exists.
- **D-73:** A charge belongs to the period of its own `charge_date`. Credits for locked months are booked in the current month and linked.

### 7.2 Periods
- **D-74:** A billing period is branch × KL calendar month, `OPEN → LOCKED`. Locking blocks **all** postings dated in that month. Reopen is ADMIN-only with a reason.
- **D-116: lock procedure** (`inv_lock_period`, MOD/ADMIN):
  1. The previous month must be LOCKED, unless it's the go-live month.
  2. `exceptions_reviewed_at` must be set (§7.3).
  3. There must be no PRICE_PENDING charges or UNRECONCILED (unacknowledged) receipts dated in the month, and no PENDING adjustments of the branch created on or before the month end. An approved adjustment posts dated on its approval day, per D-61.
  4. `inv_verify_balances(branch)` must be clean. **The lock is refused on drift**, and an ADMIN runs `fn_inv_rebuild_caches` (postgres) after investigating.
  5. Write `tbl_inv_period_closing` (`lock_seq = reopen_count`): per bucket, qty as of `txn_date ≤ end of month`; per pool, qty and value as of `txn_date ≤ end of month`.
  6. Set LOCKED.

  A reopen keeps the old closing rows (a new `lock_seq` on re-lock). The Valuation "as of month-end" report reads the latest `lock_seq`.
- **D-75:** Nothing in a LOCKED month is edited. Corrections post into the open month: reversal/correction, or MANUAL_ADJUSTMENT (MOD/ADMIN, reason, related charge).

### 7.3 Month-end exception review and export (D-108, D-122)
- **`v_inv_exceptions`** lists, per branch and month, grouped by `performed_by_staff` and flagged **"posted from branch login"** when `posted_by_account` has rights STAFF and no HEAD_NURSE grant:
  - DAMAGED_EXPIRED
  - TRANSIT_RELEASE and release→re-allocate within 7 days
  - negative-stock confirmations
  - inactive-resident issues
  - OSEM-expense issues above the threshold
  - PENDING_COST lines
  - PRICE_PENDING charges (blocking)
  - UNRECONCILED receipts (blocking until ack) and PROVISIONAL-cost receipts
  - sanity-confirmed lines
  - approved adjustments
  - stale Transit
- A MOD marks the list reviewed, which is required before lock.
- **Export (MOD/ADMIN):** CSV, UTF-8 with BOM. Each export writes `tbl_inv_charge_exports` plus `tbl_inv_charge_export_items`.
  - **Layouts:** ITEMISED (resident billing code, resident ID, name, date, SKU, product, qty, UOM, unit price, amount, kind, txn no., `related_charge_period`, `is_prior_period_credit`) and SUMMARY (one row per resident).
  - By default an export includes only charges not already in an earlier export for that period (the delta). A full re-export is allowed and flagged.
  - Residents without a billing code are listed as an error before export (`MISSING_BILLING_CODE`). The exact Bukku template is Q-25.

---

## 8. Permissions, RLS and security

### 8.1 Role resolution (`fn_inv_current_account()`, D-126, D-127)

**Account:** `tbl_user_accounts` with `auth_user_id = auth.uid()` and `status = 'ACTIVE'`. Otherwise nothing is allowed.

| Role | Resolved from |
|---|---|
| HQ_ADMIN | rights ADMIN **and** branch Function = HQ **and not** `is_demo` (D-102). Mirrors `isHqAdmin()`. |
| ADMIN | rights ADMIN (branch-scoped actions; only a demo ADMIN exists outside HQ) |
| MODERATOR | rights MODERATOR |
| HEAD_NURSE | an active `tbl_inv_account_roles` row whose `branch_id` = the account's **current** branch (D-127) |
| STAFF | any other ACTIVE account in a branch where inventory is enabled |

The TS mirror is `INVENTORY_PERMISSIONS` plus `isInventoryHqAdmin()` in `lib/inventory-core.ts`. Keep it in sync with SQL `fn_inv_can`.

### 8.2 Head Nurse identity (D-80; Q-1)

> **Rev 3: SUPERSEDED by D-134.** V1 keeps one shared login per nursing branch at Head-Nurse tier, with a senior performer picked from `tbl_staff`; no grant table and no login prerequisite. See §13.1.
- A branch login is shared, so a Head Nurse can't be identified from the login alone.
- **Design:** each Head Nurse gets her **own login** (STAFF rights at her branch), and ADMIN grants HEAD_NURSE in `/inventory/setup/roles`.
- **This is a go-live prerequisite per branch** (D-108, §10.2 step 6). The branch can't be enabled until at least one active HEAD_NURSE grant exists, and `inv_set_branch_settings` checks this.
- **Named-HN attribution check (Q-1b):** a named Head Nurse field must hold a staff member with position Head Nurse, Assist. Head Nurse or Nursing Director, or `role` ADMIN.
- **Rejected alternative:** making the Head Nurse a NUR-branch MODERATOR. That would break separation of duties and change what MODERATOR means across the app.

### 8.3 Scope (D-81, D-133)

> **Rev 3: scope formula SUPERSEDED by D-135** (keyed on branch Function: NUR own, HQ all real NUR, PHY none, demo pinned). See §13.1.
- `inv_accessible_branch_ids() returns bigint[]` (SECURITY DEFINER, `search_path = ''`, granted to `authenticated`):
  - a demo account → `{own branch}`
  - rights ADMIN or Function HQ → every branch with `not is_demo`, plus its own
  - otherwise → `{own branch}`
- **PHY (AMP) is excluded** from all-branch scope. This deliberately differs from `canAccessAllBranches()` and must be recorded in `docs/database.md` when implemented.
- TS mirror: `canAccessInventoryBranch(account, branchId)` in `lib/inventory-access.ts`.
- **Org-wide master data (D-102):**
  - Global rows (`owner_branch_id` NULL) can be changed only by HQ_ADMIN.
  - Demo-owned rows (`owner_branch_id` = a demo branch) can be changed only by an ADMIN of that demo branch.
  - Real-branch reads exclude demo-owned rows. The demo sees global plus its own, read-only for global.
  - Suppliers can also be created or edited by a HEAD_NURSE of a real branch (global rows only).

### 8.4 Action matrix

Every ✓ is also subject to the branch being in `inv_accessible_branch_ids()`. Column "HQ-A" means HQ_ADMIN.

| Action | STAFF | HN | MOD | ADMIN | HQ-A |
|---|---|---|---|---|---|
| View stock, movements (qty), transit, transfers, counts (after submit), suggested order | ✓ | ✓ | ✓ | ✓ | ✓ |
| View costs/valuation, receiving history, requests, near-expiry | – | ✓ | ✓ | ✓ | ✓ |
| View charges, OSEM expense, exceptions, audit log | – | – | ✓ | ✓ | ✓ |
| Issue; internal transfer; transit allocate; return from issue | ✓ | ✓ | ✓ | ✓ | ✓ |
| Transit release (fixed reasons) | – | ✓ | ✓ | ✓ | ✓ |
| Branch transfer dispatch / receive (full) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cancel a DISPATCHED transfer (source branch) | – | ✓ | ✓ | ✓ | ✓ |
| Damaged/expired ≤ threshold | ✓ | ✓ | ✓ | ✓ | ✓ |
| Write-off request > threshold (adjustment, reason DAMAGED/EXPIRED) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Confirm negative stock / inactive resident / sanity | ✓ | ✓ | ✓ | ✓ | ✓ |
| Count: create, start, enter, submit (blind) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Count: investigate, close; request adjustment (any reason) | – | ✓ | ✓ | ✓ | ✓ |
| Approve/reject adjustment (≠ requesting account) | – | – | ✓ | ✓ | ✓ |
| Receipt (incl. receive & allocate, DO); attach invoice; finalise PROVISIONAL cost; return to supplier | – | ✓ | ✓ | ✓ | ✓ |
| Acknowledge UNRECONCILED receipt (> RM 1.00 diff) | – | – | ✓ | ✓ | ✓ |
| Stock request create/submit/follow-up; close line short | – | ✓ | ✓ | ✓ | ✓ |
| Approve/reject/mark ordered a request (≠ creating account) | – | – | ✓ | ✓ | ✓ |
| Supplier create/edit (global) | – | ✓ (real branch) | – | – | ✓ |
| Attach a new barcode to an existing product | – | ✓ (real branch) | – | – | ✓ |
| Reverse / correct any txn (reversal posts into an open period) | – | – | ✓ | ✓ | ✓ |
| Reverse OPENING_BALANCE | – | – | – | ✓ | ✓ |
| Mark exceptions reviewed, lock period, price PRICE_PENDING, manual charge adjustment, export, resident billing codes | – | – | ✓ | ✓ | ✓ |
| Reopen a LOCKED period | – | – | – | ✓ | ✓ |
| Product master, UOMs, conversions, categories; barcode reassign/deactivate | – | – | – | demo-owned only | ✓ |
| Stock levels (max), opening balance, branch settings, grant/revoke HEAD_NURSE, verify balances | – | – | – | ✓ | ✓ |
| Rebuild caches, purge DEMO | postgres (SQL editor) only | | | | |

- **D-82: separation of duties.**
  - The adjustment approver account must differ from the requester account (CHECK). The approver staff member must differ from the requester staff member (RPC).
  - The request reviewer account must differ from the creator account.
  - A MOD acknowledging a reconciliation must be a different account from the one that received.
- **D-123:** an adjustment requester that is the same staff member as the linked count's counter gets a *warning*, not a block, while branches have a single HN.
- **D-83:** `AdminRecordControls` is never used on inventory records.

### 8.5 SQL helpers (D-126)
- All are `security definer`, `stable`, `set search_path = ''`, with schema-qualified names, and **none calls `auth_*()`**.
- **Internal, not granted to API roles:**
  - `fn_inv_current_account()`
  - `fn_inv_can(action)`
  - `fn_inv_require(action, branch)`: the branch comes from the row being acted on
  - `fn_inv_is_hq_admin()`
  - `fn_inv_today()` = `(now() at time zone 'Asia/Kuala_Lumpur')::date` (D-129)
  - the posting engine functions
- **Policy helpers**, SECURITY DEFINER, read-only, returning only facts about the caller, and **granted EXECUTE to `authenticated`** (D-114):
  - `inv_accessible_branch_ids()`
  - `inv_can_view_audit()`
  - `inv_is_hq_admin()`
  - `inv_is_admin()`
  - `inv_my_account_id()`

### 8.6 RLS (D-84, D-114, D-115)
- Every `tbl_inv_*` table has RLS enabled, a SELECT policy, and **no** INSERT/UPDATE/DELETE policies.
- **Branch-scoped tables, children included:** `using (branch_id = any ((select inv_accessible_branch_ids())))`. The subselect makes it an initplan, evaluated once per statement (Supabase guidance).
- **Branch transfers:** `from_branch_id = any(...) or to_branch_id = any(...)`. Their lines and receipts carry their own `branch_id`, but they're readable by either end through a policy on the parent ids (the lines carry `from`, the receipts carry `to`), so both lines and receipts use `exists (select 1 from tbl_inv_branch_transfers t where t.id = transfer_id and (t.from_branch_id = any(…) or t.to_branch_id = any(…)))`. Volume is small.
- **Master data** (products, product UOMs, barcodes, suppliers): `using (owner_branch_id is null or owner_branch_id = any ((select inv_accessible_branch_ids())))`. UOMs and categories: `using (true)` for `authenticated`.
- **`tbl_inv_account_roles`:** `using (account_id = (select inv_my_account_id()) or (select inv_is_hq_admin()) or ((select inv_is_admin()) and branch_id = any ((select inv_accessible_branch_ids()))))`. `inv_my_account_id()` and `inv_is_admin()` are further §8.5 policy helpers. Because a demo ADMIN's accessible set is only the demo branch, the DEMO ADMIN sees only demo grants.
- **Audit:** `using ((select inv_can_view_audit()) and (branch_id is null and owner_branch_id is null and (select inv_is_hq_admin()) or branch_id = any(...) or owner_branch_id = any(...)))`.
- **Idempotency:** no SELECT for anyone. The RPC reads it as definer.
- **Cost visibility:** a STAFF account can read cost columns through the API within its branch. That's accepted, and the UI hides them (Q-14).

### 8.7 Writes: RPC only (D-85)
- Every mutation goes through `inv_*` SECURITY DEFINER RPCs, called with the **user-session** client (`auth.uid()` = the real login). Never the service role.
- RPC order:
  1. validate payload shape
  2. `fn_inv_require`
  3. idempotency
  4. build the plan
  5. lock
  6. validate business rules
  7. write
  8. audit
  9. return
- Server Actions pre-check with the TS mirrors, as defence in depth.

### 8.8 Grants (D-86, D-125)
```sql
-- Per object only; never schema-wide and never ALTER DEFAULT PRIVILEGES.
revoke all on table tbl_inv_<t>, v_inv_<v> from anon;
revoke insert, update, delete, truncate, references, trigger on table tbl_inv_<t>, v_inv_<v> from authenticated;
grant select on table tbl_inv_<t>, v_inv_<v> to authenticated;
revoke all on sequence <every identity sequence owned by tbl_inv_*> from anon, authenticated;
revoke all on function fn_inv_<f>(...) from public, anon, authenticated;
revoke all on function inv_<f>(...) from public, anon;
grant execute on function inv_<f>(...) to authenticated;       -- RPCs + the §8.5 policy helpers
```
The read-back asserts that across `pg_class` relkinds `r`, `v` and `S` matching `%inv_%`, `anon` has no privilege, and that `anon` has no EXECUTE on `inv_%` or `fn_inv_%`.

### 8.9 Audit (D-90)
`tbl_inv_audit_log` gets one semantic event per business action, written by the RPC. It records account, `auth_user_id`, staff, request key, and before/after for master data. It's immutable and readable by MOD/ADMIN in scope, with global master-data rows readable by HQ_ADMIN. The generic `fn_audit_trigger` is not attached to inventory tables.

### 8.10 DEMO isolation
- **Seed:** locations and settings for DEMO.
- **Data:** `inv_accessible_branch_ids()` pins demo accounts to their own branch, and hides branch 6 from everyone else. RPCs use the same function.
- **Master data:** demo-owned rows are invisible to real branches, and global rows are read-only to the demo (D-102). The barcode map and product search for real branches filter `owner_branch_id is null`.
- **Transfers:** a transfer involving a demo branch requires **both** ends to be demo.
- **Pages:** the canonical three-line pattern everywhere, with the D-133 set-equality assertion.
- **Tests:** "the demo ADMIN can't call any global master-data RPC", "a demo-owned product doesn't appear in a real branch's search or barcode map", "the demo can't read real role grants".

---

## 9. UI route structure

### 9.1 Nav
- Add Inventory (`Package`, orange) after Physiotherapy.
- It's visible when the account's branch has inventory enabled or `inv_accessible_branch_ids()` includes an enabled branch. It's hidden for AMP.

### 9.2 Routes
The module tabs are **Stock · Receive · Issue · Transfers · Requests · Counts · Charges · Reports · Setup**. They're `<button>` tabs through `guardedAction(() => push(href))`. Branch is selected with `?branch=`, and the parent sets `key={branch}`.

| Route | Purpose |
|---|---|
| `/inventory/stock`, `/stock/[productId]` | balances (S/F/T), alerts panel (approvals, awaiting receipt, count due, stale transit, price pending, near expiry) |
| `/inventory/receive` | receipt: doc type (DO/Invoice/Cash bill), header totals and reconciliation, scan lines with FOC, batch/expiry, allocate-to-resident |
| `/inventory/receipts`, `/[id]` | history; attach invoice; finalise cost; reconciliation ack (MOD); reverse/correct (MOD) |
| `/inventory/issue` | fast issue |
| `/inventory/returns` | return from issue (resident or OSEM), return to supplier, damaged/expired (threshold → request) |
| `/inventory/transfers`, `/new?kind=internal\|allocate\|release\|branch`, `/[id]` | incl. the Floor top-up suggestion; branch receive/cancel |
| `/inventory/transit` | per-resident Transit |
| `/inventory/requests`, `/new`, `/[id]` | suggested order in purchase UOM, workflow, close short |
| `/inventory/counts`, `/new`, `/[id]` | due list, start (snapshot/freeze), blind entry, submit, investigate, create adjustment |
| `/inventory/adjustments`, `/[id]` | approvals |
| `/inventory/transactions/[id]` | txn detail and links; reverse/correct |
| `/inventory/charges` | month review, exceptions, price pending, lock, manual adjustment, billing codes, export |
| `/inventory/reports?report=…` | the V1 reports |
| `/inventory/setup/{products,suppliers,categories,uoms,locations,levels,roles,opening,settings}` | per the matrix |
| `/api/inventory/export/[report]` | CSV |

### 9.3 File layout
```
webapp/src/lib/inventory-core.ts      client-safe: types, {value,label} vocabularies, INVENTORY_PERMISSIONS, isInventoryHqAdmin,
                                      RPC result codes → i18n keys, UOM display, scanner-burst detector (pure)
webapp/src/lib/inventory-access.ts    server: canAccessInventoryBranch, loadInventoryRole
webapp/src/lib/inventory-server.ts    server-only loaders (never imported by "use client")
webapp/src/lib/inventory-rpc.ts       server-only typed supabase.rpc wrappers + one retry on 40P01/40001 (same key)
webapp/src/lib/i18n/dict-inventory.ts (+ translations.ts)
webapp/src/app/(app)/inventory/inventory-tabs.tsx
webapp/src/app/(app)/inventory/components/{barcode-input,scanner-capture,product-search,qty-uom-input,staff-select,
      resident-select,confirm-dialog (negative/sanity/inactive),txn-type-badge,branch-picker}.tsx
webapp/src/app/(app)/inventory/<area>/{page.tsx,loading.tsx,<area>-module.tsx,<area>-actions.ts}
webapp/src/app/api/inventory/export/[report]/route.ts
```

### 9.4 Form conventions
- `useTransition`, `useDirtyForm` (`onChangeCapture={markDirty}`, `markClean` on success and unmount), and `guardedAction` for tab and branch switches.
- Server Actions return `{ok, code}`, and the client renders `t(messageForCode(code))`.
- `{value,label}` + `t(label)` for every option list. DB lookups use `name_ms`.
- Theme tokens throughout, with `dark:` partners on status badges. Test in Light, Dark and System.
- Implementers must read `webapp/node_modules/next/dist/docs/` first (webapp/AGENTS.md).

### 9.5 Reports V1
Filters: branch, location, product, category, txn type, date range and resident. All are capped: a date range is required (≤ 366 days), 500 rows per page, and CSV export ≤ 20k rows.

| Report | Source | Min role |
|---|---|---|
| Stock Balance | `v_inv_stock_balance` | STAFF |
| Movement | lines (denormalised `txn_date`/`txn_type`, D-115) | STAFF |
| Valuation (current + as of month-end from closing) | pools, `v_inv_goods_awaiting_receipt`, `tbl_inv_period_closing`, variance | HN |
| Suggested Order (base + purchase UOM) | `v_inv_suggested_order` | STAFF |
| Receiving History (+ reconciliation, provisional) | receipts | HN |
| Transfers | lines + branch transfers | STAFF |
| Stock Requests | requests + progress | HN |
| Resident Charges | charges (effective amounts) | MOD |
| OSEM Operational Expense (+ variance footnote) | charges | MOD |
| Count / Variance (incl. "posted since start") | counts | STAFF (after submit) |
| Near-expiry received items (≤ 90 days) | receipt lines (D-120) | HN |
| Month-end exceptions | `v_inv_exceptions` | MOD |

### 9.6 Barcode and scanner UX (D-95, D-109, D-128). No new dependency.
- **D-95: preloaded map.** Active global product barcodes (and demo-owned ones for the demo) are passed from the server page into a `Map<barcode, {productId, uomId}>`, so lookup is instant.
  - Codes are normalised: exact, then UPC-A ↔ EAN-13 (add or remove a leading `0`).
  - A miss falls back to a Server Action lookup, then "Not found" with manual search.
  - **Not found → attach:** a HEAD_NURSE+ user may attach the code to an existing product. STAFF only sees "Not found".
- **D-109: scanner capture.**
  - On the Receive, Issue, Transfer and Count screens, a document-level `keydown` capture detects a burst of **≥ 6 chars with inter-key gap < 35 ms ending in Enter**. It routes the burst to the scan handler **whatever has focus**, and removes those characters from the focused input.
  - The scan box's Enter never submits the form.
  - Qty inputs reject more than 7 integer digits.
  - Receipt lines show cost per purchase UOM and per base UOM side by side, and show the last receipt cost and the WAC for comparison.
  - Scanners must send an Enter suffix, which goes in the setup notes.
- Scanning the same product+UOM again increments the qty, and a box barcode adds 1 BOX. Focus returns to the scan box. Manual search is a client-side filter, with a `pg_trgm` server fallback. Camera scanning is V2.

---

## 10. Migration plan

### 10.1 Files (rev 3: as written in Phase 1)

`schema/006` is the separate security-lockdown migration (not inventory). Inventory uses 007–012 (D-143).

| File | Content |
|---|---|
| `schema/007_inventory_schema.sql` | D-133 assertion; all §3 tables as revised in §13.2; indexes; immutability, document-transition, cache and master-data guard triggers |
| `schema/008_inventory_access.sql` | `fn_inv_current_account`, `inv_accessible_branch_ids`, `fn_inv_action_tier` / `fn_inv_rank_for_rights` / `fn_inv_can` (D-134, D-150), `fn_inv_check_staff`; RLS + SELECT policies; `v_inv_stock_balance`, `v_inv_suggested_order` |
| `schema/009_inventory_engine.sql` | payload readers, idempotency, WAC maths, lock plan, bucket check, writer, audit, verify/rebuild caches, DEMO purge |
| `schema/010_inventory_rpc_stock.sql` | receipt (+ receive & allocate), issue (+ charges), internal/allocate/release transfer, write-off, branch dispatch/receive/cancel |
| `schema/011_inventory_rpc_admin.sql` | reverse txn, netted receipt correction, service charge + reversal, exceptions review, period lock/reopen, verify balances |
| `schema/012_inventory_seed.sql` | UOMs (incl. JOB), the 5 categories, S/F/T for AMN/BMN/BGN/DEMO, branch settings (real branches disabled, DEMO enabled) |
| `schema/013_inventory_grants.sql` | **every** inventory grant/revoke, catalog-driven, ending in a read-back that aborts if anything is exposed. **Re-run after every inventory migration** (D-155, audit P1-17) |
| `migration/scripts/rollback_inventory_v1.sql` | drops every inventory object; refuses if **any** inventory table holds real-branch or global data, or anything non-inventory depends on it (D-154). **Pre-go-live only**; afterwards forward-fix only |
| `schema/tests/inventory/*` | Supabase + core-table stub, fixture, `inventory_v1_tests.sql` (§13.4) |
| `webapp/scripts/test-inventory.mjs` | the PGlite runner (`npm run test:inventory`) |

Each file is `begin; … commit;` and re-runnable (the test runner applies them twice). Existing tables are only referenced by FKs. The optional `tbl_residents` transit guard (D-107, Q-12) is **not** written yet: it alters an existing table and ships as its own migration only after the owner confirms Q-12 explicitly.

### 10.2 Applying (docs/deployment.md)
1. Run the tests on the local Supabase CLI stack (Q-24): 001–005 plus live-drift scripts, then 006–009, then both test files.
2. With the user's explicit confirmation, apply 006–009 (and 010 if approved) to production.
3. Read back: tables, policies, grants (anon has none), triggers, seed counts, demo set equality.
4. Deploy the webapp. The nav is hidden until a branch is enabled.
5. Smoke test on DEMO as `test`.
6. **Go-live per branch** (ADMIN):
   - Prerequisites: an individual Head Nurse login + HEAD_NURSE grant (D-108); resident billing codes loaded (D-122); the D-3 checklist (no product billable in two systems); products, prices and max levels set.
   - Then set `go_live_date`, enter opening balances within the window (D-117), and set `is_enabled = true`. The RPC checks these prerequisites.

### 10.3 Test data cleanup
Production verification happens only in DEMO. Cleanup is `select fn_inv_purge_demo();` from the SQL editor (session user postgres). Real mistakes are reversed, never deleted.

---

## 11. Open questions: owner answers (rev 3)

Answered 2026-09-29. Each item shows the **decision** and the D-n that records it. Items marked *default — not explicitly confirmed by owner* follow the rev-2 recommended default, which the owner accepted in bulk ("adopt your recommended default") without answering them one by one.

### 11.1 Were blocking the Phase 1 schema
1. **Q-4: WAC scope. ANSWERED: one WAC pool per product per branch.** D-50 confirmed.
2. **Q-29: expiry and controlled drugs. ANSWERED: batch/expiry maybe later, not now.** No batch/expiry columns in V1 and no near-expiry report; no controlled-drug register. The design stays extensible (batch can later become receipt-line columns, then a bucket dimension). D-139 (supersedes D-120).
3. **Q-27: system of record. ANSWERED: everything OSEM buys and sells/charges back to residents goes in Inventory.** Medication Stock and family Consumables are reminder tools only, not inventory systems. No integration with them. D-136 (supersedes D-3).
4. **Q-28: Transit purchases. ANSWERED: charged at issue, at the catalogue charge price.** Current D-70/D-71 behaviour confirmed.
5. **Q-3: branch transfers. ANSWERED: two-step (dispatch, then receive all-or-nothing).** D-32/D-33/D-113 confirmed. A discrepancy becomes an adjustment request at the destination (default; the adjustment RPC is Phase 7).
6. **Q-31: price changes. ANSWERED: no effective date; a new price applies from save.** Charges freeze the price at posting (D-71).
7. **Q-26: delivery before invoice. ANSWERED: not applicable; receipts require the invoice.** D-138.
8. **Q-11: SST, discounts, delivery, FOC. ANSWERED: SST, discounts and delivery are spread into item cost pro-rata.** FOC qty at zero cost stays (default). **No invoice-mismatch handling** (no UNRECONCILED status, no acknowledgement, no month-lock block). D-138.
9. **Q-18: max levels and Suggested Order. ANSWERED: agreed** — separate Store/Floor default max with per-location overrides; Suggested Order subtracts approved-but-undelivered quantities; shown in purchase UOM and base. D-101/D-119 confirmed (implemented in `v_inv_suggested_order`).
10. **Q-2: HQ and physio stock. ANSWERED: no stock locations for HQ or the physio hub.** D-140. Plus the owner's access clarification: PHY branches do not use Inventory at all (D-135).
11. **Q-16: categories. ANSWERED: exactly 5 — Consumables, Dressing Items, Medicine, Service, Others.** Service is in scope as a non-stock product type. D-137.
12. **Q-17: suppliers. ANSWERED: one org-wide supplier list.** Editable by HQ ADMIN and by a real branch's login at Head-Nurse tier with a senior staff member attributed (D-134); supplier RPCs are Phase 2.
13. **Q-24: where to run database tests. ANSWERED: "do what is best for the project".** D-141: PGlite in-process (no Docker on this machine), never production; the local Supabase CLI stack remains the pre-production step once Docker is available.

### 11.2 Were blocking go-live or a later phase
14. **Q-1: Head Nurse logins. ANSWERED: each nursing branch keeps ONE shared STAFF login for now; individual Head Nurse logins are a later deployment.** Head-Nurse-tier actions are permitted to the branch login in V1, with the real person attributed via a `tbl_staff` picker restricted to Head Nurse / Assist. Head Nurse / Nursing Director (or staff role ADMIN). Every capability check goes through `fn_inv_can(action, branch_id)` (tiers in `fn_inv_action_tier`, login rank in `fn_inv_rank_for_rights`), so switching to individual logins later is a one-place change. No role-grant table (YAGNI). MODERATOR/ADMIN approvals stay tied to MODERATOR/ADMIN logins. D-134 (supersedes D-80, D-127; amends D-108).
15. **Q-7: write-off approval.** Staff post write-offs up to RM 50 per transaction at cost; above that the RPC returns `WRITE_OFF_NEEDS_APPROVAL` (adjustment request, MODERATOR approval). *Default — not explicitly confirmed by owner.*
16. **Q-8: no charge price.** Issue allowed, PRICE_PENDING, priced by MOD before lock; `is_chargeable = false` blocks resident issues. *Default — not explicitly confirmed by owner.*
17. **Q-32: service charges.** **Superseded by the Q-16 answer:** services are in V1 as non-stock products (D-137).
18. **Q-25: Bukku.** No integration; CSV export with a per-resident billing code. *Default — not explicitly confirmed by owner* (template still wanted, Phase 8).
19. **Q-12: residents changing branch with Transit stock.** Guard trigger on `tbl_residents`. *Default — not explicitly confirmed by owner.* Because it alters an existing table it is **not** in the Phase 1 files; it ships as its own migration once the owner confirms explicitly. Until then the bucket-authoritative rule (D-107) keeps Transit stock usable.
20. **Q-30: freezing the Store during the monthly count.** On by default for monthly Store counts. *Default — not explicitly confirmed by owner.* (Phase 1 already honours `freeze_location` on postings.)
21. **Q-9: period lock scope.** Whole branch-month; ADMIN reopen with reason; previous month locked first. *Default — not explicitly confirmed by owner.* Rev 3 adds: only a month that has ended can be locked, and only the latest locked month can be reopened (D-145).
22. **Q-10: back-dating.** Within an open month, not future, not before go-live (UI warns beyond 3 days). *Default — not explicitly confirmed by owner.*
23. **Q-13: reverse/correct.** MODERATOR and ADMIN. (The Head-Nurse "finalise provisional cost" case no longer exists, D-138.) *Default — not explicitly confirmed by owner.*
24. **Q-14: cost visibility.** Hidden in the UI only. *Default — not explicitly confirmed by owner.*
25. **Q-5 / Q-6: return costing.** Return to supplier at WAC; return from issue at original cost and original price. *Default — not explicitly confirmed by owner.*
26. **Q-19: OSEM expense detail.** Free-text note per issue. *Default — not explicitly confirmed by owner.*
27. **Q-20: TS tests.** Dev-only test dependencies approved; Phase 1 adds only `@electric-sql/pglite` (SQL tests), `vitest` arrives with `inventory-core.ts` in Phase 3. *Default — not explicitly confirmed by owner.*
28. **Q-21: DEMO purge.** Immutability exception for DEMO rows only, SQL editor only (`fn_inv_purge_demo`). *Default — not explicitly confirmed by owner.*
29. **Q-22: label clash.** Relabel Residents › Consumables › "Inventory" to "Weekly Count" in a separate change. *Default — not explicitly confirmed by owner.*
30. **Q-15: legacy empty inventory tables.** Drop later in a separately approved migration. *Default — not explicitly confirmed by owner.*
31. **Q-23: out-of-scope security.** Being handled by the separate security-lockdown migration (`schema/006`, reserved). *Default — not explicitly confirmed by owner.*
32. **Q-33 (audit V-2): valuing free (FOC) goods received while stock is negative.** Needs the owner / accounts. Example: 3 units were issued at RM 1.00 while stock was at −3, then 10 free units arrive. Three policies keep the total value right and only split it differently between stock and what was consumed:
    - **(a) current, D-149:** the 7 remaining units stay at RM 1.00 (stock RM 7.00, a +RM 10.00 revaluation gain);
    - (b) the pre-rev-3.1 rule (D-55, incoming cost replaces): the remaining units cost 0 and the 3 consumed are re-costed to 0 (+RM 3.00);
    - (c) a hindsight average over the whole sequence (the auditor worked this example to stock RM 3.50).
    Default kept: (a). Not a blocker; it only matters when FOC arrives while stock is negative.

---

## 12. Implementation phases

| Phase | Scope | Files |
|---|---|---|
| **1: DB foundation + core engine** (rev 3: old phases 1 and 2 merged; **done**, see §13) | all DDL, RLS, grants, triggers, seed, WAC engine, the core RPCs, SQL tests | `schema/007`–`013`, `schema/tests/inventory/*`, `migration/scripts/rollback_inventory_v1.sql`, `webapp/scripts/test-inventory.mjs` |
| **2: Remaining RPCs** | master data (products, UOM conversions, barcodes, suppliers, levels, settings, billing codes), opening balance (D-117), plus the RPCs listed as deferred in §13.3; concurrency test on a local Supabase stack | new `schema/014+` files (each ending with `fn_inv_lockdown()`, then re-run 013), `schema/tests/inventory/*` |
| **3: App shell + setup** | nav, tabs, access/core/server/rpc libs, i18n, products (UOMs, conversions, barcodes, prices, goods class), categories, UOMs, suppliers, levels, roles, settings, billing codes | `(app)/layout.tsx`, `components/sidebar.tsx`, `lib/inventory-{core,access,server,rpc}.ts`, `lib/i18n/{dict-inventory,translations}.ts`, `(app)/inventory/{inventory-tabs.tsx,page.tsx}`, `(app)/inventory/setup/**`, shared components |
| **4: Opening + stock + scanning** | opening grid/CSV within the window, stock views, barcode/scanner capture | `(app)/inventory/setup/opening/**`, `(app)/inventory/stock/**`, `components/{barcode-input,scanner-capture,confirm-dialog}.tsx` |
| **5: Receiving + requests** | DO/invoice/cash bill, landed cost, FOC, batch/expiry, receive & allocate, attach invoice, finalise cost, reconciliation; requests with purchase-UOM suggestions and close short | `(app)/inventory/{receive,receipts,requests}/**` |
| **6: Issue, transit, transfers, returns, write-offs** | fast issue + charges (PRICE_PENDING), transit, internal/branch transfers (full receive, cancel), returns from issue and to supplier, threshold write-offs | `(app)/inventory/{issue,transit,transfers,returns}/**` |
| **7: Counts, adjustments, corrections** | start/snapshot/freeze, blind entry, investigation, adjustments, txn detail with reverse/correct | `(app)/inventory/{counts,adjustments,transactions}/**` |
| **8: Charges, reports, hardening** | exceptions review, pricing, lock/reopen with closing, exports with batches, the 12 reports, perf caps, i18n check, theme QA, docs | `(app)/inventory/{charges,reports}/**`, `app/api/inventory/export/[report]/route.ts`, `docs/inventory.md`, `CLAUDE.md` (link), `docs/database.md` (DEMO list + PHY-exclusion note) |

Gates for every phase:
- `npm run lint`, `npx tsc --noEmit -p .` and `npm run check:i18n`
- `next build` for any client or import change
- the SQL suite (and the concurrency script for engine changes)

Phase 2 must be green before any UI posts to it.

---

## 13. Phase 1 implementation (rev 3)

Written 2026-09-29 as `schema/007`–`012`. **Not applied to production.** Applying needs the owner's explicit go-ahead (§10.2).

### 13.1 Access model as built (D-134, D-135)

| Login | Scope (`inv_accessible_branch_ids()`) | Rank (`fn_inv_rank_for_rights`) |
|---|---|---|
| NUR branch STAFF login (shared) | own branch | 2 = Head-Nurse tier (V1) |
| HQ STAFF (none exists today) | every non-demo NUR branch, **read-only** | 0 — no action at all (D-150) |
| HQ MODERATOR | every non-demo NUR branch | 3 |
| HQ ADMIN | every non-demo NUR branch | 4 (+ HQ-admin for global master data) |
| DEMO `test` (ADMIN) | the demo branch only | 4 inside DEMO; never HQ-admin |
| PHY branch login | **none** — no rows, not even the catalogue | 0 |

- `fn_inv_action_tier(action)` holds the whole action → tier table (1 staff, 2 Head Nurse, 3 moderator, 4 admin, 5 HQ admin). `fn_inv_can(action, branch_id)` = active login + branch in scope + rank ≥ tier. Every RPC calls it with the branch taken from the row it acts on.
- Tier-2 actions (receipt, transit release, cancel dispatch, return to supplier, stock requests, count investigation, adjustment request, supplier edit, barcode attach) additionally require the performer (`tbl_staff`) to be Head Nurse / Assist. Head Nurse / Nursing Director or staff role ADMIN (`fn_inv_check_staff`). Every performer must be ACTIVE and belong to the branch or to HQ (HQ staff never for DEMO).
- **Switching to individual Head Nurse logins later** = change `fn_inv_rank_for_rights('STAFF')` to 1 and resolve rank 2 from a grant. Nothing else changes.
- **Service (D-137).** The SERVICE category has `is_service = true`; its products have `is_stock_item = false` (trigger-enforced) and no max levels. Stock RPCs reject them (`NOT_STOCK_ITEM`), `inv_charge_service` rejects stock items (`NOT_SERVICE_ITEM`). A service charge is a `tbl_inv_charges` row of kind `SERVICE` with no txn/line, frozen price, PRICE_PENDING when unpriced; OSEM-expense target → amount 0, cost at `standard_unit_cost`. Service products never get a pool, bucket, count line or suggested-order row.

### 13.2 Schema deviations from the §3 sketch

- **Dropped:** `tbl_inv_account_roles` (D-134), `products.goods_class` (D-136), receipt DO/provisional/reconciliation columns and `grand_total` (D-138), receipt-line `batch_no`/`expiry_date` and the near-expiry index (D-139).
- **Added:** `categories.is_service`, `products.is_stock_item` (D-137); `txn_lines.location_kind` with CHECK "resident iff TRANSIT"; `txns.expense_note`; `receipts.landed_total` (CHECK = lines − discount + tax + charges + rounding), `receipts.corrects_receipt_id`; `branch_transfers.from_location_id`/`to_location_id`/`remarks`; `branch_transfer_lines.line_no`; `charges.request_key` (links SERVICE charges to their call); `audit_log.db_user`, `account_id` nullable (postgres maintenance rows).
- `tbl_inv_charges` kinds gain `SERVICE`; a REVERSAL of a service or PRICING charge has no txn line. Unique partial indexes: one charge per txn line, one PRICING and one REVERSAL per related charge.
- Guards (D-19, D-144): append-only tables block UPDATE/DELETE/TRUNCATE; document tables accept UPDATE only with `inv.posting = 'on'` and only whitelisted columns/transitions (generated columns ignored); caches/counters only inside the engine; master data never deleted; D-106 UOM immutability; D-102 owner rules; D-140 NUR-only locations/settings. The DEMO purge is the only DELETE path (`session_user = 'postgres'`).
- RLS: SELECT-only everywhere; `branch_id = any ((select inv_accessible_branch_ids())::bigint[])` (the cast keeps it an init-plan); charges from rank 2 (**D-148, confirm with owner**); resident billing codes and exports rank 3; audit rank 3; counters and idempotency invisible.
- Grants (D-146): `anon`, `authenticated`, `service_role` lose everything on inventory tables/views/sequences; `authenticated` gets SELECT and EXECUTE on `inv_*` only. No temp tables in definer code (nothing a caller could pre-create). Since rev 3.1 all of it lives in `013_inventory_grants.sql` (D-155).
- Rev 3.1 columns: `tbl_inv_period_closing.in_transit_transfer_id` (D-153); `tbl_inv_receipts.invoice_total_paper` (information only, D-138/P1-18); `tbl_inv_charges.created_at` defaults to `clock_timestamp()` (review watermark, D-151).
- Valuation totals must come from `tbl_inv_cost_pools.value` (or the closing pool rows plus in-transit rows). `v_inv_stock_balance.value_at_wac` is indicative per bucket and will not tie to the pool because of rounding, negative buckets and unknown (PENDING) cost (audit P1-20).

### 13.3 What Phase 1 implements, and what it defers

| Implemented RPC | Notes |
|---|---|
| `inv_post_receipt` | invoice mandatory; landed cost; FOC; sanity (qty, line total > 5000, cost > 50% from both last cost and WAC); duplicate invoice by normalised key; optional receive & allocate (active resident of the branch) |
| `inv_post_issue` | STORE/FLOOR/TRANSIT; RESIDENT or OSEM_EXPENSE; charges with frozen price; PRICE_PENDING; `NOT_CHARGEABLE`; inactive-resident confirm; Transit only to the bucket's resident (bucket authoritative, D-107) |
| `inv_post_transfer` | INTERNAL (S↔F), ALLOCATE, RELEASE (tier 2, fixed reasons) |
| `inv_post_write_off` | DAMAGED/EXPIRED ≤ branch threshold at WAC, else `WRITE_OFF_NEEDS_APPROVAL` |
| `inv_dispatch_branch_transfer` / `inv_receive_branch_transfer` / `inv_cancel_branch_transfer` | all-or-nothing receive at the dispatched cost; append-only receive rows; cancel only while DISPATCHED (tier 2); demo↔demo only |
| `inv_reverse_txn` | MOD/ADMIN; receipt → voids + cascades its allocations (`TRANSIT_STOCK_USED` if the allocated stock was used); transfer-in → back to DISPATCHED; charges (and PRICING children) credited in the reversal's period |
| `inv_correct_receipt` | D-103 netting; see D-142 |
| `inv_charge_service`, `inv_reverse_charge` | D-137 |
| `inv_mark_exceptions_reviewed`, `inv_lock_period`, `inv_reopen_period` | D-116 minus reconciliation (D-138), plus D-145; closing snapshot per lock (`lock_seq`) |
| `inv_verify_balances` | ADMIN; `fn_inv_rebuild_caches` / `fn_inv_purge_demo` are SQL-editor only |

**Deferred** (tables exist, RPCs do not): opening balance (D-117), return from issue / to supplier, counts START/SUBMIT/investigate and adjustments request/approve, stock-request workflow (and receipt ↔ request links), PRICING and MANUAL_ADJUSTMENT charges, exports, all master-data RPCs, `v_inv_exceptions` / other §3.9 views, the Q-12 resident guard, the two-session concurrency test. **None of these may stay deferred once a real branch is enabled: see §13.6.**

Engine notes: the lock plan (`fn_inv_lock`) takes periods → locations → pools → buckets → counters in sorted order before any write; document headers are locked by the RPC first. A PENDING_COST outflow keeps the pool WAC NULL (D-147). Every business rejection is returned as `{ok:false, code}` before anything is posted and is not stored for idempotency; any error after the first write raises and rolls the call back.

### 13.4 Tests (D-141)

```
cd webapp
npm run test:inventory                 # everything
npm run test:inventory -- "Transit"    # tests whose name contains "Transit"
```

- Runs on **PGlite** (`@electric-sql/pglite`, Postgres 18 in WASM, dev dependency) in-process: no Docker (not installed on the dev machine), no network, and it never connects to Supabase.
- `schema/tests/inventory/00_supabase_stub.sql` recreates what the migrations depend on, with live shapes and ids: roles `anon`/`authenticated`/`service_role`, `auth.uid()` (live definition), the live default ACL (so the revokes are really tested), `pg_trgm`, the five core tables, and the objects `schema/006_security_lockdown.sql` alters. The runner applies **006 + 007…013 twice** (re-runnability) and the fixture (`01_fixture.sql`), then snapshots the data directory.
- **Every `-- @test` block runs in its own fresh database session** loaded from that snapshot, inside `BEGIN … ROLLBACK` (audit P1-9). A shared session once hid P1-1 (a PL/pgSQL plan-cache bug that only shows on the first call in a backend); re-introducing that bug now fails 6 tests.
- The fixture replaces `fn_inv_today()` with a test-only version that honours `inv.test_today` (`tests.freeze_today(date)`), so date-edge tests don't depend on the calendar. Production keeps the 009 version.
- The rollback script is tested three ways: clean install → drops everything and re-applies; one real-branch service charge → refused (`INV_ROLLBACK`, names `tbl_inv_charges`); owner override → drops.
- The runner also applies 007 … 013 **one file at a time** on a fresh database and, after each, checks that anon/authenticated/service_role can reach nothing inventory and RLS is on (D-156); and it checks the production `fn_inv_today()` once (V-4).
- Rev 3.2 result: **58 passed, 0 failed** (2 install checks, 44 SQL test blocks, 3 rollback checks, 8 staged-apply checks, 1 production-clock check).
- Coverage: WAC (100 @ 1.00 + 100 @ 1.20 = 1.10, purchase-UOM conversion, §5.4 examples incl. rounding residue), landed cost and FOC, S↔F and branch↔branch transfers, negative-stock confirm and true-up, PENDING_COST / MASTER_FALLBACK, Transit rules, receive & allocate + cascade, reversal, F2 netted correction (cost, quantity, product, net-negative), immutability and guards, idempotency (replay, reused key, confirm round-trip), Service products, price freeze / PRICE_PENDING / not chargeable, period lock/reopen/closing, drift refusal + rebuild, write-off threshold, count freeze, payload/date/attribution validation, RLS per branch, PHY no access, DEMO isolation, capability matrix, anon and grant read-back, DEMO purge.
- **Not covered here:** concurrency/deadlocks (PGlite is single-connection); commit-visible behaviour of rejected calls under PostgREST (mitigated by the read-only pre-checks, D-155); duration of `inv_lock_period` on a large branch. All three are go-live gates (§13.6).
- PGlite is Postgres 18; live is 17.6. Nothing used is 18-only (`unique nulls not distinct` is 15+).


### 13.5 Phase 1 audit: finding → fix (rev 3.1)

| Finding | Sev | Status | Fix | Test |
|---|---|---|---|---|
| P1-1 `inv_reverse_txn` fails on a fresh connection | HIGH | **Fixed** | transfer id/status read into scalars; the transfer-in check is a nested `if`. Writer uses one record per result shape | "P1-1 regression" ×2 (fresh session, first reversal of an ISSUE / a RECEIPT) |
| P1-2 stale month-end review | HIGH | **Fixed** (D-151) | review only once the month has ended; watermark = `clock_timestamp()` under the period lock; lock refuses `EXCEPTIONS_STALE` if any txn/charge of the month is later. The exception *view* itself is a go-live gate (§13.6) | "P1-2" (auditor's back-dated 500-unit probe, late service charge, frozen-clock month edge) |
| P1-3 zero-value inflow resets WAC to 0 | MED | **Fixed** (D-149) | `fn_inv_pool_in`: when the value is 0 and Q ≤ 0, keep W (NULL stays NULL) | "P1-3" (maths, FOC into −3 @ 1.00, PENDING reversal stays PENDING) |
| P1-4 HQ STAFF gets Head-Nurse tier | MED | **Fixed** (D-150) | `fn_inv_rank_for_rights(rights, branch_function)`: rank 2 only for NUR STAFF; others 0 | "P1-4" |
| P1-5 write-off threshold split / uncosted at 0 | MED | **Fixed** (D-152) | cumulative per branch per KL posting day; uncosted lines always need approval; checked read-only and again under lock | "P1-5" (2 × 49.50, back-dating, reversal frees budget, 900 uncosted units) |
| P1-6 goods in transit missing at close | MED | **Fixed** (D-153) | in-transit closing rows on the dispatching branch | "P1-6" (60 + 40 = 100) |
| P1-7 charge credit dated before the charge | MED | **Fixed** (D-145) | `DATE_BEFORE_ORIGINAL` in `inv_reverse_charge` | "P1-7" |
| P1-8 rollback guard only checks the ledger | MED | **Fixed** (D-154) | any real/global row in any inventory table, plus non-inventory dependents | runner: 3 rollback checks |
| P1-9 harness shares one session | MED | **Fixed** (D-155) | fresh PGlite session per test from a post-fixture snapshot; test clock override. Concurrency remains a local-Supabase gate | mutation check: re-introducing P1-1 fails 6 tests |
| P1-10 missing tests | MED | **Mostly fixed** | added: reversals of INTERNAL/ALLOCATE/RELEASE/DAMAGED after the WAC moved; reversal of a corrected receipt; released allocation → `TRANSIT_STOCK_USED` (renamed from `TRANSIT_ALREADY_ISSUED`); plus every fix above. **Deferred:** the four concurrency cases and the 60k-line lock timing, which need the local Supabase stack (§13.6) | "P1-10" ×2 |
| P1-11 go-live gate not stated | MED | **Fixed** | §13.6 | n/a |
| P1-12 charges readable by the branch login | LOW | **Open: owner question D-148** | unchanged; switching to MOD-only is one literal in 008 | n/a |
| P1-13 rejected calls leave rows | LOW | **Fixed** (D-155) | read-only pre-checks (`fn_inv_state_problem`, bucket check, sanity, write-off limit) before the lock plan inserts anything; the lock plan re-checks | "P1-13" |
| P1-14 ids enumerable across branches | LOW | **Fixed** (D-155) | unknown primary id (location, transfer, txn, receipt, charge, service resident) returns `FORBIDDEN`. Residual: resident ids in issue/transfer payloads still distinguish "not found" from "wrong branch" (kept for D-107 bucket-authoritative Transit) | "P1-14" |
| P1-15 live-apply notes | LOW | **Fixed / documented** | `set local lock_timeout = '5s'` at the top of 007; the rest in §13.7 | n/a |
| P1-16 stale 007 header | LOW | **Fixed** | file map 007–013 | n/a |
| P1-17 grant drift | LOW | **Fixed** (D-155) | all grants in `013_inventory_grants.sql`, catalog-driven, with an aborting read-back; per-file loops removed | "P1-17", "anon and grants" |
| P1-18 paper invoice total | LOW | **Fixed** | `invoice_total_paper` (optional, information only); result returns `paper_difference` | "P1-18" |
| P1-19 raw unique_violation on concurrent duplicate | LOW | **Fixed** | the receipt write is one sub-block; `uq_inv_receipts_invoice` → `DUPLICATE_INVOICE`, ledger rows undone. Not reproducible in one session; verify in the concurrency run | (concurrency gate) |
| P1-20 bucket value ≠ pool value | LOW | **Documented** | §13.2: valuation totals from pools/closing | n/a |
| V-1 exposure window between files | MED | **Fixed** (D-156) | 007 defines `fn_inv_lockdown()` (RLS on every `tbl_inv_*`, no privilege for PUBLIC/anon/authenticated/service_role on any inventory table, view, sequence or function) and 007–012 each call it before COMMIT; 013 is the only file that grants, and it checks the result. Plus: apply 007–013 in one transaction (§13.7) | runner "staged apply" ×8 (each file applied alone, cumulatively; an anon INSERT after 007 is refused). Removing the call from one file makes the check fail |
| V-2 FOC valuation policy at Q < 0 | LOW | **Owner question Q-33** | D-149 kept as the default | n/a |
| V-3 leftover rows when the write-off limit is crossed only under the lock | LOW | **Documented** | a rare race: the empty pool/bucket/period rows the lock plan inserted stay (harmless, zero qty, no drift) | n/a |
| V-4 suite never runs the production `fn_inv_today()` | LOW | **Fixed** | runner checks the 009 definition (no test override) returns the Asia/Kuala_Lumpur date | runner "fn_inv_today()" |

### 13.6 Go-live gate: no real branch gets `is_enabled = true` until all of these are done

Applying 007–013 to production is safe before this (only DEMO is enabled by the seed). Enabling AMN, BMN or BGN is not.

1. **RPCs that exist and are tested:**
   - master data: products, UOM conversions, barcodes, suppliers, categories/UOMs (HQ admin), max levels, branch settings (`inv_set_branch_settings` must check this list), resident billing codes
   - opening balance (D-117)
   - PRICING of PRICE_PENDING charges and MANUAL_ADJUSTMENT (otherwise a pending charge can only be reversed, and it blocks the lock)
   - return from issue, return to supplier
   - counts (START/enter/SUBMIT/investigate) and adjustments (request/approve), including the write-off-above-threshold path that `WRITE_OFF_NEEDS_APPROVAL` points to
   - stock-request workflow
   - `v_inv_exceptions` and the review screen that shows it: `inv_mark_exceptions_reviewed` must only be offered after the list has been displayed (P1-2)
   - charge export (Bukku CSV)
2. **Local Supabase CLI stack run** (Docker): the same 006–013 + the SQL suite, plus a two-session script covering: two receipts of the same invoice (expect `DUPLICATE_INVOICE`), two issues of the last unit, `inv_lock_period` vs a posting in the same month, cancel vs receive of one transfer, and crossed product sets (no deadlock).
3. **Performance:** `inv_lock_period` and `inv_verify_balances` on a synthetic 60k-line branch under the live `authenticated` 8 s statement timeout.
4. **Owner answers:** D-148 (charge visibility), Q-12 (resident guard), the defaults marked "not explicitly confirmed".
5. **Audit findings:** P1-1 … P1-8 closed (done in rev 3.1; re-audit).
6. App side (Phase 3+): nav hidden for PHY; Server Actions map every RPC code to an i18n message; the idempotency key is regenerated per the §4.5 rules.

### 13.7 Apply checklist (production, with the owner's explicit go-ahead)

1. Quiet window. Apply `007` → `013` **in a single transaction**: paste the seven files into one SQL-editor run (or one `apply_migration`) with the per-file `begin;` / `commit;` lines removed and one `begin;` … `commit;` around the whole, from the SQL editor (session user `postgres`). Each file is also safe on its own since rev 3.2 (D-156: nothing is reachable through the API until 013), so an interrupted apply fails closed, but a single transaction avoids a half-installed module. 007 sets `lock_timeout = 5s` because its FKs lock `tbl_branches`, `tbl_staff`, `tbl_residents` and `tbl_user_accounts` until commit; if it times out, retry later. Any future inventory migration: end it with `select public.fn_inv_lockdown();` and re-run 013 after it.
2. Read back:
   - `select proname from pg_proc where (proname like 'inv\_%' or proname like 'fn\_inv\_%') and proowner <> 'postgres'::regrole` returns no rows (definer semantics depend on the owner)
   - 013's read-back passed (it aborts otherwise); run the Supabase security advisor
   - seed counts: 15 UOMs, 5 categories, 12 locations, 4 settings rows (only DEMO enabled)
3. **Re-run `013_inventory_grants.sql` after every future inventory migration.** `create table if not exists` never alters an existing table, so every schema change after the first apply must be a new numbered file.
4. The new FKs make hard deletes of residents, staff, accounts and auth users with inventory history fail (intended). The `migration/scripts/cleanup_test_*` scripts and dashboard "delete user" then need `select fn_inv_purge_demo();` first for DEMO data. **Add this note to `docs/database.md`** (not edited in this change, by instruction).
5. Rollback is only possible while no real data exists (D-154).

---

## Appendix A. Decision register

| D | Decision | Status | § |
|---|---|---|---|
| D-1 | Don't build on Medication Stock / Consumables / Purchase | active | 1.1 |
| D-2 | Don't reuse the dormant 001_init inventory objects; `inv` prefixes | active | 1.2 |
| D-3 | System of record per class of goods | **SUPERSEDED by D-136** | 6.5 |
| D-10 | Header + per-leg lines; text + CHECK vocabularies | active | 4.1 |
| D-11 | Sign convention; pool = Σ(value + reval) | active | 4.1 |
| D-12 | One branch per txn | active | 4.1 |
| D-13 | Resident branch = line branch on Transit lines | **SUPERSEDED by D-107** | 4.1 |
| D-14 | Documents hold workflow, txns hold stock | active | 4.1 |
| D-15 | `txn_date` business vs `posted_at` | active | 4.1 |
| D-16 | Idempotency key per txn | **SUPERSEDED by D-110** | 4.5 |
| D-17 | Row locks, canonical order per posting | concept active; ordering **SUPERSEDED by D-111** | 4.6 |
| D-18 | Transit never negative | active | 4.7 |
| D-19 | Immutability triggers, cache GUC, demo purge | active (purge guard per D-126) | 4.8 |
| D-20 | One S/F/T per branch; AMN, BMN, BGN, DEMO | active (enforced by D-140) | 6 |
| D-21 | Transit keyed by resident | active | 6 |
| D-22 | Transit in/out rules | active, revised by D-107/D-124 | 6 |
| D-23 | Receipts into STORE only | active | 6 |
| D-24 | Replenishment covers S+F only | active | 6 |
| D-31 | Branch transfers between enabled real branches (or demo↔demo), from S/F into the destination S | active (defined rev 2) | 4.2 |
| D-32 | Two-step dispatch/receive. Cancel by source HN+/MOD/ADMIN while DISPATCHED. Reversing a receive (MOD/ADMIN) → DISPATCHED | active (defined rev 2) | 4.3 |
| D-33 | "Awaiting receipt" naming. Full receipt only. A discrepancy is an adjustment request at the destination, linked to the transfer | active (defined rev 2; supersedes the rev-1 on-document shortage) | 4.2 |
| D-40 | Receive & allocate = RECEIPT + linked TRANSIT_ALLOCATE in one RPC | active (defined rev 2) | 6 |
| D-41 | Receipt mismatch self-ack | **SUPERSEDED by D-105** | 3.6 |
| D-50 | WAC per branch × product | active (Q-4) | 5.1 |
| D-51–D-54 | Return and transfer costing | active | 5.6 |
| D-55 | Variances explicit in `revaluation_value` | active | 5.5 |
| D-56 | A reversal mirrors the original value | active | 5.7 |
| D-57 | WAC in posting order; back-dating rules | active | 5.8 |
| D-58 | Precision; no TS cost maths | active (revised rev 2) | 5.9 |
| D-60 | Counts never post. Expected qty = as of `snapshot_line_id` set at START. Blind entry | active (defined rev 2, with D-104) | 3.6 |
| D-61 | Adjustments are deltas (never set-to-count), posted at approval with `txn_date = fn_inv_today()` of approval, from counts, write-offs or transfer discrepancies | active (defined rev 2) | 4.2 |
| D-70 | Charges created only by the engine; target per issue | active | 7.1 |
| D-71 | Frozen price, name and UOM on charges; NULL price blocked | block rule **SUPERSEDED by D-121**; freezing active | 7.1 |
| D-72 | Return credit at the original price | active (rev-1 collision in §3.2 renumbered to D-101) | 7.1 |
| D-73 | Charge period = its own date; credits in the open month | active | 7.1 |
| D-74 | Branch-month period closes all postings; ADMIN reopen | active | 7.2 |
| D-75 | Locked months corrected by postings in the open month | active | 7.2 |
| D-80 | Head Nurse = individual login + grant | **SUPERSEDED by D-134** | 8.2 |
| D-81 | Inventory scope excludes PHY; demo pinned | scope formula **SUPERSEDED by D-135** | 8.3 |
| D-82 | Separation of duties | active (extended rev 2) | 8.4 |
| D-83 | No `AdminRecordControls` | active | 8.4 |
| D-84 | SELECT-only RLS | active (shape per D-115) | 8.6 |
| D-85 | RPC-only writes with the user-session client | active | 8.7 |
| D-86 | Per-object revokes | active (extended by D-125) | 8.8 |
| D-90 | Own immutable audit table | active | 8.9 |
| D-95 | Preloaded barcode map, Enter-terminated scans | active (defined rev 2) | 9.6 |
| D-100 | Stock request = internal workflow, no PO (rev-1 mis-cited as D-70) | active | 3.6 |
| D-101 | Max levels: product defaults (Store/Floor) + per-location overrides (rev-1 mis-cited as D-72) | active | 3.2 |
| D-102 | Global master data HQ_ADMIN only; `owner_branch_id` for demo | active | 8.3 |
| D-103 | Netted correction; consumed-share cost split | active | 5.7 |
| D-104 | Count START snapshot, freeze, blind | active | 3.6 |
| D-105 | Receipt doc types, landed cost, FOC, provisional DO, attach invoice, reconciliation statuses, normalised keys | landed cost, FOC, normalised keys active; DO / provisional / attach invoice / reconciliation **SUPERSEDED by D-138** | 3.6 |
| D-106 | UOM immutability; factor ≥ 1 | active | 3.1 |
| D-107 | Transit bucket-authoritative outflows; resident guard (Q-12) | active | 6 |
| D-108 | Write-off threshold; HN release; exception review; HN login prerequisite | active, except the HN-login prerequisite (**SUPERSEDED by D-134**) | 7.3 |
| D-109 | Scanner capture; sanity confirm; hard caps | active | 9.6 |
| D-110 | Idempotency table with request hash | active | 4.5 |
| D-111 | Lock plan across all txns of an RPC | active | 4.6 |
| D-112 | Pre-allocated ids; deferred FKs; no post-insert UPDATE | active | 4.3 |
| D-113 | Append-only branch receipts; no partial receipt in V1 | active | 3.6 |
| D-114 | `branch_id` on every child; policy helpers granted | active | 8.5–8.6 |
| D-115 | Array-initplan RLS; denormalised line date/type; capped reports | active | 8.6 |
| D-116 | Lock procedure: verify, closing snapshot, previous-month rule, rebuild | active | 7.2 |
| D-117 | Opening-balance window | active | 4.2 |
| D-118 | PENDING_COST fallback | active | 5.3 |
| D-119 | Suggested order in purchase UOM; close short; Floor top-up | active | 3.9 |
| D-120 | Batch/expiry informational; lot tracking V2 | **SUPERSEDED by D-139** | 3.6 |
| D-121 | PRICE_PENDING + PRICING rows; `is_chargeable` | active | 7.1 |
| D-122 | Billing codes; export batches (join table) | active | 7.3 |
| D-123 | Count/adjust SoD warning; sheet scope = non-zero bucket or max > 0, plus "found item" rows | active | 8.4 |
| D-124 | Transit hardening: release reasons, cascade, re-allocation flag | active | 6 |
| D-125 | Revoke views and sequences; relkind read-back | active | 8.8 |
| D-126 | Definer hardening (`search_path = ''`, no `auth_*()`, `session_user`, payload validation, derived branch) | active | 8.5 |
| D-127 | HN grant bound to branch | **SUPERSEDED by D-134** (no grant table in V1) | 8.1 |
| D-128 | Barcode partial unique, normalisation, HN attach | active | 9.6 |
| D-129 | `fn_inv_today()`; counter year from `posted_at` KL | active | 8.5 |
| D-130 | Reversal/correction date rules | active | 4.4 |
| D-131 | `RETURN_FROM_ISSUE` (resident or OSEM) replaces `RETURN_FROM_RESIDENT` | active | 4.2 |
| D-132 | Single function name `inv_verify_balances` (rev-1 also said `tbl_inv_verify_balances`) | active | 4.8 |
| D-133 | Demo detection: SQL `is_demo`, app `getDemoBranchIds()`, set equality asserted | active (asserted at the top of 007) | 2 |
| D-134 | Q-1: one shared STAFF login per nursing branch; it acts at Head-Nurse tier; HN-tier actions need a senior performer (Head Nurse / Assist. Head Nurse / Nursing Director, or staff role ADMIN); every check goes through `fn_inv_can` + `fn_inv_action_tier` + `fn_inv_rank_for_rights`; no role table; approvals stay with MODERATOR/ADMIN logins | active | 11.2, 13.1 |
| D-135 | Scope by branch Function: NUR → own branch, HQ → every non-demo NUR branch, PHY → nothing (master data included), demo → its own demo branch | active | 13.1 |
| D-136 | Q-27: Inventory is the only stock + billing system for OSEM-bought goods; Medication Stock / Consumables are reminder tools; no integration, no `goods_class` | active | 11.1 |
| D-137 | Q-16: 5 categories; Service = non-stock (`categories.is_service` → `products.is_stock_item = false`), charged by `inv_charge_service` with no ledger row, balance or WAC; reversed by `inv_reverse_charge` | active | 13.1 |
| D-138 | Q-26/Q-11: receipts need the invoice (INVOICE or CASH_BILL, number + date); tax + charges + rounding − discount spread pro-rata; FOC at zero cost; no DO, provisional cost or reconciliation handling | active | 13.2 |
| D-139 | Q-29: no batch/expiry columns and no controlled-drug register in V1 | active | 11.1 |
| D-140 | Q-2: settings and locations only for NUR branches (guard trigger) | active | 13.2 |
| D-141 | Q-24: SQL tests on PGlite in-process with a Supabase + core-table stub; never production; local Supabase stack once Docker exists | active | 13.4 |
| D-142 | Correction RPC covers receipts only (`inv_correct_receipt`, netted per D-103); other types are reversal + re-post; a receipt with receive-&-allocate lines is reversed and re-entered | active (revisit in Phase 7) | 13.3 |
| D-143 | Migration numbers 007–012 (006 is the security lockdown); the Q-12 resident guard ships separately after explicit confirmation | active | 10.1 |
| D-144 | Document tables change only inside the engine (`inv.posting`) through a per-table column/transition whitelist; master data is never deleted | active | 13.2 |
| D-145 | Only an ended month can be locked; only the latest locked month can be reopened; reopening clears the exception review; a reversal/correction/cancel/charge credit cannot be dated before the original (charge credit added rev 3.1, P1-7) | active (default, not explicitly confirmed) | 13.3 |
| D-146 | `service_role` gets no privileges on inventory objects; all writes are RPCs with the user-session client | active | 13.2 |
| D-147 | PENDING_COST outflows leave the pool WAC NULL (rev 2 said W = 0) so later outflows stay flagged until the first costed inflow | active | 13.3 |
| D-148 | Resident charges are visible (RLS) from Head-Nurse tier, i.e. to the branch login in V1 ("nursing staff manage stock and billing"); audit log and exports stay MODERATOR+ | active — **needs owner confirmation** (audit P1-12) | 13.2 |
| D-149 | A zero-value inflow (FOC-only receipt, reversal of a PENDING_COST issue) into a pool at Q ≤ 0 keeps the WAC (NULL stays NULL) and values the pool at it; the difference goes to revaluation. Refines §5.3 (audit P1-3) | active | 13.5 |
| D-150 | Head-Nurse tier (rank 2) only for a NUR branch's STAFF login; any other STAFF login (e.g. HQ) has rank 0: it reads what its scope shows and performs nothing. Master data is visible to any login with inventory scope (audit P1-4) | active | 13.1 |
| D-151 | Month-end review only for an ended month; it records `clock_timestamp()` while holding the period lock; `inv_lock_period` refuses `EXCEPTIONS_STALE` if any txn (`posted_at`) or charge (`created_at`, now clock time) of the month is later (audit P1-2) | active | 13.5 |
| D-152 | Write-off limit is cumulative per branch per KL posting day (reversed write-offs excluded); a line with no cost at all (no WAC, no standard cost) always needs approval (audit P1-5) | active (default, not explicitly confirmed) | 13.5 |
| D-153 | At lock, transfers dispatched by the branch on/before month end and not (net) received or cancelled by then are closed on the dispatching branch at their dispatched value (`in_transit_transfer_id`) (audit P1-6) | active | 13.5 |
| D-154 | The rollback script refuses when any inventory table holds real-branch or global data (not just the ledger) and whenever a non-inventory object depends on an inventory object; owner override `inv.rollback_force` covers only the first (audit P1-8) | active | 10.1 |
| D-156 | Every inventory migration ends with `select public.fn_inv_lockdown();` (RLS on, no API privilege on any inventory object); only 013 grants. A file applied alone never exposes anything (audit V-1) | active | 13.5 |
| D-155 | Hardening: grants in one re-runnable file 013 with read-back; read-only pre-checks so rejected calls insert nothing; an unknown primary id returns FORBIDDEN like an out-of-scope id; concurrent duplicate invoice → DUPLICATE_INVOICE; paper invoice total stored for information; test runner uses a fresh session per test (audit P1-9, P1-13, P1-14, P1-17, P1-18, P1-19) | active | 13.5 |
