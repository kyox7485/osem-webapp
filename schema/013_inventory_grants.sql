-- ============================================================================
-- 013 — General Inventory: ALL grants and revokes, in one re-runnable file
-- ============================================================================
-- Audit P1-17: the live default ACL grants anon/authenticated ALL on every new
-- public table, view and sequence and EXECUTE on every new function. So:
--
--   RE-RUN THIS FILE AFTER EVERY INVENTORY MIGRATION (007+ and any future one).
--
-- It is catalog-driven (every tbl_inv_* / v_inv_* / inv_* / fn_inv_* object),
-- so a new object is covered without editing this file, and it ends with a
-- read-back that aborts the transaction if anything is still exposed (D-86,
-- D-125, D-146):
--   * anon, PUBLIC, service_role: nothing
--   * authenticated: SELECT on tables/views (RLS decides the rows), EXECUTE on
--     inv_* (RPCs + policy helpers) only; never fn_inv_* (internal)
-- ============================================================================

begin;

do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','v','m','S')
       and (c.relname like 'tbl\_inv\_%' or c.relname like 'v\_inv\_%')
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence public.%I from public, anon, authenticated, service_role', r.relname);
    else
      execute format('revoke all on table public.%I from public, anon, authenticated, service_role', r.relname);
      execute format('grant select on table public.%I to authenticated', r.relname);
    end if;
  end loop;

  for r in
    select p.oid::regprocedure as sig, p.proname from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'fn\_inv\_%' or p.proname like 'inv\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname like 'inv\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

-- Read-back: abort the install if anything is still exposed.
do $$
declare
  v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and (c.relname like 'tbl\_inv\_%' or c.relname like 'v\_inv\_%')
     and case when c.relkind = 'S'
              then has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                or has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE')
              when c.relkind in ('r','v','m')
              then has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                or has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              else false end;
  if v_bad is not null then
    raise exception 'INV_GRANTS: still exposed: %', v_bad;
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and ((p.proname like 'inv\_%' or p.proname like 'fn\_inv\_%') and has_function_privilege('anon', p.oid, 'EXECUTE')
          or p.proname like 'fn\_inv\_%' and has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'INV_GRANTS: functions still executable: %', v_bad;
  end if;
end $$;

commit;
