-- 026 — Stop recording updates that change nothing
--
-- Why: the Sheet→Supabase medication sync (MedicationSync.gs) re-upserts
-- every order on each run, changed or not. 20,212 of 20,993 audit rows for
-- tbl_medication_orders (97%) had old_data = new_data — ~1,860 empty rows a
-- day, enough to refill the free-tier database in ~3 months.
--
-- 1. tbl_medication_orders gets Postgres's built-in
--    suppress_redundant_updates_trigger, so an unchanged row is not rewritten
--    at all (no audit row, no table bloat). Safe: the sync upserts with
--    Prefer: return=minimal and the webapp's .update() calls don't read the
--    returned rows. NOT added to tbl_residents: its resident_to_google
--    webhook trigger may rely on no-op updates firing.
-- 2. fn_audit_trigger skips any UPDATE whose old and new rows are identical,
--    on every audited table.
-- 3. Deletes the existing empty UPDATE audit rows (old_data = new_data);
--    they record no change.
--
-- Re-runnable.

drop trigger if exists trg_suppress_noop_update on public.tbl_medication_orders;
create trigger trg_suppress_noop_update
  before update on public.tbl_medication_orders
  for each row execute function suppress_redundant_updates_trigger();

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

  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
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

delete from public.tbl_audit_log
where action = 'UPDATE' and old_data = new_data;
