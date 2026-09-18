-- Adds a hidden "demo" branch concept so a demo/product-showcase login can
-- see its own seeded dummy data without that data ever appearing to real
-- ADMIN/MODERATOR accounts (who otherwise bypass branch scoping entirely).
--
-- Design: a branch flagged is_demo = true is invisible to the ADMIN/
-- MODERATOR "see everything" bypass UNLESS the viewer's own account also
-- belongs to a demo branch, in which case they are pinned to their own
-- branch only (never granted the cross-branch bypass). Every other account
-- keeps its exact previous behaviour.

alter table tbl_branches add column if not exists is_demo boolean not null default false;

create or replace function auth_is_demo_account() returns boolean
language sql stable security definer as $$
  select coalesce(
    (select b.is_demo
       from tbl_user_accounts u
       join tbl_branches b on b."BranchID" = u.branch_id
      where u.auth_user_id = auth.uid()),
    false
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'physio_assessments','physio_balance_assessments','physio_body_chart_findings',
    'physio_coordination_assessments','physio_examinations','physio_functional_assessments',
    'tbl_charging_summary','tbl_fall_incidents','tbl_hospital_referrals','tbl_medication_orders',
    'tbl_nursing_chart_entries','tbl_nursing_chart_hygiene_episodes','tbl_nursing_chart_meals',
    'tbl_physio_op_patients','tbl_physio_progress_notes','tbl_product_stock','tbl_progress_notes',
    'tbl_resident_diagnoses','tbl_residents','tbl_stock_movements','tbl_stock_request_details',
    'tbl_stock_requests','tbl_storage_locations','tbl_vital'
  ]
  loop
    execute format('drop policy branch_scope_%1$s on %1$s;', t);
    execute format(
      $f$create policy branch_scope_%1$s on %1$s
        using (
          branch_id = auth_branch_id()
          or (
            auth_role() in ('ADMIN','MODERATOR')
            and not auth_is_demo_account()
            and not exists (select 1 from tbl_branches b where b."BranchID" = branch_id and b.is_demo)
          )
        )
        with check (
          branch_id = auth_branch_id()
          or (
            auth_role() in ('ADMIN','MODERATOR')
            and not auth_is_demo_account()
            and not exists (select 1 from tbl_branches b where b."BranchID" = branch_id and b.is_demo)
          )
        );$f$, t);
  end loop;
end $$;
