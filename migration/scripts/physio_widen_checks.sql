-- Widen two check constraints on physio_assessments so the legacy Access
-- tbl_PhyIPProgressNote data can be stored faithfully.
--
-- Approved by the owner 2026-09-26 alongside the physio migration. Apply once,
-- before the first --commit run of transforms/physio_assessments.py.
--
-- 1. treatment_type -- the Access IPSubType column has 20 distinct values, 4 of
--    which ('Full Physio', 'Patient Went Out', 'Not Performed', 'Others') are not
--    in the app's TreatmentType list. 'Others' is a genuine data-quality problem
--    (2 rows, no meaning attached) and is NOT added -- the transform maps it to
--    NULL and reports it. The other three are real treatment outcomes and are
--    added, so no historical row is silently reclassified.
--
-- 2. treatment_compliance -- Access Completion stores 0/25/50/100 and 0 is a
--    real (if usually unfilled) value; the column needed a '0%' to represent it.

begin;

alter table physio_assessments drop constraint if exists physio_assessments_treatment_type_check;
alter table physio_assessments add constraint physio_assessments_treatment_type_check
  check (treatment_type is null or treatment_type in (
    'Assessment','Basic Physio','Full Physio','Full Physio (1hr)','Full Physio (30m)',
    'SilverFit (Group)','SilverFit (Individual)','Patient Refused','Patient Went Out',
    'Patient Not Available','Not Performed','Neuro Rehabilitation','Sport Rehabilitation',
    'Shoulder Rehabilitation','Back Pain','Pain Management','Chest Physio','Housecall',
    'Other Physio (1hr)','Other Physio (30m)'
  ));

alter table physio_assessments drop constraint if exists physio_assessments_treatment_compliance_check;
alter table physio_assessments add constraint physio_assessments_treatment_compliance_check
  check (treatment_compliance is null or treatment_compliance in ('0%','25%','50%','75%','100%'));

commit;
