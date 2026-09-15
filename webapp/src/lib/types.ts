export type Resident = {
  id: number;
  branch_id: number;
  resident_name: string;
  ic_number: string | null;
  age: number | null;
  nationality_id: number | null;
  gender: "M" | "F" | null;
  marital_status: string | null;
  status: "ACTIVE" | "DISCHARGED" | "DECEASED" | "TRANSFERRED OUT";
  category: string | null;
  care_type: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  transfer_from: string | null;
  accompanied_by: string | null;
  emergency_contact: string | null;
  allergy: string | null;
  past_medical_condition: string | null;
  medication_reconciliation_log: string | null;
  current_medication_list: string | null;
  mobility: string | null;
  feeding_type_id: number | null;
  hygiene: string | null;
  diet_type_id: number | null;
  care_goal: string[] | null;
  tca_notes: string | null;
  assessment_and_summary: string | null;
  reviewed_by: number | null;
};

export type Staff = {
  id: number;
  branch_id: number;
  staff_name: string;
  position_id: number;
  role: "admin" | "management" | "doctor" | "nurse" | "caregiver" | "physio" | "pharmacist";
  status: "ACTIVE" | "INACTIVE";
};

export type ProgressNote = {
  id: number;
  branch_id: number;
  resident_id: number;
  entry_timestamp: string;
  past_med_condition: string | null;
  progress_note: string | null;
  physical_examination: string | null;
  medical_plan: string | null;
  monitoring_plan: string | null;
  feeding_plan: string | null;
  dressing_plan: string | null;
  nursing_plan: string | null;
  physio_plan: string | null;
  current_medication_regime: string | null;
  tca_notes: string | null;
  reviewed_by: number | null;
  created_by: number | null;
};

export type UserAccount = {
  id: number;
  email: string;
  username: string;
  branch_id: number;
  rights: "ADMIN" | "MODERATOR" | "STAFF";
  status: "ACTIVE" | "INACTIVE";
};

export type LookupOption = { id: number; label: string };

export const GENDER_OPTIONS = ["M", "F"] as const;
export const MARITAL_STATUS_OPTIONS = ["Single", "Married", "Windowed", "Divorced"] as const;
export const RESIDENT_STATUS_OPTIONS = ["ACTIVE", "DISCHARGED", "DECEASED", "TRANSFERRED OUT"] as const;
export const CARE_TYPE_OPTIONS = ["24-Hour Care", "Daycare"] as const;
export const TRANSFER_FROM_OPTIONS = ["Home", "Hospital", "Nursing Home", "Others"] as const;
export const ACCOMPANIED_BY_OPTIONS = ["Self", "Family", "Friends", "Social Worker", "Paramedic", "Others"] as const;
export const MOBILITY_OPTIONS = ["Walking Independent", "Walking Aid", "Wheelchair", "Bedbound"] as const;
export const HYGIENE_OPTIONS = ["Self Toileting", "Urinal", "Bedpan", "Commode Chair", "Pampers"] as const;
export const CARE_GOAL_OPTIONS = ["Nursing/ADL care", "Rehabilitation", "Wound Care", "Paliative Care", "Others"] as const;
// tbl_staff.role -- clinical/job-title category, unrelated to login access.
export const STAFF_ROLE_OPTIONS = ["admin", "management", "doctor", "nurse", "caregiver", "physio", "pharmacist"] as const;
export const STAFF_STATUS_OPTIONS = ["ACTIVE", "INACTIVE"] as const;
// tbl_user_accounts.rights -- login access level. Deliberately just 3 tiers,
// unrelated to tbl_staff.role.
export const RIGHTS_OPTIONS = ["ADMIN", "MODERATOR", "STAFF"] as const;
