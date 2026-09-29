# General Inventory: Phase 0 design audit

Audits `docs/inventory-design.md` (Phase 0, dated 2026-09-28). The review
takes the view of someone who has shipped POS, retail inventory and
pharmacy stock systems. **Audit only: no code, SQL or migration was
written, and nothing was written to Supabase.** The live checks below were
read-only `SELECT`/catalog queries against project `kopmxzdzbvjcqaejviyh`,
run on 2026-09-28.

Severity tags:
- **CRITICAL**: a security or data-integrity hole. It must be fixed in the design before Phase 1.
- **HIGH**: a correctness or control gap that real operation will hit. Fix it in the design before the affected phase's DDL is written.
- **MEDIUM**: an inconsistency or a missing piece. Fix it during the phase that owns it.
- **LOW**: a nit or hardening item.

---

## Verdict: **READY WITH CHANGES**

The architecture is sound and better than most first drafts of an inventory ledger:
- an immutable header+line ledger
- per-branch WAC pools with an explicit revaluation column
- DB-maintained caches behind a GUC guard
- idempotent RPC-only writes through the user-session client
- delta-based count adjustments
- frozen charge prices
- a separate audit table

Nothing here requires a different architecture.

Phase 1 is the DB foundation, though, and several findings change the Phase 1 DDL:
- receipt header fields (F4)
- value-only revaluation lines (F2)
- the count snapshot column (F3)
- UOM immutability (F5)
- child-table `branch_id` and `idempotency_key` columns, grants on RLS helpers (F14)
- transfer receipt rows (F13)

**Revise `inventory-design.md` for F1–F9 and F12–F14 before writing `006_inventory_schema.sql`.** The rest can be handled inside the phase that owns them.

Findings: **1 CRITICAL, 8 HIGH, 15 MEDIUM, 6 LOW** (30 total). There is also one confirmed out-of-scope security issue (§C), which is CRITICAL for the organisation but outside this module.

---

## A. Findings

### F1: CRITICAL: the DEMO `test` account can rewrite the org-wide master data that real branches bill from
**Cites:** D-81, §8.3–8.6, §8.10, §3.1

**Problem.** Branch-scoped actions are pinned by `inv_can_access_branch`. Org-wide actions carry no branch, so the pin never applies to them:
- product master, `charge_price`, `standard_unit_cost`
- UOMs, `factor_to_base`, barcodes
- categories and suppliers

`fn_inv_can` resolves ADMIN from `rights = 'ADMIN'`. The DEMO `test` login **is** ADMIN (verified live: branch 6 has 1 ADMIN), and its password is written in plain text in `docs/database.md` ("Login for testing"). Anyone who has read the repo, or who has been shown the demo, can therefore:
- change a real product's `charge_price`, which is frozen onto every real resident charge from then on
- change `factor_to_base` (1 BOX = 100 → 10), which corrupts every later real receipt's cost basis
- deactivate barcodes or products at every branch

The reverse direction leaks too. Products, suppliers or barcodes created while demoing are `using (true)` for every authenticated user, so they appear in real branches' product search and barcode map. That breaks the CLAUDE.md DEMO-isolation rule.

**Failure scenario.** A sales demo on the `test` login sets gloves' price to RM 0.01 "to show the price field". Every ALMA resident issue for the rest of the month is charged RM 0.01, and nothing flags it, because the audit row is master-data (`branch_id` NULL).

**Change.**
- Gate every org-wide mutation (products, product UOMs, barcodes, categories, UOMs, suppliers, `standard_unit_cost`/`charge_price`) on **`rights = 'ADMIN' and branch Function = 'HQ' and not is_demo`**. This is exactly the existing `isHqAdmin()` precedent in `lib/current-user.ts`, which exists for this reason.
- Add `fn_inv_is_hq_admin()` in SQL and mirror it in TS.
- Suppliers: HEAD_NURSE of a real branch or HQ ADMIN, never a demo account.
- The DEMO account reads the real catalogue read-only. If the demo needs its own products, add `tbl_inv_products.owner_branch_id` (NULL = global), filtered out of every non-demo read.
- Add to `inventory_v1_tests.sql`: "demo ADMIN cannot call any master-data RPC".
- Separately, move the demo password out of `docs/database.md`. That doc is not a secret store.

### F2: HIGH: correcting a consumed receipt by reversal plus re-post distorts WAC and fires false negative-stock prompts
**Cites:** D-56, §4.2 row 10, §5.3, §5.4 "Reversal of a consumed receipt"

**Problem.** `inv_correct_txn` posts the REVERSAL and then the new txn **sequentially** through `fn_inv_apply_pool`. When the receipt has been partly consumed, the reversal alone takes the pool to Q ≤ 0. That triggers:
1. the `NEGATIVE_STOCK_CONFIRM` round-trip for what is, net, a positive correction
2. the Q ≤ 0 inflow path, which **resets W to the corrected receipt's cost** and re-rates all remaining units

Worked example, using §5.4's numbers:
- R1 100 @ 1.00 and R2 100 @ 1.20 give W 1.10. ISSUE 150 leaves Q 50, V 55.
- R2's true cost was 1.25 (WRONG_COST).
- Correct history: W 1.125, 150 issued = 168.75, remaining 50 = **56.25**.
- Design: the reversal leaves Q −50, V −55 (reval +10). The re-post of 100 @ 1.25 takes the Q ≤ 0 path, W' = 1.25, V' = **62.50** (reval −7.5).

Result under the design:
- on-hand is overstated by 6.25
- the 3.75 of extra consumed cost is never recognised
- the net "variance" is +2.50, **in the wrong direction**

Supplier price typos on receipts are the most common correction in any store, so this path will run monthly.

**Change.**
1. `inv_correct_txn` computes the **net** `(dq, dv)` per pool across the reversal and new lines. It applies that net once, the same way §5.3 already nets internal legs, and runs the negative-stock check on the **net** bucket result. Both the reversal and the new lines are still written, so the audit trail is unchanged.
2. For a **cost-only** correction (net dq = 0, dv ≠ 0), split the delta by the consumed share. Take `onhand_share = min(1, Q_now / pool_qty_after_of_original_line)`, which is already stored on the line.
   - `dv × onhand_share` goes into pool V.
   - The rest goes to `revaluation_value`, reported as consumed-cost variance.
   - In the example: 5 × 50/200 = 1.25 into stock, V 56.25 ✓, and 3.75 to variance ✓.
3. This needs a value-only line: allow `qty_base = 0` for a new `txn_type = 'COST_CORRECTION'`, which relaxes the `qty_base <> 0` and `qty_entered > 0` checks for that type only. Alternatively, put the delta on the new receipt line's `revaluation_value`. Decide this in the Phase 1 DDL.
4. Add both cases to the SQL test suite.

### F3: HIGH: the count's expected qty is defined two ways, and movements during a count create false variances
**Cites:** D-60, §3.6 `tbl_inv_counts.snapshot_at` vs `tbl_inv_count_lines.expected_qty` ("filled at SUBMIT from the ledger")

**Problem.** One comment says expected is "as posted at `snapshot_at`" and the other says "filled at SUBMIT". If it's computed at submit from the live balance, every issue, receipt or transfer posted while the sheet is being counted (a monthly Store count takes hours, and Floor keeps issuing) shows up as a variance. That drives false adjustments, which is exactly what "counts record variance only" is meant to prevent.

**Failure scenario.** At 10:00 the nurse counts 40 gauze on Floor. At 10:30 she issues 5 and posts it. At 11:00 the sheet is submitted: expected 35, physical 40, variance +5. The HN requests a +5 adjustment and HQ approves it. Floor is now overstated by 5 permanently.

**Change.**
- Add a `START` transition (DRAFT → IN_PROGRESS). It stores **`snapshot_line_id = max(tbl_inv_txn_lines.id)`** for the branch, taken while holding `FOR SHARE` on the location's buckets. Use the posting-order id, not a timestamp. `bucket_qty_after` makes the as-of qty an exact index lookup.
- `expected_qty` is the qty as of `snapshot_line_id`. The sheet shows a separate column, "posted since count started", so the investigator sees the late movements.
- Monthly STORE counts get an optional **location freeze**: postings to that location are rejected with `LOCATION_COUNT_IN_PROGRESS` until submit. FLOOR counts use the snapshot without a freeze.
- Make the count sheet **blind**, meaning expected qty is hidden until submit. Accept that a STAFF user can still open `/inventory/stock`; it's a UI control, so document it as one.
- Drop the ambiguous `snapshot_at`, or keep it for display only.

### F4: HIGH: receiving has no place for discounts, SST, delivery or rounding, and assumes an invoice exists at delivery
**Cites:** D-41 (referenced, never defined), Q-11, §3.6 `tbl_inv_receipts`

**Problem.** The only reconciliation is `lines_total` vs `invoice_grand_total`, with an ack flag.
- Malaysian supplier invoices routinely carry an invoice-level discount, SST (sales tax 5/10% on taxable goods), delivery charges and rounding.
- OSEM is a healthcare operator buying for consumption, so any SST it pays is **not recoverable and is part of the cost**. With "enter net line unit costs", staff either leave it out, so WAC and the OSEM-expense cost are understated, or they fudge line prices by hand.
- The mismatch ack fires on nearly every invoice. A control that is acknowledged every time is no control ("ack fatigue").
- Goods commonly arrive on a **Delivery Order (DO)**, with the tax invoice or monthly statement following days later. `invoice_no`/`invoice_date NOT NULL`, plus the duplicate-invoice unique index, force staff to invent invoice numbers at the door.

**Change.**
- Header: `doc_type ∈ {INVOICE, DO, CASH_BILL}`, `doc_no` (DO no.), nullable `invoice_no`/`invoice_date`, `discount_total`, `tax_total`, `other_charges_total`, `rounding_adj`.
- Reconciliation: `Σ line_total − discount + tax + charges + rounding = grand_total` within 0.01. A mismatch above RM 1.00 needs MODERATOR acknowledgement, not self-ack.
- **Landed cost V1 (simple):** allocate `tax + charges − discount` to lines pro-rata by `line_total` into `ledger value`. Unit cost is value ÷ qty_base, and the invoice remainder cent goes to the largest line. Store both `line_total` (as invoiced) and `landed_value` (as costed).
- Per-line `foc_qty` for bonus/free goods ("buy 10 free 1"). The qty goes in at zero cost and dilutes WAC correctly. Legacy data should be checked for how often this happens.
- An "attach invoice later" action on a DO receipt fills `invoice_no`/`invoice_date`. It's a whitelisted one-time UPDATE, audited, and it doesn't touch cost unless done as a F2 cost correction.
- Normalise the duplicate key: `upper(regexp_replace(invoice_no, '[^A-Za-z0-9]', '', 'g'))`, so `INV-001`, `inv 001` and `INV001` collide. Warn when the same supplier+amount+date already exists.

### F5: HIGH: the base UOM and conversion factors can be changed after transactions exist
**Cites:** §3.1 `tbl_inv_products.base_uom_id`, `tbl_inv_product_uoms.factor_to_base`, D-58

**Problem.** Lines freeze `factor_to_base`, so history survives a factor edit. What doesn't survive:
- **Pools, buckets, max levels, request lines, count lines and charges** are all in *base* qty. Changing a product's `base_uom_id` from EA to BOX after go-live silently reinterprets every balance: 500 EA becomes "500 BOX", valued at the EA WAC.
- A factor edit (BOX 100 → 50) mid-month changes every later receipt's base qty, but not the open request lines, max levels or suggested order computed in the old sense.
- Nothing in the design forbids either edit.

**Change.**
- A trigger rejects UPDATE of `base_uom_id` once any `tbl_inv_txn_lines` row exists for the product.
- `factor_to_base` is immutable once any line, receipt line or barcode uses that `(product, uom)`. To change packaging, deactivate the UOM row and add a new UOM (e.g. `BOX50`).
- Rule: the base UOM must be the **smallest issuable unit**, and every factor ≥ 1. This also avoids the §3.4 check `abs(...) < 0.00005` failing on exact-half rounding for fractional factors.
- Document the procedure "product set up with the wrong base UOM": deactivate it, create a new product, and move stock with an adjustment pair approved by MOD. There's no merge in V1.

### F6: HIGH: moving a resident to another branch strands their Transit stock (and today's app lets it happen)
**Cites:** D-13, D-21, D-22, Q-12

**Problem.** D-13 requires `resident.branch_id = line.branch_id` on every Transit line. `webapp/src/app/(app)/residents/actions.ts` `updateResident()` writes `branch_id` straight from the form, with no guard and no inventory check. Q-12 says Transit "must be issued or released before a branch change", but nothing enforces it.

**Failure scenario.** A resident with 3 tins of special milk in AMN Transit is edited to branch BMN. From then on, every Transit ISSUE, RELEASE or DAMAGED against that bucket fails D-13, so the stock is stuck, unbillable and uncountable. The only escape is an ADJUSTMENT, which also fails D-13, or SQL.

**Change.**
- D-13 validates the resident against the **bucket's branch** only for **new allocations**. For outflows from an existing T[r] bucket, the bucket itself (location → branch) is authoritative, whatever the resident's current branch is.
- Add a `BEFORE UPDATE OF branch_id, status ON tbl_residents` trigger. It's additive and read-only on inventory, and raises `RESIDENT_HAS_TRANSIT_STOCK` when any non-zero T[r] bucket exists. The UI message says to issue or release first.
  - This does touch an existing table, which is why it's called out here. Get the owner's approval (§D Q-A12).
  - The softer option is to allow the change and put it on the stale-transit alert, relying on the bucket-branch rule above.
- Status → DISCHARGED/DECEASED: allow it, but it goes on the month-end exception list with the Transit value (Q-12 alert).

### F7: HIGH: shrinkage controls rest on a shared login, and STAFF can write off stock with no approval
**Cites:** Q-1, Q-7, D-80, D-82, §8.4, D-22

**Problem.** Each NUR branch has **one** shared STAFF login (verified live: AMN, BMN and BGN each have 1 ACTIVE STAFF account). On that login, any person can post these with only a free staff-picker for attribution:
- `DAMAGED_EXPIRED` (a direct write-off)
- `TRANSIT_RELEASE` (patient stock back into general stock)
- negative-stock confirmation
- inactive-resident issues
- OSEM-expense issues

"Record it as expired" is the textbook way to hide pilferage in a stock system. Q-7's default is "STAFF may post directly".

Q-1's fallback ("until HN logins exist, HEAD_NURSE actions are performed by MODERATOR/ADMIN") means **HQ records every branch's deliveries remotely**. That doesn't match how goods arrive, so in practice the shared login will be used and the HN's name picked.

**Change.**
- Make **individual HN logins with the HEAD_NURSE grant a go-live prerequisite** for each branch. Put it in §10.2 step 6. Don't rely on the fallback.
- DAMAGED_EXPIRED: STAFF may post up to a per-branch threshold (e.g. RM 50 per txn, at WAC). Above it, the txn becomes an **adjustment request** (reason DAMAGED/EXPIRED) that needs MOD approval.
- TRANSIT_RELEASE: HEAD_NURSE+ only (see also F24).
- Month-end exception list, required reviewing before lock: write-offs, releases, negative confirmations, inactive-resident issues, and OSEM-expense issues above a threshold, grouped by `performed_by_staff`.
- Record `posted_by_account` on every row as the design already does, and surface "posted from shared login" in reports so reviewers know the attribution is unverified.

### F8: HIGH: the boundary with the existing Medication Stock and Consumables modules is undefined, so stock and charges can be double-counted
**Cites:** D-1, Q-16, §1.1, §3 seed (`MEDICINE` category)

**Problem.** D-1 says the new module doesn't reuse Medication Stock or Consumables. It doesn't say **which physical goods each system owns**:
- The seed creates a `MEDICINE` category (legacy has 65 medicine products).
- Residents → Consumables already tracks per-resident items (diapers etc.) with restock-to-max.
- If ALMA's diapers are counted weekly in Consumables *and* issued to Transit/resident in Inventory, month-end billing has two sources. The family is charged twice, or accounts pick one arbitrarily.

**Change.**
- Add a decision D-3, "system of record per goods class", and have the owner approve it. For example:
  - family-supplied medication → Medication Stock only
  - OSEM-purchased medicine and consumables → Inventory only
  - per-resident consumables count → keep, or retire Consumables once Inventory Transit covers it
- Seed categories to match.
- Add a go-live checklist item: "no product is billable in both systems".

### F9: HIGH: fat-finger cost and qty, and scanner input landing in the qty field
**Cites:** §9.6 / D-95, §4.7, §3.6 receipt lines

**Problem.**
1. A keyboard-wedge scanner types into **whatever has focus**. The design autofocuses `BarcodeInput` but also lets the qty cell take manual edits. After a manual qty edit, the next scan types `9556001234567⏎` into the qty cell. A 13-digit qty fits `numeric(18,4)`. On an ISSUE it at least hits the negative-stock dialog. On a **RECEIPT** nothing warns, and WAC is destroyed. Because of F2, the correction is lossy.
2. `unit_cost_entered` is per *entered* UOM. Entering the BOX price on an EA line (120.00 instead of 1.20) is the most common receiving error. Nothing compares it with the last cost.

**Change.**
- Add a global scanner detector on the Receive and Issue screens. A burst of ≥ 6 characters with inter-key gap < 35 ms ending in Enter is routed to the scan handler **whatever the focus**, and the burst is stripped from the focused input.
- Qty inputs reject a value longer than 7 digits.
- Sanity guards (warn, and require typed confirmation):
  - line qty > max(10 × location max, 1,000 base units)
  - unit cost deviates > 50% from the last receipt cost or the current WAC
  - line_total > RM 5,000
- The RPC re-checks hard caps (e.g. qty_base ≤ 1e6) and returns `SANITY_CONFIRM`, using the same round-trip as negative stock.
- Receipt lines show the cost **per purchase UOM and per base UOM** side by side.

### F10: MEDIUM: an RPC that writes several txns has only one idempotency key, and a replay doesn't check the payload
**Cites:** D-16, §4.5

**Problem.** `tbl_inv_txns.idempotency_key` is `NOT NULL UNIQUE`, but these RPCs write **two** txns under one client key:
- receipt + TRANSIT_ALLOCATE
- `inv_correct_txn` (REVERSAL + new txn)

The derivation of the second key is undefined, so a naive implementation raises a unique violation, and that violation gets converted into a "replay". A replay with the same key but a **different payload** also silently returns the old result. That happens when a user edits the form after a transient error and the key wasn't regenerated.

**Change.**
- Keep a single `tbl_inv_idempotency(key uuid pk, rpc text, request_hash bytea, result jsonb, created_at)` written by every mutating RPC.
- Child txns get deterministic keys: `uuid_generate_v5(key, 'allocate')`, or simply `idempotency_key` nullable on txns with uniqueness enforced in the idempotency table.
- On replay, compare `sha256(canonical payload)`. A mismatch returns `IDEMPOTENCY_KEY_REUSED`.
- Remove the idempotency columns from the document tables. The DDL doesn't show them anyway (see F14).

### F11: MEDIUM: the lock order breaks for multi-product corrections and receive & allocate
**Cites:** D-17, §4.6

**Problem.** The stated order (document → period → pools → buckets → counter) holds per posting. It doesn't hold when one RPC posts **two** txns in sequence:
- correction: the reversal of products {A, B}, then a new txn of {B, C}
- receipt, then allocate

The second txn takes pool C after bucket A is already held. Two concurrent corrections with overlapping product sets can deadlock. The return-from-resident advisory lock also sits outside the declared order.

**Change.**
- `fn_inv_post` takes a **plan**. Each RPC first builds the union of (period, pools, buckets) across **all** txns it will write, locks them once in canonical order, and only then writes.
- Take the advisory lock for returns immediately after the document lock, sorted by `issue_line_id`.
- Add a test with two sessions (dblink or pgTAP-style) for crossed product sets.

### F12: MEDIUM: the circular references can't be inserted under the immutability triggers
**Cites:** D-10, D-19, §3.4, §3.6, §4.3

**Problem.**
- `pair_line_id` is set "both ways inside the same INSERT batch", but line 1 doesn't know line 2's id, and an UPDATE afterwards is blocked by `fn_inv_block_mutation`.
- The same circularity exists for:
  - `tbl_inv_receipts.txn_id NOT NULL` ↔ `tbl_inv_txns.source_doc_id`
  - `tbl_inv_receipt_lines.txn_line_id NOT NULL`
  - branch transfer `out_line_id`
  - `tbl_inv_adjustments.txn_id`, where an UPDATE at approval is expected

"Deferred FK" solves the constraint timing, not the unknown id.

**Change.** Pre-allocate ids with `nextval(pg_get_serial_sequence(...))` and insert with `OVERRIDING SYSTEM VALUE`. Otherwise:
- link one direction only (the in-leg → the out-leg via `source_line_id`)
- have lines reference the document (`receipt_line_id` on the txn line) instead of the document referencing the txn

Also make the immutability trigger's whitelist explicit for the one document UPDATE at posting (`adjustments.txn_id`, `status`). Decide this before the Phase 1 DDL.

### F13: MEDIUM: branch-transfer re-receive contradicts the one-time-fill rule, and shortage value leaves the ledger
**Cites:** D-32/D-33/D-54 (referenced, never defined), §3.6, §4.3, §4.8

**Problem.**
- §4.3 lets a received IN be reversed and the transfer "re-received". But §4.8 allows `received_qty_base`/`in_line_id`/`shortage_value` to be filled only **while null**, so the second receipt can't be recorded.
- A shortage is "recognised on the transfer line, not in any location". The source pool lost `qty × cost` and the destination gained only `received × cost`. The difference is in **no ledger line**, so org-level value (Σ pools + awaiting receipt) drops without a txn. The shortage isn't in the write-off report and isn't subject to approval.
- Over-receipt (dispatcher miscounted low) is blocked by the check constraint, with no path defined.

**Change.**
- Replace the fill-once columns with an append-only `tbl_inv_branch_transfer_receipts(transfer_id, receive_txn_id, …)` plus lines.
- Post the shortage as an explicit ledger txn `TRANSFER_LOSS`: a negative value-only line (or an ADJUSTMENT) at the **source** branch, dated at receipt, reason LOST, approved by MOD.
- Over-receipt: receive the dispatched qty and raise a +ADJUSTMENT request at the destination.
- Define D-31…D-33 in the document; they're cited but never written (F30).
- Consider whether V1 needs partial receipt at all. Legacy inter-branch volume is small, so "receive all, or cancel and re-dispatch" may be enough (F-note in §B).

### F14: MEDIUM: the DDL, grants and RLS contradict each other
**Cites:** D-84, D-86, §3.6, §8.6, §8.8

1. §8.6's audit-log policy calls `fn_inv_can('VIEW_AUDIT')`. §8.8 revokes EXECUTE on **all** `fn_inv_*` from `authenticated`. RLS predicates run as the querying role, so every audit-log SELECT errors with `permission denied for function`.
   - Fix: helpers used in policies (`fn_inv_can`, `fn_inv_current_account`) get `grant execute … to authenticated` (they're read-only), or rename them `inv_*`.
2. §8.6 says "child tables carry their own `branch_id`, filled by the engine". The §3.6 DDL for these tables has **no `branch_id`**:
   - `receipt_lines`
   - `stock_request_lines`, `stock_request_events`
   - `count_lines`, `adjustment_lines`
   - `branch_transfer_lines`

   Implemented from the DDL, they'd need join-policies, or would be unprotected.
3. §4.5 says "every document table gets" an `idempotency_key`. None of the §3.6 DDL has one (superseded by F10).
4. `tbl_inv_account_roles` policy `auth_role() = 'ADMIN'` lets the DEMO ADMIN read all real role grants. Use the F1 HQ-admin helper.

### F15: MEDIUM: RLS and report performance under the 8 s `authenticated` statement timeout
**Cites:** D-84, §9.5, §3.4 indexes

**Problem.**
- Live, `authenticated` has `statement_timeout = 8s` (verified).
- A policy `using (inv_can_access_branch(branch_id))` calls a SECURITY DEFINER plpgsql/sql function **per row**, because a function taking a column argument can't be hoisted into an initplan.
- Movement, Valuation and as-of reports for HQ (all branches, multi-year) will scan tens of thousands of lines. This repo already hit the same failure (`57515a8 cap clinical report queries`).

**Change.**
- Use the Supabase-recommended shape: `using (branch_id = any ((select inv_accessible_branch_ids())))` with `inv_accessible_branch_ids()` returning `bigint[]`, evaluated once per statement.
- Denormalise `txn_date` and `txn_type` onto `tbl_inv_txn_lines` (the rows are immutable, so there's no drift risk) and index `(branch_id, txn_date, id)` and `(branch_id, product_id, txn_date)`.

### F16: MEDIUM: there's no month-end valuation snapshot and no drift check tied to period close
**Cites:** D-74, §4.8 `verify_balances`, §9.5 Valuation

**Problem.**
- The Valuation report reads **current** pools. Accounts need closing stock value **as of month-end**, and they need it to stay the same after later postings.
- It *can* be derived as Σ(value + revaluation) over lines with `txn_date ≤ EOM`, and that sum is stable once the month is locked. But nothing specifies this, and with the 8 s timeout it should be materialised.
- `verify_balances` is manual and diagnostic-only, with no rebuild path. `pg_cron` isn't installed (verified), so there's no scheduled run.

**Change.**
- At LOCK, write `tbl_inv_period_closing(branch, period, product, location, resident, qty, value)` from the ledger, and use it for the "as of month-end" valuation and opening figures.
- Run `verify_balances` inside the lock RPC. **Refuse to lock** on drift.
- Provide `fn_inv_rebuild_caches(branch)`: postgres-only, GUC-guarded, audited. It recomputes pools and buckets from lines in id order.

### F17: MEDIUM: the Opening Balance rule blocks the second location and allows unapproved stock later
**Cites:** §4.2 row 1

**Problem.** "Allowed only if the pool has no prior lines for that branch×product." The pool is branch-wide, so:
- once STORE's opening posts for gloves, FLOOR's and each T[r]'s opening for gloves are rejected (unless the grid posts every location of a product in one txn, which isn't stated)
- conversely, for a product first created months after go-live, ADMIN can post an "opening balance" of any qty at any cost with **no approval**, which bypasses D-82

**Change.**
- OPENING_BALANCE is allowed only while `branch_settings.is_enabled = false`, or within N days of `go_live_date`, dated on `go_live_date`.
- It's allowed for any location while the pool contains only OPENING_BALANCE lines.
- After that window, stock enters only by receipt, transfer, or an approved +ADJUSTMENT.

### F18: MEDIUM: `NO_COST_BASIS` blocks issuing a product that hasn't been received yet, which contradicts "negative stock allowed"
**Cites:** §5.3 "Outflow at WAC", requirement "negative stock allowed with warning + confirmation"

**Problem.** A new product is delivered at 22:00 and the HN records the receipt the next morning. The night nurse's issue is **rejected** because W is NULL and `standard_unit_cost` is NULL. She'll issue a different product or skip the record, and both corrupt the ledger.

**Change.** Fall back to W* = 0 with `cost_source = 'PENDING_COST'`, and still require the negative-stock confirmation. The existing Q ≤ 0 inflow path already trues it up: on first receipt, reval = Q × c, which reports the consumed cost as variance. Flag PENDING_COST issues on the month-end exception list.

### F19: MEDIUM: suggested order double-counts the default max, isn't rounded to purchase packs, and requests can't be closed short
**Cites:** D-24, Q-18, §3.9 `v_inv_suggested_order`, §3.6 requests

**Problem.**
- `default_max_qty` applies "per location when no stock_levels row", and the suggestion is `Σ max(STORE, FLOOR)`. An un-overridden product's target is therefore **2 × default**.
- The suggestion is in base units (e.g. 37 EA). Orders go out in boxes of 100, so the HN must convert by hand. Legacy used `ceil`.
- A request line that the supplier can never fill stays in `open_request_qty` forever and suppresses future suggestions. There's no `CLOSED_SHORT`.
- The requirement says "Suggested Order = Max − Current". Subtracting open-request qty is a sensible deviation, but it needs the owner's sign-off.

**Change.**
- Split into `default_max_store` / `default_max_floor`, or apply the default to STORE only.
- Show the suggestion as `ceil(suggested / purchase_factor)` in the purchase UOM, alongside base.
- Add a per-line `close_remaining` action (HN/MOD, audited) and a `CLOSED` request status.
- Add a Floor top-up suggestion (Floor max − Floor on hand) on the internal-transfer screen. It's the dominant legacy flow (346 of 550 transfers).

### F20: MEDIUM: batch and expiry tracking isn't decided
**Cites:** absent from the design; D-53 / §4.2 row 8 (DAMAGED_EXPIRED)

**Problem.** The module stocks medicine and dressings and has an EXPIRED write-off reason, but it doesn't record expiry dates, so there are no near-expiry alerts and no FEFO. For a pharmacy-adjacent store that's a deliberate V1 cut or an oversight, and the design doesn't say which.

**Change.**
- Explicitly **defer lot-level stock (batch as a balance dimension) to V2**.
- In V1, capture optional `batch_no` and `expiry_date` on **receipt lines** (informational, not a bucket key). This supports a "received items expiring within 90 days" report and keeps the data for V2.
- Ask the owner whether any stocked item is a controlled or psychotropic drug that needs a statutory register (§D).

### F21: MEDIUM: blocking resident issues when `charge_price` is NULL pushes billable items into OSEM expense
**Cites:** D-71, Q-8

**Problem.** A hard `NO_CHARGE_PRICE` rejection at the point of care means the nurse retries with target OSEM_EXPENSE, the one path that works. The resident is never billed, and nothing flags it. That's billing leakage.

**Change.**
- Allow the RESIDENT issue with `unit_charge_price NULL` and `charge_status = 'PRICE_PENDING'`.
- Month-end review can't lock while PRICE_PENDING rows exist. MOD prices them there, frozen with the same MANUAL_ADJUSTMENT audit trail.
- Keep the hard block only for products flagged `is_chargeable = false`.

### F22: MEDIUM: the charge export isn't Bukku-ready, and reopening a period loses what was already exported
**Cites:** §7.3, D-75, Q-9, Q-25

**Problem.**
- The CSV has the resident's internal id and name. Bukku sales-invoice import needs a **contact/customer code** (residents have none), item/SKU, income account and tax code, and usually one invoice per customer.
- After ADMIN reopens and re-locks, nobody can tell which rows were already invoiced.
- Credits against a prior (locked) month need a Bukku **credit note**, not a negative invoice line.

**Change.**
- Add `resident_billing_code` (on a small `tbl_inv_resident_billing` side table, which avoids altering `tbl_residents`).
- The export includes resident code, SKU, `related_charge_period`, and `is_prior_period_credit`, with two layouts: itemised, and summary per resident.
- Stamp an export batch: `tbl_inv_charge_exports(id, period, exported_at, by)` plus `charges.export_batch_id` (a whitelisted one-time fill). A re-export after reopen shows only the delta.
- Confirm the exact Bukku import template with the owner (§D).

### F23: MEDIUM: count segregation of duties and count-sheet scope aren't defined
**Cites:** D-60/D-61 (cited, never defined), D-82, §3.6

**Problem.**
- Nothing prevents the same staff member from counting, investigating and requesting the adjustment. Only the approver is separated.
- The sheet's product list isn't defined. If it's "products with a bucket", zero-balance items physically present (FOUND) can't be recorded.
- If it's "all active products", a 500-line Store sheet is impractical.

**Change.**
- The RPC enforces `adjustments.requested_by_staff ≠ counts.counted_by_staff` when linked. It warns rather than blocks while branches have a single HN.
- Sheet = products with a non-zero bucket or with max > 0 at that location, plus an "add found item" row.
- Write D-60/D-61 out as decisions.

### F24: MEDIUM: Transit can still be laundered into general stock, and receive & allocate reversal is undefined
**Cites:** D-22, D-40, §4.4

**Problem.**
- `TRANSIT_RELEASE → STORE` (STAFF, any reason text) followed by `TRANSIT_ALLOCATE` to another resident is a general pool with two extra clicks.
- Reversing a RECEIPT that was received & allocated takes STORE negative while the goods sit in T[r]. The design doesn't say whether the allocation is reversed too.
- How patient-specific purchases are charged is unresolved:
  - at issue at the catalogue price (the design)
  - or passed through at invoice cost / prepaid by family

**Change.**
- Release is HEAD_NURSE+ (F7), and reason codes are fixed: `DISCHARGED`, `DECEASED`, `NO_LONGER_REQUIRED`, `WRONG_ALLOCATION`.
- A released qty can't be re-allocated to a different resident within 7 days without MOD.
- A receipt reversal cascades: the RPC reverses the linked TRANSIT_ALLOCATE first, in the same transaction (the D-18 hard block still applies if it was already issued, which gives a clear error).
- Add the charging question to §D.

### F25: LOW: sequences and views are missing from the revoke list
**Cites:** D-86, §8.8

**Problem.** The live `pg_default_acl` also grants **`anon` `rwU` on new sequences** in `public`, plus ALL on new views, since views are relations. §8.8 revokes only `tbl_inv_*` tables and functions. Identity sequences (`tbl_inv_*_id_seq`) and `v_inv_*` views keep anon grants. Exposure through PostgREST is limited, but it fails the "anon has zero privileges" read-back if that is written correctly.

**Change.** Revoke on `v_inv_*` and on every owned sequence too, and have the read-back assert over `pg_class` relkinds `r`, `v` and `S`.

### F26: LOW: SECURITY DEFINER hardening details
**Cites:** §8.5, D-19

- Prefer `set search_path = ''` with schema-qualified names, which is Supabase's current guidance, over `public, pg_temp`.
- Don't call the existing `auth_*()` helpers from inventory functions. Live, all five are SECURITY DEFINER with **no `search_path` set** (`proconfig` NULL), and none checks `status = 'ACTIVE'`.
- The DEMO-purge guard `current_user = 'postgres'` is meaningless inside a SECURITY DEFINER function owned by postgres, because every `inv_*` RPC also runs as `postgres`. The GUC is the real guard. Instead, check `session_user` (or both) and keep `fn_inv_purge_demo` un-granted.
- Validate every RPC's `jsonb` payload shape (types, lengths, array size ≤ 200) before any lookup.
- Always derive the branch from the location, document or resident row, and pass **that** branch to `fn_inv_require`. Never trust a separate `p_branch` argument (confused deputy).

### F27: LOW: the HEAD_NURSE grant isn't bound to a branch
**Cites:** D-80, §3.2

**Problem.** `tbl_inv_account_roles` has no `branch_id`. `updateAccount()` in `accounts/actions.ts` can move a login to another branch, and the HN capability silently follows.

**Change.** Store `branch_id` on the grant, and require it to equal the account's current branch in `fn_inv_current_account`.

### F28: LOW: barcode and key normalisation
**Cites:** §3.1, §9.6

- `barcode` is globally `unique` including inactive rows, so a barcode can't be re-assigned after a product is replaced. Use a partial unique index `where is_active`.
- Normalise UPC-A/EAN-13 on lookup. Try the exact code, then with a leading `0` added or removed, since scanners differ.
- Unknown-barcode flow: a HN+ user may "attach this barcode to product…" inline. STAFF only sees "Not found".

### F29: LOW: define the KL date in one place, and pick which date the counter year uses
**Cites:** §4.7, §3.3

- Define `fn_inv_today()` = `(now() at time zone 'Asia/Kuala_Lumpur')::date` and use it everywhere. The repo already has one off-by-8 bug (`migration/scripts/fix_tz_off_by_8.sql`).
- State whether document-number years follow `txn_date` or `posted_at`. Use `posted_at` (KL), so a back-dated post in January doesn't consume last year's sequence.

### F30: LOW: internal coherence
- **Cited but never defined:** D-31, D-32, D-33, D-40, D-41, D-60, D-61, D-95. The auditor can't cite what isn't written.
- **Numbers reused:** D-70 is "stock request, no PO" in §3.6 and "charge rows" in §7.1. D-72 is "stock level overrides" in §3.2 and "return credit price" in §7.1.
- `tbl_inv_verify_balances` (§4.8) vs `inv_verify_balances` (§10.1).
- The §8.4 row "Reverse / correct any txn (open period)" is ambiguous. Does *the original* have to be in an open period, or does *the reversal* post into one? D-75 implies the latter. Also state the corrected txn's `txn_date` when the original is in a locked month.
- Who may **cancel** a DISPATCHED branch transfer? The matrix doesn't say. Cancel is a reversal, so MOD/ADMIN, which strands a mistaken dispatch until HQ acts.
- Returning unused items from an **OSEM_EXPENSE** issue has no event. `RETURN_FROM_RESIDENT` is resident-only.
- `getDemoBranchIds()` (app) keys on `BranchCode = 'DEMO'`, while the SQL keys on `is_demo`. Pick one for inventory and note it.
- Legacy non-stock **Service** charges (15 products, unit JOB) are out of scope (Q-8). Say where they're billed after cutover, or month-end billing is split across two systems (§D).

---

## B. Agree with executor (endorsed as written)

- **D-1 / D-2:** don't build on Medication Stock, Consumables or the dormant `001_init` inventory tables. Verified live: `tbl_products`, `tbl_stock_movements` and `tbl_charging_summary` have 0 rows, and no `tbl_inv_*` exists. The `tbl_inv_*` prefix is correct.
- **D-10 / D-11 / D-12:** header + signed lines, one txn per branch, and `text + CHECK` vocabularies.
- **D-15 / D-57:** WAC in posting order with no retroactive re-costing. This is standard perpetual-AVCO behaviour and correct for a system whose charges don't depend on cost.
- **D-16 / D-17 (concept):** client UUID idempotency, row locks in a canonical order, and retry on deadlock with the same key. Subject to F10 and F11.
- **D-18 / D-21 / D-23:** Transit is one location per branch keyed by resident, with a hard block on negative. Receipts always land in STORE, with receive & allocate as a single action.
- **D-19:** immutability triggers, the `TRUNCATE` block, and cache writes only under a transaction-local GUC. Subject to F12's insert mechanics.
- **D-50:** WAC per branch × product. Per-location WAC makes internal moves costing events; org-wide lets one branch's errors contaminate another's.
- **§5.3 negative-stock rule (reset W to the incoming cost and book the difference as revaluation):**
  - It's sound, and it's what mature systems do ("vacuum"/negative-inventory true-up in Odoo and Dynamics).
  - The naive blend `(V + pv)/(Q + dq)` with Q < 0 can yield negative or absurd WAC. The design correctly avoids it.
  - I1 holds in all paths (checked by hand against §5.4).
  - A receipt that leaves Q still negative re-rates the whole remainder. That's acceptable and visible as variance.
- **D-51 / D-52 / D-53 / D-54:**
  - return from resident at the original issue cost
  - return to supplier at WAC, with the AP difference as info
  - write-offs at WAC
  - branch transfers at the source WAC, with exact value carried
- **D-55 / D-56:** variances are explicit (`revaluation_value`), never silently absorbed, and a reversal mirrors the original value. Subject to F2 for combined corrections.
- **D-58:** precision, and "ledger value = invoice line_total, unit cost derived". The invoice amount is preserved exactly, and the last unit takes the residue.
- **D-60 (principle):** counts never post, and adjustments are **deltas** posted at approval. A delta, rather than set-to-count, is the correct choice when approval lags the count.
- **D-70 / D-71 / D-73:** charges are created only by the engine, frozen price/name/UOM, based on issued base qty, never "sale", and credits for locked months are booked in the open month and linked.
- **D-74:** the lock closes *all* postings for the branch-month, not only charges, and reopening is ADMIN-only with a reason.
- **D-80:** individual HN login plus a capability table, rather than making the HN a NUR MODERATOR. That keeps MODERATOR's meaning app-wide. Plus the positional attribution check (Q-1b).
- **D-81:** excluding PHY (AMP) from inventory all-branch scope is a justified, documented deviation. Record it in `docs/database.md` when implementing.
- **D-83 / D-85 / D-86 / D-90:**
  - no `AdminRecordControls` on inventory
  - RPC-only writes with the **user-session** client (so `auth.uid()` is real) and no service role
  - explicit per-object revokes (the live default ACL confirmed that anon gets ALL)
  - a dedicated immutable audit table recording the account and the staff member separately
- **§4.7:** business rejections are returned as codes before any write and mapped to i18n keys. That also sidesteps the known untranslated-Server-Action-error gap.
- **§9.5 / §9.6 (direction):** capped reports, CSV rather than PDF (the PDF i18n gap), a preloaded barcode map, per-UOM barcodes (a box GTIN adds 1 BOX), and scan-again-to-increment.
- **§10:** additive numbered files, tests on a local stack first, production verification only in DEMO, and a postgres-only purge.
- **Scope note:** the design is heavy for about 1k lines/month/branch, but most of the weight is correctness machinery that a ledger needs. Two things could be simplified if schedule pressure arises:
  1. Branch-transfer partial receipt and shortage (F13). V1 could be "receive all, or cancel and re-dispatch".
  2. The scaled-bigint TS mirror of the WAC maths. STAFF doesn't see costs, so a cost preview is YAGNI, and the DB is authoritative.

---

## C. Out-of-scope security claim: independently confirmed (read-only)

Checked 2026-09-28 with catalog queries only.

| Table | RLS | Policies | `anon` privileges | `authenticated` privileges | Rows (exact) |
|---|---|---|---|---|---|
| `tbl_audit_log` | **disabled** | 0 | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, **TRUNCATE**, UPDATE | same | 764,766 |
| `tbl_nursing_chart_elimination_episodes` | **disabled** | 0 | same | same | 46,959 |

- These are the **only two** `public` tables with RLS disabled. `has_table_privilege('anon', …, 'SELECT'/'DELETE')` is true for both.
- The webapp uses the `public` schema through PostgREST, so anyone with the public anon key (it ships in the browser bundle) can read or wipe them.
- **The executor's claim is confirmed. Rate it CRITICAL for the organisation**, independent of inventory:
  - `tbl_audit_log` holds full row snapshots, including resident data
  - the elimination episodes are clinical records
- Minimal fix, as a separate task that needs the owner's confirmation because it's a production schema change:
  - `alter table … enable row level security`
  - `revoke all … from anon`
  - a branch-scoped SELECT policy (the elimination table)
  - for the audit log: SELECT for ADMIN only, no client INSERT/UPDATE/DELETE, and make `fn_audit_trigger` SECURITY DEFINER with a fixed `search_path` so trigger inserts still work once `authenticated` loses INSERT
- Also confirmed:
  - `tbl_resident_consumables`' only policy is still the pre-`scope_moderator_to_branch` shape (`auth_role() in ('ADMIN','MODERATOR')` bypass), so a NUR-branch MODERATOR would see every branch. No NUR MODERATOR login exists today, which makes this latent.
  - `fn_audit_trigger` is not SECURITY DEFINER.
  - all `auth_*` helpers are SECURITY DEFINER without `search_path`.

Other executor claims spot-checked and found accurate:
- PG 17.6
- `TimeZone = UTC`
- `pg_trgm` installed
- default ACL grants anon ALL on tables and EXECUTE on functions
- one ACTIVE STAFF login per NUR branch and AMP; HQ has 2 ADMIN and 2 MODERATOR; DEMO has 1 ADMIN
- Head Nurse / Assist. HN / Nursing Director staff as described, all `role = MODERATOR`, plus one INACTIVE Assist. HN at AMN
- no `.rpc(` usage in `webapp/src`
- next schema number is 006
- `getCurrentUser()` has zero args, and `canAccessAllBranches` includes PHY

---

## D. Additional open questions for the business owner

- **Q-A1 (F4):** Do suppliers deliver with a Delivery Order and invoice later (or send a monthly statement)? Must the Head Nurse be able to record a delivery before the invoice exists?
- **Q-A2 (F4):** Does OSEM pay SST on any stocked items? Do suppliers give invoice-level discounts, delivery charges or free bonus quantities ("buy 10 free 1")? Should these go into item cost? (Recommended: yes, pro-rata.)
- **Q-A3 (F8):** For each goods class (family-supplied medicine, OSEM-bought medicine, diapers/wipes, milk/feeds, dressings), which system is the record: Inventory, Medication Stock or Consumables? Is anything billed from two places today?
- **Q-A4 (F24):** Patient-specific (Transit) purchases:
  - Is the family charged when the item is **used**, at the catalogue price (design default)?
  - Or when it's **bought**, at the actual invoice price?
  - Do families ever pre-pay?
- **Q-A5 (F20):** Is expiry-date tracking needed in V1 (near-expiry alerts), or is a monthly visual check enough? Are any stocked items controlled or psychotropic drugs that need a statutory register?
- **Q-A6 (F7):** What write-off value (per transaction) may branch staff post without HQ approval? (Suggested RM 50.)
- **Q-A7 (F7, Q-1):** Will each Head Nurse get her own login **before** her branch goes live? (Recommended as a go-live prerequisite.)
- **Q-A8 (F13):** When an inter-branch transfer arrives short, which branch bears the loss? Is partial receipt needed in V1?
- **Q-A9 (F22):** Show the exact Bukku import template used for resident invoices. Is it one invoice per resident per month? Itemised or summarised? Does each resident have a Bukku customer code?
- **Q-A10 (F30, Q-8):** After cutover, where are non-stock **service** charges (legacy "Service", unit JOB) billed? Month-end billing must not end up split between Access and the new module without a plan.
- **Q-A11 (F3):** Can the Store be **frozen** (no postings) for the hour or two of the monthly Store count?
- **Q-A12 (F6):** Do you approve a small guard on the existing resident record that stops a branch change while the resident still has Transit stock? The alternative is only a warning on the inventory dashboard.
- **Q-A13 (F21):** If a product has no charge price set, should the nurse be able to issue it to the resident anyway, with HQ pricing it at month-end? (Recommended.) Or must the issue be blocked?
- **Q-A14 (F19):** Should Suggested Order subtract quantities already approved but not yet delivered (design default)? Should it be shown in boxes (purchase unit) rather than pieces?
- **Q-A15:** Is a mid-month price change for resident charges ever needed with an effective date, or does "the new price applies from the moment it's saved" suffice?

---

## Phase 1 implementation audit (2026-09-29)

**Scope.** The audit covers these files, read against `docs/inventory-design.md` rev 3 (§0.1, §11, D-134–D-148, §13):
- `schema/007_inventory_schema.sql` … `schema/012_inventory_seed.sql`
- `migration/scripts/rollback_inventory_v1.sql`
- `schema/tests/inventory/*`
- `webapp/scripts/test-inventory.mjs`

**Method.**
- **No repo file was modified**, apart from appending this section.
- I ran `npm run test:inventory`: **33/33 pass**.
- I ran throwaway probes on the same PGlite harness, from the session scratchpad only (results in §P.3).
- **Live checks were read-only SELECT/catalog queries.** They confirmed:
  - no `tbl_inv_*`, `v_inv_*`, `inv_*` or `fn_inv_*` object exists yet
  - branch ids and codes 1 AMN/NUR, 2 AMP/PHY, 3 BMN/NUR, 4 BGN/NUR, 5 HQ/HQ, 6 DEMO/NUR `is_demo`
  - `pg_trgm` is in `public`
  - `postgres` is **not** superuser but has BYPASSRLS and **owns** `tbl_branches`, `tbl_staff`, `tbl_user_accounts`, `tbl_residents` and `tbl_positions` (none FORCE RLS)
  - the SQL editor / MCP session is `current_user = session_user = postgres`
  - the live `auth.uid()` body matches the stub
  - 006 is applied: `tbl_audit_log` has RLS on and anon has no SELECT; `tbl_nursing_chart_elimination_episodes` has RLS on with a branch policy

### P.1 Verdict: **READY WITH CHANGES**

The engine is well built:
- ledger immutability by trigger
- engine-only caches
- per-table document whitelists
- an ordered lock plan
- netted F2 corrections (the §5.4 WAC cases reproduce exactly)
- `search_path = ''` everywhere
- the capability check runs before idempotency in every RPC
- DEMO/PHY/HQ scope matches D-135
- anon, PUBLIC and service_role hold nothing on inventory objects

Applying 007–012 to live is **additive and low-risk**: only the DEMO branch is enabled by the seed. **Do not apply until P1-1 and P1-2 are fixed, and fix P1-8 (the rollback guard) in the same pass**, because the rollback script is the safety net for that apply. The MEDIUM items can land during Phase 2, before any real branch's `is_enabled = true`.

Counts: **0 CRITICAL, 2 HIGH, 9 MEDIUM, 9 LOW** (20 findings).

### P.2 Findings

#### P1-1: HIGH: `inv_reverse_txn` fails on a fresh DB connection for every txn type except BRANCH_TRANSFER_IN
**Where:** `schema/011_inventory_rpc_admin.sql:172`, i.e. `if v_orig.txn_type = 'BRANCH_TRANSFER_IN' and (v_transfer.status <> 'RECEIVED' or …)`.

**Problem.** `v_transfer` is a `record` that is assigned only in the transfer-in branch (line 159). The first time PL/pgSQL plans that expression in a backend, it needs the record's type, so it raises `record "v_transfer" is not assigned yet`. It does this even though the left side of `and` is false.

Once the plan is cached in that backend, later calls short-circuit and succeed. Probe R1 and R2 reproduce both behaviours:
- In a fresh session, the first ISSUE reversal raises.
- After one transfer-in reversal in the same session, the ISSUE reversal succeeds.

**Failure scenario.**
- In production, each pooled PostgREST backend fails the first reversal of an ISSUE, RECEIPT, write-off or Transit move with a 500 error, until that backend happens to reverse a transfer-in (which is rare).
- Wrong-entry correction is a core requirement and is effectively broken.
- A PRICE_PENDING charge can then never be cleared (the PRICING RPC is deferred, so reversal is the only path), and the period lock stays blocked.
- It fails closed: nothing is written. That's why this is HIGH and not CRITICAL.
- The suite's test order hides it: the branch-transfer test at line 127 reverses a transfer-in before the issue-reversal test at line 328 runs in the same session.

**Fix.**
- Replace the compound condition with a nested `if v_orig.txn_type = 'BRANCH_TRANSFER_IN' then if v_transfer.status … end if; end if;`, or read `v_transfer_status text` / `v_transfer_id bigint` scalars instead of a record.
- Grep for the same pattern in future RPCs.
- Add a regression test that runs in a fresh session (see P1-9).

#### P1-2: HIGH: the month-end exception review goes stale, so the lock gate is not a control
**Where:**
- `011:669–724` (`inv_mark_exceptions_reviewed` stamps `exceptions_reviewed_at` only)
- `011:788–791` (the lock only checks that it isn't NULL)
- `011:701` (review is allowed while the month is still running)

**Problem.** With no Head Nurse logins (D-134), the month-end exception review is the compensating control for shrinkage on the shared branch login (F7/D-108). But:
- any posting dated in the month **after** the review leaves the review in place
- a review can be stamped on day 1 of a month that still has 30 days of postings
- `v_inv_exceptions` doesn't exist yet (§13.3), so in Phase 1 the "review" doesn't review anything

Probe P4: after the review, a back-dated OSEM issue of 500 units taking FLOOR negative was posted into the reviewed month, and `inv_lock_period` still returned OK.

**Fix.**
- Store `exceptions_reviewed_through_line_id`: the max `tbl_inv_txn_lines.id` of the branch at review time. Add it to the 007 period whitelist.
- `inv_lock_period` refuses with `EXCEPTIONS_STALE` if any txn/charge dated in the period has an id (or `created_at`) later than that.
- Refuse a review while `period_month` hasn't ended.
- Make "the exception view exists and has been shown in the review UI" an explicit go-live gate for real branches.

#### P1-3: MEDIUM: a zero-value inflow into a pool at Q ≤ 0 resets WAC to 0
**Where:** `009:243–248` (`fn_inv_pool_in` true-up path, `w := round(c, 6)` with `c = p_pv / p_dq = 0`).

**Probes.**
- **P7:** GAUZE at Q −3, W 1.00. A FOC-only receipt of 10 gives **W 0.000000, V 0**, revaluation +3.00. The 3 units consumed while negative are re-costed to zero, and the 7 remaining units, plus every later issue until the next paid receipt, cost 0. That understates OSEM-expense cost and valuation.
- **P1** (once P1-1 is fixed): reversing a PENDING_COST issue (value 0) while Q ≤ 0 also sets W to 0. That defeats D-147: later outflows are labelled `WAC` at 0 instead of `PENDING_COST`, so the exception list misses them.

**Fix.** In the Q ≤ 0 path, when `p_pv = 0`:
- keep `w := p_w` (NULL stays NULL, so PENDING is preserved)
- if `p_w` is not null, set `v := round(q × p_w, 4)` (FOC units at the prior WAC, the difference to `reval`)
- flag the line for the exception review

Add both cases to the WAC-maths test.

#### P1-4: MEDIUM: a (future) HQ STAFF login would get Head-Nurse tier at every branch
**Where:** `008:75–79`, since `fn_inv_rank_for_rights('STAFF') = 2` regardless of branch Function; plus `008:54–58` (HQ scope = all NUR branches).

**Problem.** Probe P8: an HQ STAFF account can `RECEIPT` at BMN, `TRANSIT_RELEASE` at BGN, and post a BMN receipt. No HQ STAFF login exists today, but D-134 reasons only about the *shared NUR branch login*.

**Fix.** Rank = 2 only when `rights = 'STAFF' and branch_function = 'NUR'`. HQ STAFF gets 0 (or 1 with VIEW only). Keep it in `fn_inv_rank_for_rights`, the one place.

#### P1-5: MEDIUM: the write-off threshold can be bypassed by splitting, and uncosted items are valued at 0
**Where:** `010:861–875`.

**Problem.** The threshold is per transaction, at `coalesce(wac, standard_unit_cost, 0)`.
- Probe P3: two write-offs of RM 49.50 each (RM 99 total, threshold RM 50) both succeed.
- Probe P2: 900 units of a never-costed product are written off at value 0.

**Fix.**
- Check the cumulative value per branch per KL day (optionally per performer) against the threshold.
- Treat a NULL-cost line as needing approval unless `standard_unit_cost` exists.
- Put every write-off on the exception review regardless of value.

#### P1-6: MEDIUM: goods in transit at month end are in neither branch's closing snapshot
**Where:** `011:809–825`.

**Problem.** Probe P9: AMN dispatches 40 units (RM 40) to BMN dated in the closing month, and BMN hasn't received them. Both months lock. AMN's closing is RM 60, BMN has no row, and the RM 40 is in no closing figure. The company total understates stock by the in-transit value; D-54 promised it would be "valued on the document".

**Fix.** At lock, add closing rows for `DISPATCHED` transfers of the source branch with dispatch `txn_date ≤ month end` and no receive dated ≤ month end. For example, `location_id NULL, in_transit = true`, value from `branch_transfer_lines`. Alternatively, warn at lock and list them on the review.

#### P1-7: MEDIUM: `inv_reverse_charge` accepts a date before the original charge (D-145)
**Where:** `011:586`, `011:612–626`.

**Problem.** Probe P5: a SERVICE charge dated 2026-09-29 was credited with a REVERSAL dated 2026-08-01, in the previous open month. That puts a credit into a month whose export/invoice never contained the charge. `inv_reverse_txn` already has `DATE_BEFORE_ORIGINAL`; this RPC doesn't.

**Fix.** `if v_date < v_c.charge_date then return fn_inv_err('DATE_BEFORE_ORIGINAL')`. Add a test.

#### P1-8: MEDIUM: the rollback guard checks only `tbl_inv_txns`, so real billing and master data are dropped silently
**Where:** `migration/scripts/rollback_inventory_v1.sql:13–21`.

**Problem.** Probe: after one real AMN SERVICE charge (no ledger txn by design, D-137), the rollback **ran and dropped `tbl_inv_charges`**. The same happens to:
- HQ-entered products and suppliers
- resident billing codes
- real-branch audit rows

`drop … cascade` would also silently remove any future non-inventory view built on these tables.

**Fix.**
- Refuse if any row exists in `tbl_inv_charges`, `tbl_inv_receipts`, `tbl_inv_audit_log` or `tbl_inv_resident_billing` for a non-demo branch, or any global (`owner_branch_id is null`) product or supplier created by a non-demo account. Allow an explicit `set inv.rollback_force = 'I understand'` override.
- Before dropping, list non-inventory dependents from `pg_depend` and abort if there are any.

#### P1-9: MEDIUM: the test harness shares one session across all tests
**Where:** `webapp/scripts/test-inventory.mjs:96–110`.

**Problem.** Every `@test` runs `BEGIN … ROLLBACK` on the **same** PGlite connection. PL/pgSQL plan caches, and anything else session-scoped, carry over between tests. That is exactly what hid P1-1. Other gaps against live:
- **Commits.** Under PostgREST a `{ok:false}` return *commits*. The harness always rolls back, so the rows a rejected call leaves (P1-13) are never seen.
- **Clock.** Tests depend on the real clock (`go_live` = the previous month).
- **Concurrency.** None (acknowledged in §13.4).

Fidelity that is fine, verified live:
- PGlite runs as superuser while live `postgres` is non-superuser, but live `postgres` has BYPASSRLS and owns every table the definer code reads, so definer behaviour matches.
- The default ACL, `auth.uid()`, roles and branch ids match.

**Fix.**
- Run each test in a fresh PGlite instance (snapshot the post-fixture data dir with `dumpDataDir` and reload), or at minimum run `DISCARD ALL` between tests and run the suite twice in reversed order.
- Add a `tests.freeze_today()` override of `fn_inv_today()` for date-edge tests.
- Keep the two-connection concurrency script on the local Supabase stack as a hard pre-production gate.

#### P1-10: MEDIUM: important cases are not tested
Each of these, except the concurrency cases, should run in a fresh session:
- reversal of INTERNAL_TRANSFER, TRANSIT_ALLOCATE, TRANSIT_RELEASE and DAMAGED_EXPIRED after the pool WAC has moved (INT_FIXED/IN_SPEC paths)
- reversal of a *corrected* receipt
- receive-&-allocate where the Transit stock was released (the cascade reports `TRANSIT_ALREADY_ISSUED`, which is the wrong message)
- FOC into a negative pool (P1-3)
- a stale review (P1-2)
- an HQ STAFF login (P1-4)
- threshold splitting (P1-5)
- in-transit at close (P1-6)
- the charge-reversal date (P1-7)
- rollback with real charges (P1-8)
- concurrency:
  - two sessions receiving the same invoice (expect the unique index to fire)
  - two issues of the last unit
  - lock vs posting in the same month
  - cancel vs receive of one transfer
- `inv_lock_period` duration on a synthetic 60k-line branch against the live 8 s `authenticated` statement timeout

#### P1-11: MEDIUM: Phase 1 cannot run a real branch; state the go-live gate
**Where:** §13.3 deferrals.

**Problem.** There are no RPCs for:
- master data
- opening balance
- PRICING
- returns, counts, adjustments, requests
- the exception view

As a result:
- Products can only be created from the SQL editor.
- A PRICE_PENDING resident charge (`010:119–120`) can be cleared only by reversal, which is broken until P1-1 is fixed, and it blocks `inv_lock_period` (`011:793–799`).
- Applying to live is fine, since only DEMO is enabled.

**Fix.** Add an explicit "real-branch `is_enabled` = true only after …" checklist to §10.2:
- master-data RPCs
- opening balance
- PRICING
- the exception view
- the concurrency run
- P1-1 through P1-8

#### P1-12: LOW: charges are readable by the shared branch login (D-148 pending)
**Where:** `008:242`.

**Note.** Rank 2 = the shared STAFF login, so any nurse on it can read every resident's charge amounts and OSEM-expense cost through the REST API. That's acceptable if the owner confirms D-148. If not, change the rank to 3 in the one JSON literal.

#### P1-13: LOW: rejected calls leave empty cache, period and counter rows
**Where:** `009:331–384`, where `fn_inv_lock` inserts before the business checks.

**Problem.** Probe P6: a `NEGATIVE_STOCK_CONFIRM` rejection added 1 balance, 1 counter and 1 period row. Under PostgREST these commit. They're harmless (zero qty, no drift), and `inv.posting` is correctly back to `off`. But period rows appear for months that have only rejected attempts.

**Fix.** Accept and document it, or run `fn_inv_check_buckets` read-only before the inserting lock plan.

#### P1-14: LOW: error codes reveal ids across branches
**Where:** `010:541–547`, and the `*_NOT_FOUND` returns before `fn_inv_can`.

**Problem.** `LOCATION_NOT_FOUND`/`TRANSFER_NOT_FOUND`/`RESIDENT_NOT_FOUND` vs `FORBIDDEN` let a branch login enumerate other branches' ids. The sensitivity is low, since ids are sequential.

**Fix.** Return `NOT_FOUND` for both cases, or run the scope check first.

#### P1-15: LOW: notes for applying to live
- 007's foreign keys take SHARE ROW EXCLUSIVE locks on `tbl_branches`, `tbl_staff`, `tbl_residents` and `tbl_user_accounts` until COMMIT. Add `set local lock_timeout = '5s'` at the top of 007 and apply in a quiet window.
- After applying, verify `pg_proc.proowner = postgres` for every `inv_*`/`fn_inv_*` function (definer semantics depend on it) and run the Supabase security advisor.
- The new FKs make hard deletes of residents, staff, accounts and auth users with inventory history fail, which is desirable. The `migration/scripts/cleanup_test_*` scripts and any dashboard "delete user" now need the DEMO purge first. Note this in `docs/database.md`.
- `create table if not exists` means a re-run never applies a later column change. Future changes must be new numbered files.

#### P1-16: LOW: stale file map in the 007 header
**Where:** `007:7–13`.

**Problem.** The header lists `010_inventory_rpc.sql` and `011_inventory_seed.sql` and says "Apply in order 007 → 011". The real files are 010_rpc_stock, 011_rpc_admin and 012_seed.

**Fix.** Correct the header.

#### P1-17: LOW: grants will drift in future inventory migrations
**Where:** the revoke/grant loops live inside `010:1173–1187` and `011:912–926`.

**Problem.** The live default ACL gives anon EXECUTE on every new function. A Phase 2 file that adds `fn_inv_*` without re-running the loop exposes it.

**Fix.** Move the loop into a standalone `0xx_inventory_grants.sql` that is re-applied after every inventory migration, and keep the anon read-back test (`inventory_v1_tests.sql:837–880`) mandatory.

#### P1-18: LOW: store the paper invoice total for information
**Where:** `007:421–452`.

**Problem.** D-138 drops reconciliation handling, but the owner said the UI may show computed vs paper total for information. Nothing stores the paper figure.

**Fix.** Add a nullable `invoice_total_paper numeric(14,2)`. It doesn't block anything.

#### P1-19: LOW: a concurrent duplicate invoice returns a raw `unique_violation`
**Where:** the pre-check at `010:393–397` vs the index at `007:453`.

**Problem.** Two simultaneous receipts of the same invoice both pass the pre-check. The second fails on `uq_inv_receipts_invoice` with SQLSTATE 23505. That fails safe, but the message isn't friendly.

**Fix.** Map 23505 on that index to `DUPLICATE_INVOICE` in `inventory-rpc.ts`, or catch it in the RPC.

#### P1-20: LOW: bucket valuation won't tie to pool value
**Where:** `008:303–314` (`value_at_wac = round(bucket qty × pool wac, 4)`).

**Problem.** Σ bucket values ≠ pool V because of rounding, negative buckets and PENDING (NULL WAC → 0).

**Fix.** Valuation reports use `tbl_inv_cost_pools.value` (or the closing pool rows) for totals. Bucket values are indicative only.

### P.3 Probe results (PGlite, scratchpad only; nothing added to the repo)

| Probe | Result |
|---|---|
| R1: first reversal of an ISSUE in a fresh session | **raises** `record "v_transfer" is not assigned yet` (P1-1) |
| R2: same, after a transfer-in reversal in the session | succeeds (the plan-cache masking behind P1-9) |
| P1: reverse a PENDING_COST issue (run after R2's warm-up) | pool W becomes 0; the next issue is `WAC / 0.000000` instead of PENDING_COST (P1-3) |
| P2: write off 900 units of a never-costed product | OK, value 0.00 (P1-5) |
| P3: 2 × RM 49.50 write-offs vs RM 50 threshold | both OK (P1-5) |
| P4: back-dated negative OSEM issue after the review | posted; lock OK (P1-2) |
| P5: reverse a SERVICE charge dated before the charge | OK, credit dated 2026-08-01 for a 2026-09-29 charge (P1-7) |
| P6: rows left by a `NEGATIVE_STOCK_CONFIRM` rejection | +1 balance, +1 counter, +1 period; `inv.posting` back to off (P1-13) |
| P7: FOC-only receipt into Q −3 @ 1.00 | W 0.000000, V 0, reval +3.00 (P1-3) |
| P8: HQ STAFF login | scope {1,3,4}; RECEIPT and TRANSIT_RELEASE allowed; posts a BMN receipt (P1-4) |
| P9: 40 units dispatched AMN→BMN, unreceived at lock | AMN closing 60.00, BMN none; RM 40 in no closing figure (P1-6) |
| P10: OSEM issue at PENDING_COST, then first receipt | charge `cost_amount` stays 0.00 and the consumed cost goes to pool revaluation. This is by design (D-55), but the OSEM-expense report must add the variance. |
| Rollback with one real AMN service charge | rollback **ran**, `tbl_inv_charges` dropped (P1-8) |

### P.4 Deviations in §13: assessment

- **D-134** (no roles table; the shared login at Head-Nurse tier; one `fn_inv_can`): **acceptable** and cleanly centralised. Fix the HQ STAFF edge (P1-4). Senior-staff attribution on tier-2 actions is enforced (`fn_inv_check_staff`).
- **D-135** (scope by Function): **correct as built.** NUR = own branch, HQ = non-demo NUR, PHY = nothing including the catalogue, DEMO pinned. Tested and matches the owner's answer.
- **D-136, D-137, D-139, D-140:** **acceptable.** Service products are properly non-stock: a trigger enforces the category ↔ `is_stock_item` rule, and the two RPCs reject each other's item types.
- **D-138** (invoice mandatory, landed-cost spread, no reconciliation): **acceptable.** The landed-total CHECK keeps the header internally consistent. P1-18 is optional.
- **D-142** (correction for receipts only; receipts with allocation are reversed and re-entered): **acceptable.** The netting reproduces the audit's F2 numbers exactly: V 56.25, W 1.125, reval −3.75.
- **D-144, D-146:** **good.** Document whitelists and `service_role` with no privileges.
- **D-145:** **implemented for txn reversal, dispatch cancel and receipt correction, but not for charge reversal** (P1-7).
- **D-147:** **correct intent, defeated by the zero-inflow path** (P1-3).
- **D-148:** needs the owner (P1-12).
- **Deferred RPCs:** fine for applying (DEMO only), but they must gate real go-live (P1-11).

### P.5 Checked and found sound (no finding)

- **Immutability:**
  - UPDATE/DELETE/TRUNCATE on the ledger, charges, audit and idempotency tables raise.
  - Caches accept writes only under `inv.posting` (or `inv.rebuild` + `session_user = postgres`).
  - Document UPDATEs are column- and transition-whitelisted.
  - The only DELETE path is the purge (`session_user = postgres`, demo rows only; PostgREST sessions are `authenticator`).
  - Residual risk: the table owner can still `DISABLE TRIGGER`, which is inherent.
- **SECURITY DEFINER:**
  - every function has `search_path = ''` and schema-qualified names
  - no dynamic SQL built from input (only `%I` over catalog names and the internal `fn_inv_next_id` constant table names)
  - payload readers are regex-validated, with 200-line caps, qty/cost hard caps and text-length checks
  - the branch is always derived from the row acted on before `fn_inv_can`
  - idempotency is looked up *after* the capability check and is bound to account + rpc + payload hash
  - confirmation flags are excluded from the hash
- **WAC:**
  - §5.4 cases, true-up, last-unit residue, the source-WAC carry on branch transfers (IN_SPEC at the dispatched value), and the netted correction are all verified by the suite
  - I1 is checked by `fn_inv_verify_balances` after each scenario
  - the lock refuses on drift, and the rebuild is postgres-only and audited
- **Locking (by reasoning; not testable in PGlite):**
  - every RPC takes the document row, then periods → locations → pools → buckets → counters, each sorted
  - the double `fn_inv_lock` calls in receipt/write-off/correction re-lock the same set
  - cross-branch RPCs lock the transfer row first
  - lock-period uses FOR UPDATE against postings' FOR SHARE on the same month
  - FK KEY SHARE locks on residents, staff and accounts are compatible with the app's non-key UPDATEs
  - **no deadlock cycle found**
  - the per-branch TXN counter row serialises a branch's postings, which is fine at ~1k lines/month
  - Phase 7's count START must follow the same order (location FOR UPDATE, then nothing else)
- **Seed:** matches live ids and codes; the D-133 install assertion matches live data.
- **006:** confirmed applied live (see the verification list at the start of this section).

### Phase 1 fix verification (2026-09-29)

**Method.** I read `docs/inventory-design.md` §13.5–13.7 and D-149–D-155, and the diffs in 007–011, the new 013, the rollback script, the tests and the runner. `npm run test:inventory` passes 49/49. I then re-ran my original probe files, unchanged except for P8 (the fixture now has a `hqstaff` account), against the fixed code on PGlite from the scratchpad only. I added two new probes: review-staleness edge cases, and a per-file privilege check across 006 → 013. There were no live writes and no repo edits apart from this subsection.

| Finding | Status | Evidence |
|---|---|---|
| P1-1 reversal on a fresh connection | **Closed** | R1 (first ISSUE reversal in a fresh session) now returns `ok`. Code: the transfer id and status are scalars and the check is a nested `if` (`011:111–112, 160, 175`). The runner uses a fresh session per test; the executor's mutation check fails 6 tests. |
| P1-2 stale review | **Closed** | P4: a back-dated negative issue after the review gives `EXCEPTIONS_STALE`. Reviewing the current month gives `MONTH_NOT_ENDED`. A posting dated in the *current* month does **not** make last month's review stale (the lock returned OK). The watermark is `clock_timestamp()` taken under the period's FOR UPDATE; postings hold FOR SHARE and write `posted_at`, and charges `created_at` (both now defaulting to `clock_timestamp()`), so a posting that overlaps the review either finishes before the watermark or is stamped after it. No race found. |
| P1-3 zero-value inflow at Q ≤ 0 | **Closed** (see V-2 on the FOC valuation policy) | P1: after reversing a PENDING issue, W stays NULL and the next issue is `PENDING_COST`. P7: FOC-only into Q −3 @ 1.00 now gives W 1.000000, V 7.00, reval +10.00 (was W 0). |
| P1-4 HQ STAFF tier | **Closed** | V8: rank 0, `fn_inv_can('RECEIPT', BMN)` false, receipt `FORBIDDEN`. It can still read the catalogue (8 products) and its scope, as D-150 intends. |
| P1-5 write-off threshold | **Closed** | P2: 900 uncosted units gives `WRITE_OFF_NEEDS_APPROVAL`. P3: 2 × 49.50 gives OK, then `WRITE_OFF_NEEDS_APPROVAL`. The daily sum is re-checked after `fn_inv_lock`. Because the branch TXN counter row is locked by then, concurrent write-offs serialise and the cumulative check can't be raced. |
| P1-6 in transit at close | **Closed** | P9: AMN closing rows 60.00 (stock) + 40.00 (`in_transit_transfer_id`); the RM 40 is accounted for. |
| P1-7 credit before the charge | **Closed** | P5 returns `DATE_BEFORE_ORIGINAL`; no REVERSAL row written. |
| P1-8 rollback guard | **Closed** | A real AMN service charge makes the rollback refuse and list every table holding real or global rows. The override and dependent-object checks are covered by 3 runner tests. |

Regression checks on the other fixes:
- **P1-13:** P6 now leaves +0 rows after `NEGATIVE_STOCK_CONFIRM`. The read-only pre-checks (`fn_inv_state_problem`, bucket check, sanity, write-off limit) are **repeated on locked rows** before writing (`010:148–171`), so no TOCTOU was introduced.
- **P1-19:** only the receipt write sits in the sub-block. It catches `unique_violation` **only** for `uq_inv_receipts_invoice` and re-raises anything else. Rolling back the subtransaction also undoes the ledger rows, the counter increment and the local `inv.posting` GUC. A concurrent duplicate waits at the branch counter lock, then hits the index and gets `DUPLICATE_INVOICE`. The logic is sound; it still needs the two-session run in §13.6.
- **013:** catalog-driven (all r/v/m/S tables and views, `inv_*`/`fn_inv_*` functions), with an aborting read-back. After 013: anon 0, authenticated SELECT-only, no `fn_inv_*` EXECUTE. But see V-1 on the window before it runs.

**New findings**

- **V-1: MEDIUM: exposure window between the migration files.** The per-file grant loops were moved into 013, and RLS is enabled only in 008. I measured privileges after each file on PGlite with the live default ACL:

  | After file | Tables where anon can INSERT | Tables with RLS on | Functions anon can EXECUTE |
  |---|---|---|---|
  | 007 | 34 | 0 | 14 |
  | 008–012 | 34 | 34 | up to 83 |
  | 013 | 0 | 34 | 0 |

  - From 007's COMMIT to 008's, anyone with the public anon key can INSERT through PostgREST, which reloads its schema cache on DDL. They could insert rows into every inventory table, e.g. a global product with a chosen `charge_price`, or ledger rows. Those rows then **can't be deleted**: the immutability and no-delete triggers allow deletes only through the DEMO purge.
  - From 008 to 013, RLS blocks anon DML, but internal SECURITY DEFINER helpers stay executable by anon. For example, `fn_inv_check_staff` reveals whether a StaffID exists, its status and whether it is senior.

  **Fix (a condition for applying):** apply 007–013 as **one transaction**, e.g. concatenate them into a single SQL-editor run or one `apply_migration`. The `begin;`/`commit;` lines inside each file would need removing for that. Alternatively, end 007 with `enable row level security` plus `revoke all … from public, anon, authenticated, service_role` on every table it creates. Add this to §13.7 step 1. The same applies to any future file that creates tables before 013 is re-run.
- **V-2: LOW: D-149 values FOC stock at the previous WAC when stock is negative, and I overstated my original P1-3 on this point.** For the FOC part of P1-3, the pre-fix result (W 0, V 0, reval +3) *was* consistent with the documented negative-stock rule (D-55: the incoming cost replaces the cost of units issued while negative). So only the PENDING-reversal half of P1-3 was a defect. D-149 now values the free units at the old WAC: V 7.00 and a +10.00 revaluation gain, and later issues cost 1.00. Hindsight AVCO would give 3.50. All three results preserve total value; they only split it differently between stock and consumption. Treat this as an explicit owner/accounts policy choice, not a correctness bug; it isn't a blocker.
- **V-3: LOW: leftover rows on the write-off path.** A write-off that crosses the daily limit only under the lock (a concurrent write-off in between) returns after `fn_inv_lock` has inserted its empty pool, bucket and period rows (`010:938–946`). This is the P1-13 behaviour on a rare race; harmless.
- **V-4: LOW: the test fixture replaces the production `fn_inv_today()`.** `01_fixture.sql:53–60` redefines it to honour `inv.test_today`, so the suite never runs the production definition. Add one test that runs the 009 body (e.g. re-create it from the migration text) and checks it equals `(now() at time zone 'Asia/Kuala_Lumpur')::date`.

**Verdict: SAFE TO APPLY 007–013 TO LIVE, on one condition: apply all seven files in a single transaction (V-1), or amend 007 as described.**
- With that condition met, anon never sees the new objects; P1-1 to P1-8 are closed; the seed enables only DEMO.
- The open items that must not ship to real branches are gated by §13.6: the concurrency run, the missing RPCs and the exception view, D-148, and the 8 s lock timing.
- After applying, follow §13.7: the owner read-back, the security advisor, and the `docs/database.md` note on FK-blocked deletes. Purge DEMO test data with `fn_inv_purge_demo()` when verification is done.
