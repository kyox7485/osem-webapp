import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.environ["PG_DSN"], connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

# Replaces the original Braden/Norton bony-prominence list (Right Ear,
# Coccyx, Ischial Tuberosity, Buttock, Shoulder Blade, etc.) with a smaller
# set of general regions that match how the wound-photo body diagram now
# places hotspots -- see webapp/src/app/(app)/clinical/wound-body-diagram.tsx.
# "Chest", "Abdomen" and "Sacrum" already existed under these exact labels,
# so they're upserted (active + sort_order refreshed) rather than inserted
# fresh; everything else in this list is new.
NEW_BODY_PARTS = [
    ("Head", 0),
    ("Neck", 1),
    ("Shoulder", 2),
    ("Chest", 3),
    ("Abdomen", 4),
    ("Back", 5),
    ("Sacrum", 6),
    ("Left Hand", 7),
    ("Right Hand", 8),
    ("Left Leg", 9),
    ("Right Leg", 10),
    ("Other", 11),
]
KEEP_LABELS = {label for label, _ in NEW_BODY_PARTS}

try:
    for label, sort_order in NEW_BODY_PARTS:
        cur.execute(
            """
            insert into tbl_wound_body_parts (label, sort_order, active)
            values (%s, %s, true)
            on conflict (label) do update set sort_order = excluded.sort_order, active = true;
            """,
            (label, sort_order),
        )
    print(f"Upserted {len(NEW_BODY_PARTS)} general body part rows")

    # Deactivate (not delete) every old specific row not in the new list --
    # tbl_wound_photos.body_part_label is a frozen snapshot column, so
    # existing photo records keep showing their original site label
    # regardless of this table's active flag.
    cur.execute(
        "update tbl_wound_body_parts set active = false where label != all(%s) returning label;",
        (list(KEEP_LABELS),),
    )
    deactivated = [row[0] for row in cur.fetchall()]
    print(f"Deactivated {len(deactivated)} old row(s): {deactivated}")

    cur.execute("select label, sort_order from tbl_wound_body_parts where active order by sort_order;")
    print("Active body parts now:", cur.fetchall())

    conn.commit()
    print("Committed.")
except Exception:
    conn.rollback()
    raise
finally:
    cur.close()
    conn.close()
