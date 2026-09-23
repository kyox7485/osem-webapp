import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

try:
    # Find and drop the check constraint on ended_at > started_at (auto-named)
    cur.execute("""
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'tbl_behaviour_episodes'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%ended_at%';
    """)
    row = cur.fetchone()
    if row:
        cur.execute(f"ALTER TABLE tbl_behaviour_episodes DROP CONSTRAINT {row[0]};")
        print(f"Dropped constraint: {row[0]}")

    cur.execute("""
        ALTER TABLE tbl_behaviour_episodes
          ALTER COLUMN started_at DROP NOT NULL,
          ALTER COLUMN ended_at DROP NOT NULL;
    """)
    print("Made started_at and ended_at nullable (untimed episodes allowed)")

    # New constraint: either both null (untimed) or both set with end > start
    cur.execute("""
        ALTER TABLE tbl_behaviour_episodes
          ADD CONSTRAINT behaviour_episodes_times_valid CHECK (
            (started_at IS NULL AND ended_at IS NULL) OR
            (started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at > started_at)
          );
    """)
    print("Added new constraint: both null (untimed) or both set with end > start")

    # Update category check to remove Restraint (keep for backward compat but add new value)
    # Note: keep existing 'Restraint' category for old records; just don't use in new form
    # No constraint change needed - old Restraint episodes remain valid

    conn.commit()
    print("Done.")
except Exception as e:
    conn.rollback()
    print(f"Error: {e}")
    raise
finally:
    cur.close()
    conn.close()
