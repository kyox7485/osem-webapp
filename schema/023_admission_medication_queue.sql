-- Migration: Background queue for New Resident admission medications
--
-- What this does: adds tbl_admission_medication_queue -- one row per
-- medication entered on the New Resident form. Nothing existing is altered.
-- Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Why: createResident used to create every admission medication order (and
-- its initial stock entry) through the Apps Script bridge *before*
-- redirecting. A 2026-10-01 production test with 5 medications took ~4 min
-- of Apps Script calls; the Vercel function hit its time limit, the nurse saw
-- "This page couldn't load" and one stock entry was silently lost.
--
-- Now createResident saves the resident, writes the drafts here and redirects
-- straight away. The browser then works through the queue one medication per
-- request (POST /api/residents/admission-medications), so each request stays
-- far below the function limit, and the nurse can keep using the app.
-- Because the queue is in the database, closing the tab loses nothing: the
-- remaining rows are picked up the next time that resident's page is opened
-- (or the next time the account that admitted them loads the app).
--
-- rx_order_id is chosen at insert time and never changes, so a retry of an
-- order that actually reached the Sheet hits medication-orders.gs's
-- duplicate-RxOrderID guard instead of creating a second order.
--
-- status:        pending -> processing -> done | failed   (failed -> pending on Retry)
-- order_done:    the Sheet order exists for rx_order_id
-- stock_status:  not_needed | pending | done | failed     (initial "Stock Received")

create table if not exists tbl_admission_medication_queue (
  id            bigserial    primary key,
  resident_id   bigint       not null references tbl_residents(id) on delete cascade,
  branch_id     bigint       not null references tbl_branches("BranchID"),
  position      smallint     not null,
  rx_order_id   text         not null unique,
  draft         jsonb        not null,
  status        text         not null default 'pending'
                check (status in ('pending', 'processing', 'done', 'failed')),
  order_done    boolean      not null default false,
  stock_status  text         not null default 'not_needed'
                check (stock_status in ('not_needed', 'pending', 'done', 'failed')),
  attempts      integer      not null default 0,
  last_error    text,
  claimed_at    timestamptz,
  created_by    bigint       references tbl_user_accounts(id) on delete set null,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now(),
  completed_at  timestamptz
);

create index if not exists tbl_admission_medication_queue_resident
  on tbl_admission_medication_queue (resident_id, position);

-- Small: only rows that still need attention.
create index if not exists tbl_admission_medication_queue_open
  on tbl_admission_medication_queue (created_by)
  where status in ('pending', 'processing', 'failed');

-- ── Security ────────────────────────────────────────────────────────────────
-- Same branch_scope shape as every other branch-scoped table
-- (migration/scripts/scope_moderator_to_branch.sql), DEMO excluded for
-- all-branch accounts. anon gets nothing: the project's default privileges
-- would otherwise grant it full rights on a new table and its sequence.

alter table tbl_admission_medication_queue enable row level security;

revoke all on tbl_admission_medication_queue from anon;
revoke all on sequence tbl_admission_medication_queue_id_seq from anon;

drop policy if exists branch_scope_tbl_admission_medication_queue on tbl_admission_medication_queue;
create policy branch_scope_tbl_admission_medication_queue on tbl_admission_medication_queue
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
  );
