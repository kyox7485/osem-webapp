-- 025 — Let bulk imports skip tbl_audit_log
--
-- Why: the Access migration writes through a direct `postgres` connection,
-- so fn_audit_trigger copied every imported row into tbl_audit_log with
-- changed_by = NULL. By 2026-10-03 that was ~1.2M rows / 864 MB of a
-- 1,125 MB database, which pushed the free-tier project into read-only mode
-- and broke every login ("Database error granting user").
--
-- How: a session that runs
--     select set_config('osem.skip_audit', 'on', false);
-- skips auditing. It is honoured ONLY when session_user = 'postgres' (the
-- migration's direct connection). App traffic arrives through PostgREST as
-- session_user = 'authenticator', so staff edits, service-role writes and
-- the Apps Script syncs are always audited regardless of the setting.
--
-- Re-runnable. Function body is otherwise identical to the live definition.

create or replace function public.fn_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_record_id text;
begin
  if session_user = 'postgres'
     and coalesce(current_setting('osem.skip_audit', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'tbl_staff' then
    v_record_id := coalesce(new."StaffID", old."StaffID");
  else
    v_record_id := coalesce(new.id, old.id)::text;
  end if;
  insert into public.tbl_audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  values (
    tg_table_name,
    v_record_id,
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$function$;

revoke all on function public.fn_audit_trigger() from public, anon, authenticated;
