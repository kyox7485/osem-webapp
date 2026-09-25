-- Scopes MODERATOR access to the branch Function, matching the app.
--
-- PROBLEM: the branch_scope_* policies pool ADMIN and MODERATOR together
-- (auth_role() in ('ADMIN','MODERATOR')), so a MODERATOR at a NUR branch
-- currently has a full cross-branch bypass at the DATABASE layer. The webapp
-- hid this by filtering harder in application code, but any client calling
-- Supabase directly with that user's JWT could read every branch's records.
--
-- NEW RULE: all-branch access is decided by the branch's Function, not the
-- rights tier.
--   Function = 'HQ'  -> all branches (headquarters oversees everything)
--   Function = 'PHY' -> all branches (a physio hub covers every NUR branch
--                       for inpatient work; this matches getPhysioIpBranchIds
--                       in webapp/src/lib/lookups.ts)
--   Function = 'NUR' -> own branch only, however high the rights tier
--   ADMIN            -> unrestricted wherever it is based
--
-- This mirrors canAccessAllBranches() in webapp/src/lib/current-user.ts.
-- Keep the two in sync.
--
-- DEMO isolation is unchanged: the is_demo clauses stay, so an HQ or PHY
-- account still cannot see branch 6. Only the DEMO account itself can.
--
-- This script also closes a PRE-EXISTING leak, not one this change creates:
-- six clinical tables never got the is_demo guard when demo isolation was
-- introduced, so any MODERATOR could read all 18 DEMO wound sessions and
-- their Google Drive photos by bypassing the UI. They are added below.

begin;

-- ─── 1. The helper ───────────────────────────────────────────────────────────
create or replace function auth_is_all_branch_account() returns boolean
language sql stable security definer as $$
  select exists (
    select 1
      from tbl_user_accounts u
      join tbl_branches b on b."BranchID" = u.branch_id
     where u.auth_user_id = auth.uid()
       and (u.rights = 'ADMIN' or b."Function" in ('HQ','PHY'))
  );
$$;

-- ─── 2. Single-branch_id tables ──────────────────────────────────────────────
-- Identical shape to add_demo_branch_isolation.sql, with the role test
-- replaced by the Function-aware helper.
do $$
declare t text;
begin
  foreach t in array array[
    'physio_assessments','physio_balance_assessments','physio_body_chart_findings',
    'physio_coordination_assessments','physio_examinations','physio_functional_assessments',
    'tbl_charging_summary','tbl_fall_incidents','tbl_hospital_referrals','tbl_medication_orders',
    'tbl_medication_stock','tbl_nursing_chart_entries','tbl_nursing_chart_hygiene_episodes',
    'tbl_nursing_chart_meals','tbl_physio_op_patients','tbl_physio_progress_notes',
    'tbl_product_stock','tbl_progress_notes','tbl_resident_diagnoses','tbl_residents',
    'tbl_stock_movements','tbl_stock_request_details','tbl_stock_requests',
    'tbl_storage_locations','tbl_vital',
    -- newly guarded against DEMO (previously had no is_demo clause):
    'tbl_behaviour_episodes','tbl_wound_sessions','tbl_wound_photos'
  ]
  loop
    execute format('drop policy if exists branch_scope_%1$s on %1$s;', t);
    execute format(
      $f$create policy branch_scope_%1$s on %1$s
        using (
          branch_id = auth_branch_id()
          or (
            auth_is_all_branch_account()
            and not auth_is_demo_account()
            and not exists (select 1 from tbl_branches b where b."BranchID" = branch_id and b.is_demo)
          )
        )
        with check (
          branch_id = auth_branch_id()
          or (
            auth_is_all_branch_account()
            and not auth_is_demo_account()
            and not exists (select 1 from tbl_branches b where b."BranchID" = branch_id and b.is_demo)
          )
        );$f$, t);
  end loop;
end $$;

-- ─── 3. tbl_observation_status (3 named policies, not the branch_scope_ shape)
do $$
declare p text;
begin
  foreach p in array array['obs_status_select','obs_status_insert','obs_status_update']
  loop
    execute format('drop policy if exists %1$s on tbl_observation_status;', p);
    execute format(
      $f$create policy %1$s on tbl_observation_status
        %2$s
        using (
          branch_id = auth_branch_id()
          or (
            auth_is_all_branch_account()
            and not auth_is_demo_account()
            and not exists (select 1 from tbl_branches b where b."BranchID" = branch_id and b.is_demo)
          )
        )
        with check (
          branch_id = auth_branch_id()
          or (
            auth_is_all_branch_account()
            and not auth_is_demo_account()
            and not exists (select 1 from tbl_branches b where b."BranchID" = branch_id and b.is_demo)
          )
        );$f$, p,
      case p
        when 'obs_status_select' then 'for select'
        when 'obs_status_insert' then 'for insert'
        else 'for update'
      end
    );
  end loop;
end $$;

-- ─── 4. tbl_stock_transfers (scopes on from/to branch, not a single branch_id)
drop policy if exists transfers_scope on tbl_stock_transfers;
create policy transfers_scope on tbl_stock_transfers
  using (
    from_branch_id = auth_branch_id()
    or to_branch_id = auth_branch_id()
    or (
      auth_is_all_branch_account()
      and not auth_is_demo_account()
      and not exists (
        select 1 from tbl_branches b
         where b.is_demo and b."BranchID" in (from_branch_id, to_branch_id)
      )
    )
  )
  with check (
    from_branch_id = auth_branch_id()
    or to_branch_id = auth_branch_id()
    or (
      auth_is_all_branch_account()
      and not auth_is_demo_account()
      and not exists (
        select 1 from tbl_branches b
         where b.is_demo and b."BranchID" in (from_branch_id, to_branch_id)
      )
    )
  );

-- ─── 5. tbl_staff ────────────────────────────────────────────────────────────
-- A module every user reads, so it gets the Function-aware bypass too --
-- otherwise an HQ moderator could list residents but not the staff roster.
-- The auth_is_demo_account() exemption is required, not optional: the
-- `test` account lives in the DEMO branch and must keep seeing (and admins
-- must keep managing) its staff. See docs/database.md.
drop policy if exists staff_scope on tbl_staff;
create policy staff_scope on tbl_staff
  using (
    branch_id = auth_branch_id()
    or (
      auth_is_all_branch_account()
      and (
        auth_is_demo_account()
        or not exists (select 1 from tbl_branches b where b."BranchID" = branch_id and b.is_demo)
      )
    )
  )
  with check (
    branch_id = auth_branch_id()
    or (
      auth_is_all_branch_account()
      and (
        auth_is_demo_account()
        or not exists (select 1 from tbl_branches b where b."BranchID" = branch_id and b.is_demo)
      )
    )
  );

-- staff_write stays ADMIN-only (login/roster management is not a
-- moderator capability -- mirrors isAdmin() in the app).

commit;

-- ─── 6. Read-back: confirm every policy took, and the helper agrees ──────────
select tablename, policyname,
       case when qual like '%auth_is_all_branch_account%'
            then 'scoped by Function' else 'OTHER' end as rule
  from pg_policies
 where schemaname = 'public'
   and tablename in (
     'tbl_residents','tbl_wound_sessions','tbl_wound_photos','tbl_behaviour_episodes',
     'tbl_observation_status','tbl_stock_transfers','tbl_staff','tbl_vital'
   )
 order by tablename, policyname;
