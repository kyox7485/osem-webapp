-- ============================================================================
-- 008 — General Inventory: who may see and do what (D-134, D-135, D-126)
-- ============================================================================
-- * fn_inv_current_account()   the ACTIVE login behind auth.uid()
-- * inv_accessible_branch_ids() branch scope (policy helper, D-135):
--       demo login → its own demo branch
--       PHY login  → nothing (Inventory is not for physio)
--       HQ login   → every non-demo NUR branch
--       NUR login  → its own branch
-- * fn_inv_action_tier() + fn_inv_rank_for_rights() + fn_inv_can()
--       THE single place that decides capabilities (D-134). V1: the shared
--       branch login is Head-Nurse tier; switching to individual Head Nurse
--       logins later changes fn_inv_rank_for_rights only.
-- * RLS: SELECT-only policies on every tbl_inv_* table; no client writes.
-- * Views are security_invoker, so they obey the same RLS.
-- * Grants: anon gets nothing; authenticated gets SELECT on tables/views and
--   EXECUTE on the inv_* policy helpers only (RPC grants are in 010).
--
-- Every function: SECURITY DEFINER where it must read tables the caller
-- cannot, `set search_path = ''`, schema-qualified names, and no calls to
-- the legacy auth_*() helpers (D-126).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Identity and scope
-- ----------------------------------------------------------------------------

create or replace function public.fn_inv_current_account()
returns table (account_id bigint, auth_user_id uuid, branch_id bigint, rights text,
               branch_code text, branch_function text, is_demo boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.auth_user_id, a.branch_id, a.rights::text, b."BranchCode", b."Function", b.is_demo
  from public.tbl_user_accounts a
  join public.tbl_branches b on b."BranchID" = a.branch_id
  where a.auth_user_id = auth.uid()
    and a.status = 'ACTIVE'
$$;

create or replace function public.inv_accessible_branch_ids()
returns bigint[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_acc record;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return '{}'::bigint[];
  end if;
  if v_acc.is_demo then
    return case when v_acc.branch_function = 'NUR' then array[v_acc.branch_id] else '{}'::bigint[] end;
  end if;
  if v_acc.branch_function = 'HQ' then
    return coalesce((select array_agg(b."BranchID" order by b."BranchID")
                     from public.tbl_branches b
                     where b."Function" = 'NUR' and not b.is_demo), '{}'::bigint[]);
  end if;
  if v_acc.branch_function = 'NUR' then
    return array[v_acc.branch_id];
  end if;
  return '{}'::bigint[];   -- PHY and anything else: no inventory access (D-135)
end $$;

-- ----------------------------------------------------------------------------
-- 2. Capabilities: the one place (D-134)
-- ----------------------------------------------------------------------------

-- Rank of a login. 1 = staff tier, 2 = Head-Nurse tier, 3 = moderator, 4 = admin.
-- V1 (Q-1): each nursing branch has one shared STAFF login and it acts at
-- Head-Nurse tier; the real person is attributed through a staff picker that
-- HN-tier actions restrict to senior positions (fn_inv_check_staff).
-- Only a NUR branch's STAFF login gets that tier: an HQ (or any other) STAFF
-- login gets 0 — it can read what its scope shows but perform nothing (audit
-- P1-4, D-150). HQ management and review is done by MODERATOR/ADMIN logins.
-- LATER (individual Head Nurse logins): return 1 for NUR STAFF here and
-- resolve rank 2 from a grant — nothing else has to change.
drop function if exists public.fn_inv_rank_for_rights(text);
create or replace function public.fn_inv_rank_for_rights(p_rights text, p_branch_function text)
returns int
language sql immutable set search_path = '' as $$
  select case
    when p_rights = 'ADMIN' then 4
    when p_rights = 'MODERATOR' then 3
    when p_rights = 'STAFF' and p_branch_function = 'NUR' then 2
    else 0
  end
$$;

-- Tier each action needs: 1 STAFF, 2 HEAD_NURSE, 3 MODERATOR, 4 ADMIN, 5 HQ_ADMIN.
-- Actions at tier 2 also require a senior staff member as performer (D-134).
create or replace function public.fn_inv_action_tier(p_action text)
returns int
language sql immutable set search_path = '' as $$
  select case p_action
    when 'VIEW'                then 1
    when 'ISSUE'               then 1
    when 'INTERNAL_TRANSFER'   then 1
    when 'TRANSIT_ALLOCATE'    then 1
    when 'BRANCH_DISPATCH'     then 1
    when 'BRANCH_RECEIVE'      then 1
    when 'WRITE_OFF'           then 1
    when 'SERVICE_CHARGE'      then 1
    when 'RETURN_FROM_ISSUE'   then 1
    when 'COUNT'               then 1
    when 'TRANSIT_RELEASE'     then 2
    when 'BRANCH_CANCEL'       then 2
    when 'RECEIPT'             then 2
    when 'RETURN_TO_SUPPLIER'  then 2
    when 'STOCK_REQUEST'       then 2
    when 'COUNT_INVESTIGATE'   then 2
    when 'ADJUSTMENT_REQUEST'  then 2
    when 'SUPPLIER_EDIT'       then 2
    when 'BARCODE_ATTACH'      then 2
    when 'VIEW_CHARGES'        then 2
    when 'REVERSE'             then 3
    when 'CORRECT'             then 3
    when 'ADJUSTMENT_APPROVE'  then 3
    when 'REQUEST_APPROVE'     then 4   -- owner 2026-09-29: ADMIN only (approve/reject, mark ordered)
    when 'EXCEPTIONS_REVIEW'   then 3
    when 'PERIOD_LOCK'         then 3
    when 'PRICE_PENDING'       then 3
    when 'MANUAL_CHARGE_ADJ'   then 3
    when 'EXPORT'              then 3
    when 'BILLING_CODES'       then 3
    when 'VIEW_AUDIT'          then 3
    when 'REVERSE_OPENING'     then 4
    when 'OPENING_BALANCE'     then 4
    when 'PERIOD_REOPEN'       then 4
    when 'STOCK_LEVELS'        then 4
    when 'BRANCH_SETTINGS'     then 4
    when 'VERIFY_BALANCES'     then 4
    when 'MASTER_DATA_DEMO'    then 4   -- demo-owned rows, branch = the demo branch
    when 'MASTER_DATA'         then 5   -- global rows (D-102)
    else null
  end
$$;

create or replace function public.fn_inv_is_hq_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.rights = 'ADMIN' and a.branch_function = 'HQ' and not a.is_demo
                   from public.fn_inv_current_account() a), false)
$$;

-- May the current login perform p_action on p_branch_id?  p_branch_id must be
-- derived from the row acted on (location, document, resident), never from
-- an unchecked client argument (D-126).
create or replace function public.fn_inv_can(p_action text, p_branch_id bigint)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tier int := public.fn_inv_action_tier(p_action);
  v_acc record;
begin
  if v_tier is null then
    return false;
  end if;
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return false;
  end if;
  if v_tier = 5 then
    return public.fn_inv_is_hq_admin();
  end if;
  if p_branch_id is null or not (p_branch_id = any (public.inv_accessible_branch_ids())) then
    return false;
  end if;
  return public.fn_inv_rank_for_rights(v_acc.rights, v_acc.branch_function) >= v_tier;
end $$;

create or replace function public.fn_inv_needs_senior_staff(p_action text)
returns boolean
language sql immutable set search_path = '' as $$
  select public.fn_inv_action_tier(p_action) = 2
$$;

-- Attribution check. Returns an error code, or NULL when the staff member may
-- be recorded as the performer of an action on p_branch_id.
create or replace function public.fn_inv_check_staff(p_staff text, p_branch_id bigint, p_senior boolean)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
  v_target_demo boolean;
begin
  if p_staff is null or length(p_staff) > 40 then
    return 'STAFF_REQUIRED';
  end if;
  select s."StaffID", s.branch_id, s.status, s.role::text as role, p.name as position_name,
         b."Function" as branch_function, b.is_demo
    into v
    from public.tbl_staff s
    join public.tbl_positions p on p.id = s.position_id
    join public.tbl_branches b on b."BranchID" = s.branch_id
   where s."StaffID" = p_staff;
  if not found then
    return 'STAFF_NOT_FOUND';
  end if;
  if v.status <> 'ACTIVE' then
    return 'STAFF_INACTIVE';
  end if;
  select b.is_demo into v_target_demo from public.tbl_branches b where b."BranchID" = p_branch_id;
  if not (v.branch_id = p_branch_id
          or (v.branch_function = 'HQ' and not v.is_demo and not coalesce(v_target_demo, true))) then
    return 'STAFF_WRONG_BRANCH';
  end if;
  if p_senior and not (v.position_name in ('Head Nurse','Assist. Head Nurse','Nursing Director') or v.role = 'ADMIN') then
    return 'STAFF_NOT_SENIOR';
  end if;
  return null;
end $$;

-- Policy helpers (granted to authenticated; they reveal only facts about the caller).
create or replace function public.inv_my_rank()
returns int
language sql stable security definer set search_path = '' as $$
  select case when cardinality(public.inv_accessible_branch_ids()) = 0 then 0
              else coalesce((select public.fn_inv_rank_for_rights(a.rights, a.branch_function) from public.fn_inv_current_account() a), 0)
         end
$$;

create or replace function public.inv_is_hq_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.fn_inv_is_hq_admin()
$$;

-- ----------------------------------------------------------------------------
-- 3. Row level security: SELECT-only policies (D-84, D-115)
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  v_all text[] := array['tbl_inv_uoms','tbl_inv_categories','tbl_inv_suppliers','tbl_inv_products',
    'tbl_inv_product_uoms','tbl_inv_product_barcodes','tbl_inv_branch_settings','tbl_inv_locations',
    'tbl_inv_stock_levels','tbl_inv_resident_billing','tbl_inv_billing_periods','tbl_inv_period_closing',
    'tbl_inv_counters','tbl_inv_idempotency','tbl_inv_txns','tbl_inv_txn_lines','tbl_inv_cost_pools',
    'tbl_inv_balances','tbl_inv_stock_requests','tbl_inv_stock_request_lines','tbl_inv_stock_request_events',
    'tbl_inv_receipts','tbl_inv_receipt_lines','tbl_inv_counts','tbl_inv_count_lines',
    'tbl_inv_branch_transfers','tbl_inv_branch_transfer_lines','tbl_inv_adjustments','tbl_inv_adjustment_lines',
    'tbl_inv_branch_transfer_receipts','tbl_inv_charges','tbl_inv_charge_exports','tbl_inv_charge_export_items',
    'tbl_inv_audit_log'];
  -- plain branch scope
  v_branch text[] := array['tbl_inv_branch_settings','tbl_inv_locations','tbl_inv_stock_levels',
    'tbl_inv_billing_periods','tbl_inv_period_closing','tbl_inv_txns','tbl_inv_txn_lines','tbl_inv_cost_pools',
    'tbl_inv_balances','tbl_inv_stock_requests','tbl_inv_stock_request_lines','tbl_inv_stock_request_events',
    'tbl_inv_receipts','tbl_inv_receipt_lines','tbl_inv_counts','tbl_inv_count_lines','tbl_inv_adjustments',
    'tbl_inv_adjustment_lines'];
  -- branch scope + minimum rank
  v_ranked jsonb := '{"tbl_inv_charges": 2, "tbl_inv_resident_billing": 3,
                      "tbl_inv_charge_exports": 3, "tbl_inv_charge_export_items": 3}';
begin
  foreach t in array v_all loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists inv_select on public.%I', t);
  end loop;

  foreach t in array v_branch loop
    execute format('create policy inv_select on public.%I for select to authenticated
                    using (branch_id = any ((select public.inv_accessible_branch_ids())::bigint[]))', t);
  end loop;

  for t in select jsonb_object_keys(v_ranked) loop
    execute format('create policy inv_select on public.%I for select to authenticated
                    using (branch_id = any ((select public.inv_accessible_branch_ids())::bigint[])
                           and (select public.inv_my_rank()) >= %s)', t, (v_ranked->>t)::int);
  end loop;
end $$;

-- Master data: global rows for anyone with inventory scope; demo-owned rows
-- only for that demo branch (D-102). PHY logins have empty scope → nothing.
create policy inv_select on public.tbl_inv_uoms for select to authenticated
  using (cardinality((select public.inv_accessible_branch_ids())::bigint[]) > 0);
create policy inv_select on public.tbl_inv_categories for select to authenticated
  using (cardinality((select public.inv_accessible_branch_ids())::bigint[]) > 0);
create policy inv_select on public.tbl_inv_suppliers for select to authenticated
  using (cardinality((select public.inv_accessible_branch_ids())::bigint[]) > 0
         and (owner_branch_id is null or owner_branch_id = any ((select public.inv_accessible_branch_ids())::bigint[])));
create policy inv_select on public.tbl_inv_products for select to authenticated
  using (cardinality((select public.inv_accessible_branch_ids())::bigint[]) > 0
         and (owner_branch_id is null or owner_branch_id = any ((select public.inv_accessible_branch_ids())::bigint[])));
create policy inv_select on public.tbl_inv_product_barcodes for select to authenticated
  using (cardinality((select public.inv_accessible_branch_ids())::bigint[]) > 0
         and (owner_branch_id is null or owner_branch_id = any ((select public.inv_accessible_branch_ids())::bigint[])));
create policy inv_select on public.tbl_inv_product_uoms for select to authenticated
  using (exists (select 1 from public.tbl_inv_products p where p.id = product_id));   -- inherits products' policy

-- Branch transfers are visible to both ends.
create policy inv_select on public.tbl_inv_branch_transfers for select to authenticated
  using (from_branch_id = any ((select public.inv_accessible_branch_ids())::bigint[])
         or to_branch_id = any ((select public.inv_accessible_branch_ids())::bigint[]));
create policy inv_select on public.tbl_inv_branch_transfer_lines for select to authenticated
  using (exists (select 1 from public.tbl_inv_branch_transfers t where t.id = transfer_id));
create policy inv_select on public.tbl_inv_branch_transfer_receipts for select to authenticated
  using (exists (select 1 from public.tbl_inv_branch_transfers t where t.id = transfer_id));

-- Audit: MODERATOR+ in scope; global master-data rows for HQ ADMIN only.
create policy inv_select on public.tbl_inv_audit_log for select to authenticated
  using ((select public.inv_my_rank()) >= 3
         and (branch_id = any ((select public.inv_accessible_branch_ids())::bigint[])
              or (branch_id is null and owner_branch_id = any ((select public.inv_accessible_branch_ids())::bigint[]))
              or (branch_id is null and owner_branch_id is null and (select public.inv_is_hq_admin()))));

-- tbl_inv_counters and tbl_inv_idempotency: RLS on, no policy → invisible.

-- ----------------------------------------------------------------------------
-- 4. Views (security_invoker: the caller's RLS applies)
-- ----------------------------------------------------------------------------

-- Stock on hand per bucket with effective max (D-101) and pool WAC.
create or replace view public.v_inv_stock_balance with (security_invoker = true) as
select b.branch_id, b.location_id, l.kind as location_kind, b.product_id, p.sku, p.name as product_name,
       p.category_id, b.resident_id, b.qty,
       case l.kind when 'STORE' then coalesce(sl.max_qty, p.default_max_store)
                   when 'FLOOR' then coalesce(sl.max_qty, p.default_max_floor) end as effective_max,
       cp.wac as pool_wac,
       round(b.qty * coalesce(cp.wac, 0), 4) as value_at_wac
from public.tbl_inv_balances b
join public.tbl_inv_locations l on l.id = b.location_id
join public.tbl_inv_products p on p.id = b.product_id
left join public.tbl_inv_stock_levels sl on sl.location_id = b.location_id and sl.product_id = b.product_id
left join public.tbl_inv_cost_pools cp on cp.branch_id = b.branch_id and cp.product_id = b.product_id;

-- Suggested order per branch × product (D-119, Q-18 agreed):
--   max_total = eff_max(STORE) + eff_max(FLOOR), each default applied once
--   suggested = max_total − on hand (STORE + FLOOR) − approved-but-undelivered
--   shown in base and in the purchase UOM (ceil).
create or replace view public.v_inv_suggested_order with (security_invoker = true) as
with loc as (
  select l.id, l.branch_id, l.kind
  from public.tbl_inv_locations l
  where l.kind in ('STORE','FLOOR') and l.is_active
), per_loc as (
  select loc.branch_id, p.id as product_id, loc.kind,
         case loc.kind when 'STORE' then coalesce(sl.max_qty, p.default_max_store)
                       else coalesce(sl.max_qty, p.default_max_floor) end as eff_max,
         coalesce(bal.qty, 0) as on_hand
  from loc
  join public.tbl_inv_products p
    on p.is_stock_item and p.is_active and (p.owner_branch_id is null or p.owner_branch_id = loc.branch_id)
  left join public.tbl_inv_stock_levels sl on sl.location_id = loc.id and sl.product_id = p.id
  left join public.tbl_inv_balances bal on bal.location_id = loc.id and bal.product_id = p.id and bal.resident_id is null
), agg as (
  select branch_id, product_id,
         sum(eff_max) filter (where kind = 'STORE') as max_store,
         sum(eff_max) filter (where kind = 'FLOOR') as max_floor,
         sum(on_hand) as on_hand
  from per_loc group by branch_id, product_id
), open_req as (
  select rl.branch_id, rl.product_id,
         sum(greatest(coalesce(rl.approved_qty, 0) - coalesce((
           select sum(rcl.qty_base) from public.tbl_inv_receipt_lines rcl
           join public.tbl_inv_receipts r on r.id = rcl.receipt_id and not r.is_voided
           where rcl.request_line_id = rl.id), 0), 0)) as open_qty
  from public.tbl_inv_stock_request_lines rl
  join public.tbl_inv_stock_requests rq on rq.id = rl.request_id
  where rq.status in ('APPROVED','ORDERED','PARTIALLY_RECEIVED') and rl.closed_short_at is null
  group by rl.branch_id, rl.product_id
)
select a.branch_id, a.product_id, p.sku, p.name as product_name,
       a.max_store, a.max_floor,
       coalesce(a.max_store, 0) + coalesce(a.max_floor, 0) as max_total,
       a.on_hand,
       coalesce(o.open_qty, 0) as open_request_qty,
       greatest(coalesce(a.max_store, 0) + coalesce(a.max_floor, 0) - a.on_hand - coalesce(o.open_qty, 0), 0) as suggested_base,
       pu.uom_id as purchase_uom_id, u.code as purchase_uom_code, pu.factor_to_base as purchase_factor,
       ceil(greatest(coalesce(a.max_store, 0) + coalesce(a.max_floor, 0) - a.on_hand - coalesce(o.open_qty, 0), 0)
            / pu.factor_to_base) as suggested_purchase_qty
from agg a
join public.tbl_inv_products p on p.id = a.product_id
join public.tbl_inv_product_uoms pu on pu.product_id = p.id and pu.uom_id = p.purchase_uom_id
join public.tbl_inv_uoms u on u.id = pu.uom_id
left join open_req o on o.branch_id = a.branch_id and o.product_id = a.product_id
where a.max_store is not null or a.max_floor is not null;

-- Grants for everything above: schema/013_inventory_grants.sql (audit P1-17).

-- Nothing this file created is reachable through the API until 013 (audit V-1).
select public.fn_inv_lockdown();

commit;
