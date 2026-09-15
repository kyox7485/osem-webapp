import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

try:
    # record_id needs to hold both bigint ids (every other table) and text
    # StaffID codes (tbl_staff) -- widen to text, bigint values cast cleanly.
    cur.execute('alter table tbl_audit_log alter column record_id type text using record_id::text;')

    cur.execute("""
        create or replace function fn_audit_trigger() returns trigger
        language plpgsql as $$
        declare
          v_record_id text;
        begin
          if tg_table_name = 'tbl_staff' then
            v_record_id := coalesce(new."StaffID", old."StaffID");
          else
            v_record_id := coalesce(new.id, old.id)::text;
          end if;
          insert into tbl_audit_log (table_name, record_id, action, changed_by, old_data, new_data)
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
        $$;
    """)

    conn.commit()
    print("COMMITTED OK")
except Exception as e:
    conn.rollback()
    print("ROLLED BACK:", e)
    raise
finally:
    conn.close()
