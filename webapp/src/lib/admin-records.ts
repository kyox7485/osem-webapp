// HQ-ADMIN record correction: which record kinds can be edited/deleted and
// which columns the edit dialog exposes. Pure data -- imported by BOTH the
// client control (components/admin-record-controls.tsx) and the server
// action (app/(app)/admin-record-actions.ts), so it must never import
// anything server-only (see CLAUDE.md's lookups.ts footgun).
//
// The server action treats `fields` as a WHITELIST: any submitted key not
// listed here is dropped, so a crafted request cannot touch branch_id,
// resident_id, foreign keys, or audit columns.
//
// Stored values stay language-neutral; the dialog translates option labels
// with t() at render time.

export type AdminFieldType =
  | "text"
  | "textarea"
  | "number"
  | "datetime" // timestamptz, edited as Malaysia local time
  | "time" // time without time zone, HH:mm
  | "boolean"
  | "select"
  | "multiselect" // text[] column
  | "staff"; // tbl_staff.StaffID picker

export type AdminFieldOption = { value: string; label: string };

export type AdminField = {
  name: string;
  label: string;
  type: AdminFieldType;
  options?: AdminFieldOption[];
  required?: boolean;
  min?: number;
  max?: number;
  // A "select" whose column is numeric (option values are strings in the DOM).
  numeric?: boolean;
};

// "db"    -- plain Supabase row, updated/deleted directly.
// "sheet" -- Google Sheet is the source of truth (docs/medication*.md,
//            docs/consumables.md); edits/deletes go through Apps Script.
export type AdminRecordSource = "db" | "sheet";

export type AdminRecordKind =
  | "progress_note"
  | "nursing_chart"
  | "vital"
  | "observation_chart"
  | "behaviour_chart"
  | "wound_session"
  | "wound_photo"
  | "hospital_referral"
  | "physio_assessment"
  | "medication_order"
  | "medication_stock"
  | "consumable_count";

export type AdminRecordConfig = {
  label: string;
  source: AdminRecordSource;
  fields: AdminField[]; // empty = delete-only
  // Client-side field linkage, evaluated whenever any field changes and once
  // on load: when `whenField` holds a value present in `values`, `populateField`
  // is overwritten with `valueFor(selected, values)`. Used by the physio edit
  // dialog to keep Credit hours in step with Treatment type; the numbers come
  // from the live lookup, so nothing about them is baked in here.
  link?: {
    whenField: string;
    populateField: string;
    valueFor: (selected: string, values: Record<string, number>) => string | null;
  };
};

const opts = (values: string[]): AdminFieldOption[] => values.map((v) => ({ value: v, label: v }));

const STOCK_UNITS = [
  "Tablet", "Capsule", "Sachet", "Ampoule", "mL", "Puff", "Unit",
  "Bottle", "Tube", "Jar", "Cannister", "Pump", "Drop", "Pen", "Application",
];

const SPO2_CONDITIONS = [
  "under RA", "under 1LPM O2", "under 2LPM O2", "under 3LPM O2", "under 4LPM O2", "under 5LPM O2",
  "under 6LPM O2", "under 7LPM O2", "under 8LPM O2", "under 9LPM O2", "under 10LPM O2",
];

const VITAL_FIELDS: AdminField[] = [
  { name: "systolic_bp", label: "Systolic BP", type: "number", min: 0 },
  { name: "diastolic_bp", label: "Diastolic BP", type: "number", min: 0 },
  { name: "heart_rate", label: "Heart Rate", type: "number", min: 0 },
  { name: "temperature", label: "Temperature", type: "number", min: 0 },
  { name: "spo2", label: "SpO2", type: "number", min: 0, max: 100 },
];

export const ADMIN_RECORDS: Record<AdminRecordKind, AdminRecordConfig> = {
  progress_note: {
    label: "Progress note",
    source: "db",
    fields: [
      { name: "entry_timestamp", label: "Date & time", type: "datetime", required: true },
      { name: "progress_note", label: "Progress note", type: "textarea" },
      { name: "physical_examination", label: "Physical examination", type: "textarea" },
      { name: "medical_plan", label: "Medical / treatment plan", type: "textarea" },
      { name: "nursing_plan", label: "Nursing plan", type: "textarea" },
      { name: "feeding_plan", label: "Feeding / diet plan", type: "textarea" },
      { name: "dressing_plan", label: "Dressing plan", type: "textarea" },
      { name: "monitoring_plan", label: "Monitoring plan", type: "textarea" },
      { name: "physio_plan", label: "Physio plan", type: "textarea" },
      { name: "reviewed_by", label: "Reviewed by", type: "staff" },
      { name: "reviewed_by_other", label: "Reviewed by (other)", type: "text" },
    ],
  },
  nursing_chart: {
    label: "Nursing chart entry",
    source: "db",
    fields: [
      { name: "entry_timestamp", label: "Date & time", type: "datetime", required: true },
      { name: "tube_feeding", label: "Feeding method", type: "select", options: opts(["Oral Feed", "Tube Feeding"]) },
      { name: "fluid_input", label: "Fluid input (ml)", type: "number", min: 0 },
      { name: "fluid_output", label: "Fluid output (ml)", type: "number", min: 0 },
      { name: "cbd_drainage", label: "CBD drainage", type: "text" },
      { name: "active_complaint_other", label: "Active complaint (other)", type: "text" },
      { name: "activity_other", label: "Activity (other)", type: "text" },
      { name: "psycho_social_other", label: "Psycho-social behaviour (other)", type: "text" },
      { name: "intervention", label: "Intervention", type: "textarea" },
      { name: "doctors_plan", label: "Doctor's plan", type: "textarea" },
      { name: "reviewed_by", label: "Reviewed by", type: "staff" },
    ],
  },
  vital: {
    label: "Vital signs",
    source: "db",
    fields: [
      { name: "entry_timestamp", label: "Date & time", type: "datetime", required: true },
      ...VITAL_FIELDS,
      { name: "respiration_rate", label: "Respiration Rate", type: "number", min: 0 },
      { name: "spo2_condition", label: "SpO2 condition", type: "select", options: opts(SPO2_CONDITIONS) },
      { name: "dxt", label: "DXT", type: "number", min: 0 },
      { name: "dxt_remark", label: "DXT remark", type: "select", options: opts(["Fasting", "Post-Meal 1hr", "Post-Meal 2hr", "Post-Meal >4hr"]) },
      { name: "insulin_adjustment", label: "Insulin adjustment", type: "text" },
      { name: "reviewed_by", label: "Reviewed by", type: "staff" },
      { name: "reviewed_by_other", label: "Reviewed by (other)", type: "text" },
    ],
  },
  observation_chart: {
    label: "Observation chart entry",
    source: "db",
    fields: [
      { name: "entry_timestamp", label: "Date & time", type: "datetime", required: true },
      { name: "active_issue", label: "Active issue", type: "textarea" },
      { name: "sob_cough", label: "SOB / Cough", type: "boolean" },
      { name: "pain", label: "Pain", type: "boolean" },
      { name: "pain_location", label: "Pain location", type: "text" },
      { name: "wound", label: "Wound", type: "text" },
      { name: "appetite", label: "Appetite", type: "text" },
      { name: "vomiting", label: "Vomiting", type: "boolean" },
      { name: "diarrhea", label: "Diarrhea", type: "boolean" },
      { name: "urine", label: "Urine", type: "text" },
      {
        name: "behavior",
        label: "Behavior",
        type: "multiselect",
        options: opts(["Calm", "Restless", "Agitated", "Sleepy", "Anxious", "Angry", "Crying", "Aggressive"]),
      },
      { name: "behavior_other", label: "Behavior (other)", type: "text" },
      ...VITAL_FIELDS,
      { name: "spo2_condition", label: "SpO2 condition", type: "text" },
      { name: "dxt", label: "DXT", type: "number", min: 0 },
      { name: "avpu", label: "AVPU", type: "select", options: opts(["Alert", "Voice", "Pain", "Unresponsive"]) },
      { name: "created_by", label: "Entered by", type: "staff" },
      { name: "created_by_other", label: "Entered by (other)", type: "text" },
    ],
  },
  behaviour_chart: {
    label: "Behaviour chart entry",
    source: "db",
    fields: [
      { name: "entry_timestamp", label: "Date & time", type: "datetime", required: true },
      { name: "verbal_behavior", label: "Verbal behaviour", type: "multiselect", options: opts(["Quiet", "Shouting", "Scolding Staff", "Incoherent Speech"]) },
      { name: "physical_behavior", label: "Physical behaviour", type: "multiselect", options: opts(["Calm", "Restless", "Walking Around", "Hitting Staff"]) },
      { name: "emotion_mood", label: "Emotion / mood", type: "multiselect", options: opts(["Relaxed", "Agitated", "Sleepy", "Anxious", "Angry", "Crying"]) },
      { name: "restraint", label: "Restraint", type: "multiselect", options: opts(["On Mitten Gloves", "On Restrainer Vest", "Not on any restrain"]) },
      { name: "complaints", label: "Complaints", type: "textarea" },
      { name: "sleep_from", label: "Sleep from", type: "time" },
      { name: "sleep_to", label: "Sleep to", type: "time" },
      {
        name: "disturbance_level",
        label: "Disturbance level",
        type: "select",
        numeric: true,
        options: [
          { value: "0", label: "0 – No disturb" },
          { value: "1", label: "1 – Occasionally sound" },
          { value: "2", label: "2 – Frequent sound (others can sleep)" },
          { value: "3", label: "3 – Frequent sound (others can't sleep)" },
          { value: "4", label: "4 – Persistent sound (disturbing activity)" },
        ],
      },
      { name: "created_by", label: "Entered by", type: "staff" },
      { name: "created_by_other", label: "Entered by (other)", type: "text" },
    ],
  },
  wound_session: {
    label: "Wound photo session",
    source: "db",
    fields: [
      { name: "session_started_at", label: "Date & time", type: "datetime", required: true },
      { name: "uploaded_by", label: "Uploaded by", type: "staff" },
      { name: "uploaded_by_other", label: "Uploaded by (other)", type: "text" },
    ],
  },
  wound_photo: {
    label: "Wound photo",
    source: "db",
    fields: [{ name: "description", label: "Description", type: "textarea" }],
  },
  hospital_referral: {
    label: "Hospital referral",
    source: "db",
    fields: [
      { name: "referral_datetime", label: "Date & time", type: "datetime", required: true },
      { name: "chief_complaints", label: "Chief complaints", type: "textarea" },
      { name: "vital_signs", label: "Vital signs", type: "textarea" },
      { name: "mobility", label: "Mobility", type: "textarea" },
      { name: "feeding", label: "Feeding", type: "textarea" },
      { name: "hygiene", label: "Hygiene", type: "textarea" },
      { name: "reviewed_by", label: "Reviewed by", type: "staff" },
      { name: "reviewed_by_other", label: "Reviewed by (other)", type: "text" },
    ],
  },
  physio_assessment: {
    label: "Physiotherapy note",
    source: "db",
    fields: [
      { name: "entry_timestamp", label: "Date & time", type: "datetime", required: true },
      {
        name: "treatment_type",
        label: "Treatment type",
        type: "select",
        options: opts([
          "Assessment", "Basic Physio", "Full Physio", "Full Physio (1hr)", "Full Physio (30m)",
          "SilverFit (Group)", "SilverFit (Individual)", "Patient Refused", "Patient Went Out",
          "Patient Not Available", "Not Performed", "Neuro Rehabilitation", "Sport Rehabilitation",
          "Shoulder Rehabilitation", "Back Pain", "Pain Management", "Chest Physio", "Housecall",
          "Other Physio (1hr)", "Other Physio (30m)",
        ]),
      },
      { name: "credit_hours", label: "Credit hours", type: "number", min: 0 },
      { name: "chief_complaint", label: "Chief complaint", type: "textarea" },
      { name: "current_history", label: "Current history", type: "textarea" },
      { name: "past_medical_history", label: "Past medical history", type: "textarea" },
      { name: "social_history", label: "Social history", type: "textarea" },
      { name: "impression", label: "Impression", type: "textarea" },
      { name: "plan_intervention", label: "Plan / intervention", type: "textarea" },
      { name: "evaluation", label: "Evaluation", type: "textarea" },
      { name: "treatment_compliance", label: "Treatment compliance", type: "select", options: opts(["0%", "25%", "50%", "75%", "100%"]) },
      { name: "documented_by", label: "Documented by", type: "staff" },
      { name: "documented_by_other", label: "Documented by (other)", type: "text" },
    ],
    // Credit hours follow the treatment type on every change of that
    // dropdown, from the live tbl_physio_treatment_types values supplied by
    // <AdminRecordProvider> -- including when the admin first opens the
    // dialog on a note whose saved credit hours predate the current binding.
    link: {
      whenField: "treatment_type",
      populateField: "credit_hours",
      valueFor: (selected, hoursByValue) => {
        const hours = hoursByValue[selected];
        // null = no binding known for this type; the dialog then leaves the
        // field as-is rather than clearing it.
        return hours === undefined ? null : String(hours);
      },
    },
  },
  // Editing an order already exists (the order form -> Apps Script revision
  // with a full audit trail), so this kind is delete-only here.
  medication_order: {
    label: "Medication order",
    source: "sheet",
    fields: [],
  },
  medication_stock: {
    label: "Medication stock entry",
    source: "sheet",
    fields: [
      { name: "entry_type", label: "Entry type", type: "select", options: opts(["Stock Count", "Stock Received", "Order Changed"]), required: true },
      { name: "balance", label: "Balance", type: "number", min: 0, required: true },
      { name: "unit", label: "Unit", type: "select", options: opts(STOCK_UNITS), required: true },
      { name: "stock_date", label: "Date & time", type: "datetime", required: true },
      { name: "registered_by", label: "Registered by", type: "staff" },
    ],
  },
  consumable_count: {
    label: "Consumable count",
    source: "sheet",
    fields: [
      { name: "current_stock", label: "Current stock", type: "number", min: 0, required: true },
      { name: "supplier", label: "Supplier", type: "select", options: opts(["Family", "OSEM"]), required: true },
      { name: "last_count", label: "Date & time", type: "datetime", required: true },
      { name: "counted_by", label: "Counted by", type: "staff", required: true },
    ],
  },
};

// ─── Malaysia-time <-> datetime-local helpers (no DST in Asia/Kuala_Lumpur) ──

const KL_OFFSET_MS = 8 * 60 * 60 * 1000;

export function toKlInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + KL_OFFSET_MS).toISOString().slice(0, 16);
}

export function fromKlInputValue(value: string): string | null {
  if (!value) return null;
  return `${value.length === 16 ? value + ":00" : value}+08:00`;
}
