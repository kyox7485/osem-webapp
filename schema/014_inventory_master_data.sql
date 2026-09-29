-- ============================================================================
-- 014 — General Inventory: master-data RPCs (Phase 3 prerequisite)
-- ============================================================================
-- inv_save_product        create/update a product + its UOM conversions
-- inv_add_barcode         attach a barcode to a product UOM
-- inv_deactivate_barcode  deactivate a barcode (master-data editors only)
-- inv_save_supplier       create/update a supplier
-- inv_set_stock_level     per-location max qty (STORE/FLOOR) override
--
-- Who (§8.3/§8.4, D-102, D-134, D-135):
--   * global rows (owner_branch_id NULL): HQ ADMIN that is not a demo login
--   * demo-owned rows: an ADMIN of that demo branch (the DEMO `test` login);
--     a demo login always creates demo-owned rows and never edits global ones
--   * suppliers and barcode attach (global rows): also the Head-Nurse tier of a
--     real NUR branch, attributed to a senior staff member (fn_inv_check_staff)
--   * stock levels: ADMIN of the location's branch (tier STOCK_LEVELS)
-- UOM rules (D-106): base UOM factor 1, every other factor > 1; factor_to_base
-- and the base UOM cannot change once used; the stock-item flag follows the
-- category (D-137) and cannot change once used. These are pre-checked here so
-- the caller gets a code, not the 007 guard-trigger exception.
--
-- Same RPC contract as 010: (p_payload jsonb, p_key uuid) → {ok, code, data};
-- idempotent on p_key; audited. Master data is never deleted (deactivate).
-- Apply after 013, then RE-RUN 013_inventory_grants.sql (it is catalog-driven).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Helpers (internal)
-- ----------------------------------------------------------------------------

-- May the caller edit master-data rows owned by p_owner (NULL = global)?
create or replace function public.fn_inv_master_can(p_owner bigint)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_owner is null then
    return public.fn_inv_is_hq_admin();
  end if;
  return exists (select 1 from public.tbl_branches b where b."BranchID" = p_owner and b.is_demo)
     and public.fn_inv_can('MASTER_DATA_DEMO', p_owner);
end $$;

-- Owner for a NEW master-data row created by the caller: a demo login owns
-- what it creates (D-102); everyone else creates global rows.
create or replace function public.fn_inv_new_owner()
returns bigint
language sql stable security definer set search_path = '' as $$
  select case when a.is_demo then a.branch_id end from public.fn_inv_current_account() a
$$;

-- Branch-login path for global suppliers/barcodes (tier 2 at the caller's own
-- real branch + a senior performer). Returns NULL when allowed, else a code.
create or replace function public.fn_inv_branch_master_problem(p_action text, p_staff text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_acc record;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found or v_acc.is_demo or not public.fn_inv_can(p_action, v_acc.branch_id) then
    return 'FORBIDDEN';
  end if;
  return public.fn_inv_check_staff(p_staff, v_acc.branch_id, true);
end $$;

-- One audit event for master data (branch_id NULL; owner_branch_id set for
-- demo-owned rows so the demo login's own audit rows stay in its scope).
create or replace function public.fn_inv_audit_master(p_action text, p_entity text, p_entity_id text, p_owner bigint,
  p_staff text, p_key uuid, p_after jsonb, p_before jsonb default null)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_acc record;
begin
  select * into v_acc from public.fn_inv_current_account();
  insert into public.tbl_inv_audit_log (action, entity, entity_id, branch_id, owner_branch_id, account_id, auth_user_id,
                                        staff_id, request_key, before_data, after_data)
  values (p_action, p_entity, p_entity_id, null, p_owner, v_acc.account_id, v_acc.auth_user_id, p_staff, p_key,
          p_before, p_after);
end $$;

-- Is the product used anywhere that freezes its base UOM / stock flag (D-106)?
create or replace function public.fn_inv_product_used(p_product_id bigint)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.tbl_inv_txn_lines l where l.product_id = p_product_id)
      or exists (select 1 from public.tbl_inv_receipt_lines r where r.product_id = p_product_id)
      or exists (select 1 from public.tbl_inv_charges c where c.product_id = p_product_id)
$$;

create or replace function public.fn_inv_product_uom_used(p_product_id bigint, p_uom_id bigint)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.tbl_inv_txn_lines l where l.product_id = p_product_id and l.uom_id = p_uom_id)
      or exists (select 1 from public.tbl_inv_receipt_lines r where r.product_id = p_product_id and r.uom_id = p_uom_id)
      or exists (select 1 from public.tbl_inv_product_barcodes b where b.product_id = p_product_id and b.uom_id = p_uom_id)
$$;

-- Optional non-negative money/qty field: NULL when absent, -1 when malformed.
create or replace function public.fn_inv_jnum_opt(p jsonb, p_max numeric, p_scale int)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when p is null or jsonb_typeof(p) = 'null' then null
    when public.fn_inv_jnum(p) is null then -1
    when public.fn_inv_jnum(p) < 0 or public.fn_inv_jnum(p) > p_max then -1
    when public.fn_inv_jnum(p) <> round(public.fn_inv_jnum(p), p_scale) then -1
    else public.fn_inv_jnum(p)
  end
$$;

-- ----------------------------------------------------------------------------
-- inv_save_product (global: HQ ADMIN; demo-owned: the demo ADMIN)
-- payload: {id?, sku, name, description?, category_id, base_uom_id, purchase_uom_id,
--   default_supplier_id?, standard_unit_cost?, is_chargeable, charge_price?,
--   default_max_store?, default_max_floor?, is_active,
--   uoms: [{uom_id, factor_to_base}]   -- full list; the base row (factor 1) is implied
-- }
-- ----------------------------------------------------------------------------
create or replace function public.inv_save_product(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_save_product';
  v_acc record;
  v_id bigint := public.fn_inv_jbigint(p_payload->'id');
  v_old public.tbl_inv_products;
  v_owner bigint;
  v_replay jsonb;
  v_sku text := public.fn_inv_jtext(p_payload->'sku');
  v_name text := public.fn_inv_jtext(p_payload->'name');
  v_desc text := public.fn_inv_jtext(p_payload->'description');
  v_cat record;
  v_base bigint := public.fn_inv_jbigint(p_payload->'base_uom_id');
  v_purchase bigint := public.fn_inv_jbigint(p_payload->'purchase_uom_id');
  v_supplier bigint := public.fn_inv_jbigint(p_payload->'default_supplier_id');
  v_std numeric := public.fn_inv_jnum_opt(p_payload->'standard_unit_cost', 100000, 6);
  v_price numeric := public.fn_inv_jnum_opt(p_payload->'charge_price', 100000, 4);
  v_max_s numeric := public.fn_inv_jnum_opt(p_payload->'default_max_store', 1000000, 4);
  v_max_f numeric := public.fn_inv_jnum_opt(p_payload->'default_max_floor', 1000000, 4);
  v_chargeable boolean := coalesce((p_payload->>'is_chargeable')::boolean, true);
  v_active boolean := coalesce((p_payload->>'is_active')::boolean, true);
  v_uoms jsonb := '[]';
  u jsonb;
  v_uom_id bigint;
  v_factor numeric;
  v_used boolean;
  v_row public.tbl_inv_products;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object'
     or (p_payload ? 'uoms' and jsonb_typeof(p_payload->'uoms') <> 'array')
     or jsonb_array_length(coalesce(p_payload->'uoms', '[]')) > 20
     or (p_payload ? 'is_chargeable' and jsonb_typeof(p_payload->'is_chargeable') <> 'boolean')
     or (p_payload ? 'is_active' and jsonb_typeof(p_payload->'is_active') <> 'boolean') then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  if v_id is not null then
    select * into v_old from public.tbl_inv_products p where p.id = v_id;
    if not found then
      return public.fn_inv_err('FORBIDDEN');   -- unknown = out of scope (audit P1-14)
    end if;
    v_owner := v_old.owner_branch_id;
  else
    v_owner := public.fn_inv_new_owner();
  end if;
  if not public.fn_inv_master_can(v_owner) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;

  -- shape and ranges
  if v_sku is null or v_sku !~ '^[A-Za-z0-9._-]{1,40}$' then
    return public.fn_inv_err('INVALID_SKU');
  end if;
  if v_name is null or length(v_name) > 160 or (v_desc is not null and length(v_desc) > 1000) then
    return public.fn_inv_err('INVALID_NAME');
  end if;
  if v_std = -1 or v_price = -1 or v_max_s = -1 or v_max_f = -1 then
    return public.fn_inv_err('INVALID_NUMBER');
  end if;
  select c.id, c.is_service, c.is_active into v_cat from public.tbl_inv_categories c
   where c.id = public.fn_inv_jbigint(p_payload->'category_id');
  if not found or (not v_cat.is_active and (v_id is null or v_old.category_id <> v_cat.id)) then
    return public.fn_inv_err('CATEGORY_NOT_FOUND');
  end if;
  if v_cat.is_service and (v_max_s is not null or v_max_f is not null) then
    return public.fn_inv_err('SERVICE_HAS_NO_MAX');                    -- D-137
  end if;
  if v_base is null or v_purchase is null
     or not exists (select 1 from public.tbl_inv_uoms x where x.id = v_base and x.is_active)
     or not exists (select 1 from public.tbl_inv_uoms x where x.id = v_purchase and x.is_active) then
    return public.fn_inv_err('UOM_NOT_FOUND');
  end if;
  if v_supplier is not null and not exists (
       select 1 from public.tbl_inv_suppliers s where s.id = v_supplier and s.is_active
          and (s.owner_branch_id is null or s.owner_branch_id is not distinct from v_owner)) then
    return public.fn_inv_err('SUPPLIER_NOT_FOUND');
  end if;
  if exists (select 1 from public.tbl_inv_products p where coalesce(p.owner_branch_id, 0) = coalesce(v_owner, 0)
              and p.sku = v_sku and p.id is distinct from v_id) then
    return public.fn_inv_err('SKU_EXISTS');
  end if;

  -- conversions: the base row is implied (factor 1); every other factor > 1 (D-106)
  v_uoms := jsonb_build_array(jsonb_build_object('uom_id', v_base, 'factor', 1));
  for u in select * from jsonb_array_elements(coalesce(p_payload->'uoms', '[]')) loop
    v_uom_id := public.fn_inv_jbigint(u->'uom_id');
    v_factor := public.fn_inv_jnum(u->'factor_to_base');
    if v_uom_id is null or not exists (select 1 from public.tbl_inv_uoms x where x.id = v_uom_id and x.is_active) then
      return public.fn_inv_err('UOM_NOT_FOUND');
    end if;
    if v_uom_id = v_base then
      if v_factor is not null and v_factor <> 1 then
        return public.fn_inv_err('UOM_FACTOR_INVALID', null, jsonb_build_object('uom_id', v_uom_id));
      end if;
      continue;
    end if;
    if v_factor is null or v_factor <= 1 or v_factor > 100000 or v_factor <> round(v_factor, 6) then
      return public.fn_inv_err('UOM_FACTOR_INVALID', null, jsonb_build_object('uom_id', v_uom_id));
    end if;
    if exists (select 1 from jsonb_array_elements(v_uoms) x where (x->>'uom_id')::bigint = v_uom_id) then
      return public.fn_inv_err('DUPLICATE_LINE', null, jsonb_build_object('uom_id', v_uom_id));
    end if;
    v_uoms := v_uoms || jsonb_build_array(jsonb_build_object('uom_id', v_uom_id, 'factor', v_factor));
  end loop;
  if not exists (select 1 from jsonb_array_elements(v_uoms) x where (x->>'uom_id')::bigint = v_purchase) then
    return public.fn_inv_err('PURCHASE_UOM_MISSING');
  end if;

  -- immutability once used (D-106, D-137)
  if v_id is not null then
    v_used := public.fn_inv_product_used(v_id);
    if v_used and v_old.base_uom_id <> v_base then
      return public.fn_inv_err('BASE_UOM_LOCKED');
    end if;
    if v_used and v_old.is_stock_item = v_cat.is_service then
      return public.fn_inv_err('STOCK_FLAG_LOCKED');
    end if;
    if exists (select 1 from public.tbl_inv_product_uoms pu
                join jsonb_array_elements(v_uoms) x on (x->>'uom_id')::bigint = pu.uom_id
               where pu.product_id = v_id and pu.factor_to_base <> (x->>'factor')::numeric
                 and public.fn_inv_product_uom_used(v_id, pu.uom_id)) then
      return public.fn_inv_err('UOM_FACTOR_LOCKED');
    end if;
    if exists (select 1 from public.tbl_inv_product_barcodes b
                where b.product_id = v_id and b.is_active
                  and not exists (select 1 from jsonb_array_elements(v_uoms) x where (x->>'uom_id')::bigint = b.uom_id)) then
      return public.fn_inv_err('UOM_HAS_BARCODES');
    end if;
  end if;

  -- write
  if v_id is null then
    insert into public.tbl_inv_products (owner_branch_id, sku, name, description, category_id, is_stock_item,
      base_uom_id, purchase_uom_id, default_supplier_id, standard_unit_cost, is_chargeable, charge_price,
      default_max_store, default_max_floor, is_active, created_by_account)
    values (v_owner, v_sku, v_name, v_desc, v_cat.id, not v_cat.is_service, v_base, v_purchase, v_supplier, v_std,
      v_chargeable, v_price, v_max_s, v_max_f, v_active, v_acc.account_id)
    returning * into v_row;
  else
    update public.tbl_inv_products p
       set sku = v_sku, name = v_name, description = v_desc, category_id = v_cat.id, is_stock_item = not v_cat.is_service,
           base_uom_id = v_base, purchase_uom_id = v_purchase, default_supplier_id = v_supplier,
           standard_unit_cost = v_std, is_chargeable = v_chargeable, charge_price = v_price,
           default_max_store = v_max_s, default_max_floor = v_max_f, is_active = v_active,
           updated_at = now(), updated_by_account = v_acc.account_id
     where p.id = v_id
    returning * into v_row;
  end if;

  insert into public.tbl_inv_product_uoms (product_id, uom_id, factor_to_base, is_active)
  select v_row.id, (x->>'uom_id')::bigint, (x->>'factor')::numeric, true from jsonb_array_elements(v_uoms) x
  on conflict (product_id, uom_id) do update
    set factor_to_base = excluded.factor_to_base, is_active = true
  where public.tbl_inv_product_uoms.factor_to_base is distinct from excluded.factor_to_base
     or not public.tbl_inv_product_uoms.is_active;
  update public.tbl_inv_product_uoms pu set is_active = false
   where pu.product_id = v_row.id and pu.is_active
     and not exists (select 1 from jsonb_array_elements(v_uoms) x where (x->>'uom_id')::bigint = pu.uom_id);

  v_result := public.fn_inv_ok(jsonb_build_object('product_id', v_row.id, 'owner_branch_id', v_owner));
  perform public.fn_inv_audit_master(case when v_id is null then 'PRODUCT_CREATED' else 'PRODUCT_UPDATED' end,
    'product', v_row.id::text, v_owner, null, p_key, to_jsonb(v_row) || jsonb_build_object('uoms', v_uoms),
    case when v_id is not null then to_jsonb(v_old) end);
  return public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result);
end $$;

-- ----------------------------------------------------------------------------
-- inv_add_barcode (D-128)
--   global product: HQ ADMIN, or a real branch's Head-Nurse tier (senior staff)
--   demo-owned product: the demo ADMIN
-- payload: {product_id, uom_id, barcode, performed_by_staff?}
-- An active code may exist once per owner scope; the demo sees global + its
-- own, so a demo code may not shadow a global one. UPC-A ↔ EAN-13 (leading 0)
-- count as the same code.
-- ----------------------------------------------------------------------------
create or replace function public.inv_add_barcode(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_add_barcode';
  v_acc record;
  v_prod record;
  v_replay jsonb;
  v_code text := public.fn_inv_jtext(p_payload->'barcode');
  v_uom bigint := public.fn_inv_jbigint(p_payload->'uom_id');
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_problem text;
  v_variants text[];
  v_clash record;
  v_id bigint;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select p.id, p.owner_branch_id, p.is_active into v_prod from public.tbl_inv_products p
   where p.id = public.fn_inv_jbigint(p_payload->'product_id')
     and (p.owner_branch_id is null or p.owner_branch_id = any (public.inv_accessible_branch_ids()));
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if v_prod.owner_branch_id is not null or public.fn_inv_is_hq_admin() then
    if not public.fn_inv_master_can(v_prod.owner_branch_id) then
      return public.fn_inv_err('FORBIDDEN');
    end if;
    v_staff := null;
  else
    v_problem := public.fn_inv_branch_master_problem('BARCODE_ATTACH', v_staff);
    if v_problem = 'FORBIDDEN' then
      return public.fn_inv_err('FORBIDDEN');
    end if;
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_problem is not null then
    return public.fn_inv_err(v_problem);
  end if;
  if v_code is null or v_code !~ '^[\x21-\x7E]{3,64}$' then
    return public.fn_inv_err('INVALID_BARCODE');
  end if;
  if not exists (select 1 from public.tbl_inv_product_uoms pu
                  where pu.product_id = v_prod.id and pu.uom_id = v_uom and pu.is_active) then
    return public.fn_inv_err('UOM_NOT_CONVERTIBLE');
  end if;
  v_variants := array[v_code];
  if v_code ~ '^[0-9]{12}$' then
    v_variants := v_variants || ('0' || v_code);
  elsif v_code ~ '^0[0-9]{12}$' then
    v_variants := v_variants || substr(v_code, 2);
  end if;
  select b.product_id, p.sku, p.name, b.owner_branch_id into v_clash
    from public.tbl_inv_product_barcodes b join public.tbl_inv_products p on p.id = b.product_id
   where b.is_active and b.barcode = any (v_variants)
     and (b.owner_branch_id is null or b.owner_branch_id is not distinct from v_prod.owner_branch_id
          or v_prod.owner_branch_id is null)
   order by (b.owner_branch_id is not distinct from v_prod.owner_branch_id) desc
   limit 1;
  if found then
    -- a global code may not shadow a demo one either, but never reveal a demo
    -- product to a non-demo editor (review of 014)
    if v_clash.owner_branch_id is not distinct from v_prod.owner_branch_id or v_clash.owner_branch_id is null then
      return public.fn_inv_err('BARCODE_IN_USE', null,
        jsonb_build_object('product_id', v_clash.product_id, 'sku', v_clash.sku, 'name', v_clash.name));
    end if;
    return public.fn_inv_err('BARCODE_IN_USE');
  end if;

  insert into public.tbl_inv_product_barcodes (barcode, product_id, uom_id, owner_branch_id, created_by_account)
  values (v_code, v_prod.id, v_uom, v_prod.owner_branch_id, v_acc.account_id)
  returning id into v_id;
  v_result := public.fn_inv_ok(jsonb_build_object('barcode_id', v_id));
  perform public.fn_inv_audit_master('BARCODE_ADDED', 'barcode', v_id::text, v_prod.owner_branch_id, v_staff, p_key,
    jsonb_build_object('barcode', v_code, 'product_id', v_prod.id, 'uom_id', v_uom));
  return public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result);
end $$;

-- ----------------------------------------------------------------------------
-- inv_deactivate_barcode (master-data editors only: HQ ADMIN / demo ADMIN)
-- payload: {barcode_id}
-- ----------------------------------------------------------------------------
create or replace function public.inv_deactivate_barcode(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_deactivate_barcode';
  v_acc record;
  v_bc record;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select b.id, b.owner_branch_id, b.is_active, b.barcode into v_bc from public.tbl_inv_product_barcodes b
   where b.id = public.fn_inv_jbigint(p_payload->'barcode_id') for update;
  if not found or not public.fn_inv_master_can(v_bc.owner_branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if not v_bc.is_active then
    return public.fn_inv_err('ALREADY_INACTIVE');
  end if;
  update public.tbl_inv_product_barcodes b set is_active = false where b.id = v_bc.id;
  v_result := public.fn_inv_ok(jsonb_build_object('barcode_id', v_bc.id));
  perform public.fn_inv_audit_master('BARCODE_DEACTIVATED', 'barcode', v_bc.id::text, v_bc.owner_branch_id, null, p_key,
    jsonb_build_object('barcode', v_bc.barcode, 'is_active', false));
  return public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result);
end $$;

-- ----------------------------------------------------------------------------
-- inv_save_supplier
--   global: HQ ADMIN, or a real branch's Head-Nurse tier (senior staff)
--   demo-owned: the demo ADMIN (a demo login always creates demo-owned rows)
-- payload: {id?, name, contact_person?, phone?, email?, address?, notes?, is_active?,
--   performed_by_staff? (required for the branch-login path)}
-- ----------------------------------------------------------------------------
create or replace function public.inv_save_supplier(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_save_supplier';
  v_acc record;
  v_id bigint := public.fn_inv_jbigint(p_payload->'id');
  v_old public.tbl_inv_suppliers;
  v_row public.tbl_inv_suppliers;
  v_owner bigint;
  v_replay jsonb;
  v_staff text := public.fn_inv_jtext(p_payload->'performed_by_staff');
  v_problem text;
  v_name text := public.fn_inv_jtext(p_payload->'name');
  v_contact text := public.fn_inv_jtext(p_payload->'contact_person');
  v_phone text := public.fn_inv_jtext(p_payload->'phone');
  v_email text := public.fn_inv_jtext(p_payload->'email');
  v_address text := public.fn_inv_jtext(p_payload->'address');
  v_notes text := public.fn_inv_jtext(p_payload->'notes');
  v_active boolean := coalesce((p_payload->>'is_active')::boolean, true);
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object'
     or (p_payload ? 'is_active' and jsonb_typeof(p_payload->'is_active') <> 'boolean') then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  if v_id is not null then
    select * into v_old from public.tbl_inv_suppliers s where s.id = v_id;
    if not found then
      return public.fn_inv_err('FORBIDDEN');
    end if;
    v_owner := v_old.owner_branch_id;
  else
    v_owner := public.fn_inv_new_owner();
  end if;
  if v_owner is not null or public.fn_inv_is_hq_admin() then
    if not public.fn_inv_master_can(v_owner) then
      return public.fn_inv_err('FORBIDDEN');
    end if;
    v_staff := null;
  else
    v_problem := public.fn_inv_branch_master_problem('SUPPLIER_EDIT', v_staff);
    if v_problem = 'FORBIDDEN' then
      return public.fn_inv_err('FORBIDDEN');
    end if;
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_problem is not null then
    return public.fn_inv_err(v_problem);
  end if;
  if v_name is null or length(v_name) > 120 or length(coalesce(v_contact, '')) > 120 or length(coalesce(v_phone, '')) > 40
     or length(coalesce(v_email, '')) > 120 or length(coalesce(v_address, '')) > 400 or length(coalesce(v_notes, '')) > 500 then
    return public.fn_inv_err('INVALID_NAME');
  end if;
  if exists (select 1 from public.tbl_inv_suppliers s
              where coalesce(s.owner_branch_id, 0) = coalesce(v_owner, 0)
                and s.name_key = lower(regexp_replace(btrim(v_name), '\s+', ' ', 'g'))
                and s.id is distinct from v_id) then
    return public.fn_inv_err('SUPPLIER_EXISTS');
  end if;

  if v_id is null then
    insert into public.tbl_inv_suppliers (owner_branch_id, name, contact_person, phone, email, address, notes, is_active,
                                          created_by_account)
    values (v_owner, v_name, v_contact, v_phone, v_email, v_address, v_notes, v_active, v_acc.account_id)
    returning * into v_row;
  else
    update public.tbl_inv_suppliers s
       set name = v_name, contact_person = v_contact, phone = v_phone, email = v_email, address = v_address,
           notes = v_notes, is_active = v_active, updated_at = now(), updated_by_account = v_acc.account_id
     where s.id = v_id
    returning * into v_row;
  end if;
  v_result := public.fn_inv_ok(jsonb_build_object('supplier_id', v_row.id, 'owner_branch_id', v_owner));
  perform public.fn_inv_audit_master(case when v_id is null then 'SUPPLIER_CREATED' else 'SUPPLIER_UPDATED' end,
    'supplier', v_row.id::text, v_owner, v_staff, p_key, to_jsonb(v_row) - 'name_key',
    case when v_id is not null then to_jsonb(v_old) - 'name_key' end);
  return public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result);
end $$;

-- ----------------------------------------------------------------------------
-- inv_set_stock_level (tier ADMIN of the location's branch; D-101, D-24)
-- payload: {location_id (STORE|FLOOR), product_id, max_qty}
-- There is no "clear": rows are master data and never deleted. Set the level
-- to the product default instead.
-- ----------------------------------------------------------------------------
create or replace function public.inv_set_stock_level(p_payload jsonb, p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_rpc constant text := 'inv_set_stock_level';
  v_acc record;
  v_loc record;
  v_replay jsonb;
  v_prod record;
  v_max numeric := public.fn_inv_jnum_opt(p_payload->'max_qty', 1000000, 4);
  v_before numeric;
  v_result jsonb;
begin
  select * into v_acc from public.fn_inv_current_account();
  if not found then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  if p_key is null or jsonb_typeof(p_payload) <> 'object' then
    return public.fn_inv_err('INVALID_PAYLOAD');
  end if;
  select * into v_loc from public.fn_inv_location_of(public.fn_inv_jbigint(p_payload->'location_id'));
  if not found or not public.fn_inv_can('STOCK_LEVELS', v_loc.branch_id) then
    return public.fn_inv_err('FORBIDDEN');
  end if;
  v_replay := public.fn_inv_idem_lookup(p_key, c_rpc, p_payload, v_acc.account_id);
  if v_replay is not null then
    return v_replay;
  end if;
  if v_loc.kind not in ('STORE','FLOOR') then
    return public.fn_inv_err('INVALID_LOCATIONS');                    -- D-24
  end if;
  if v_max is null or v_max = -1 then
    return public.fn_inv_err('INVALID_NUMBER');
  end if;
  select p.id, p.is_stock_item into v_prod from public.tbl_inv_products p
   where p.id = public.fn_inv_jbigint(p_payload->'product_id')
     and (p.owner_branch_id is null or p.owner_branch_id = v_loc.branch_id);
  if not found then
    return public.fn_inv_err('PRODUCT_NOT_FOUND');
  end if;
  if not v_prod.is_stock_item then
    return public.fn_inv_err('NOT_STOCK_ITEM');
  end if;
  select sl.max_qty into v_before from public.tbl_inv_stock_levels sl
   where sl.location_id = v_loc.id and sl.product_id = v_prod.id;
  insert into public.tbl_inv_stock_levels (location_id, product_id, branch_id, max_qty, updated_by_account)
  values (v_loc.id, v_prod.id, v_loc.branch_id, v_max, v_acc.account_id)
  on conflict (location_id, product_id) do update
    set max_qty = excluded.max_qty, updated_at = now(), updated_by_account = excluded.updated_by_account;
  v_result := public.fn_inv_ok(jsonb_build_object('location_id', v_loc.id, 'product_id', v_prod.id, 'max_qty', v_max));
  perform public.fn_inv_audit('STOCK_LEVEL_SET', 'stock_level', v_loc.id || ':' || v_prod.id, v_loc.branch_id, null, null,
    p_key, null, jsonb_build_object('max_qty', v_max), jsonb_build_object('max_qty', v_before));
  return public.fn_inv_idem_store(p_key, c_rpc, p_payload, v_acc.account_id, v_result);
end $$;

-- Grants: RE-RUN schema/013_inventory_grants.sql after this file (catalog-driven).

-- Nothing this file created is reachable through the API until 013 (audit V-1).
select public.fn_inv_lockdown();

commit;
