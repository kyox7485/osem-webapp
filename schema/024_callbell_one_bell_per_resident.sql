-- Call Bell: a resident can be assigned to at most one call bell.
-- Unassigned bells (resident_id NULL) are unaffected.
create unique index if not exists cb_assignments_resident_unique
  on cb_assignments (resident_id) where resident_id is not null;
