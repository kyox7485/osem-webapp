import { createClient } from "@/lib/supabase/server";
import type { LookupOption, DiagnosisOption, ExistingDiagnosis } from "@/lib/types";
import type { TreatmentTypeOption } from "@/lib/physio-scoring";

// Malaysia is pinned first -- the overwhelming majority of residents/patients
// are Malaysian, so it should be the fastest option to reach and the default
// selection, with the rest alphabetical after it.
export async function getNationalities(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tbl_nationalities").select("id, country_name").order("country_name");
  const options = (data ?? []).map((r) => ({ id: r.id, label: r.country_name }));
  const malaysiaIndex = options.findIndex((o) => o.label === "Malaysia");
  if (malaysiaIndex > 0) {
    const [malaysia] = options.splice(malaysiaIndex, 1);
    options.unshift(malaysia);
  }
  return options;
}

export async function getDietTypes(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tbl_diet_types").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
}

export async function getFeedingTypes(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tbl_feeding_types").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
}

export async function getPositions(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tbl_positions").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
}

// Branches are displayed everywhere as just "<BranchLocale>" (e.g. "ALMA")
// rather than the full BranchName -- shorter and matches how staff refer
// to branches day to day.
export function formatBranch(branch: { locale: string | null; code: string } | null | undefined): string {
  if (!branch) return "--";
  return branch.locale ?? branch.code;
}

// onlyFunction restricts to branches whose tbl_branches.Function matches
// (e.g. "NUR" for the resident-admission branch picker, which should only
// ever offer nursing branches -- "PHY" physiotherapy branches like AMP
// don't register residents). Omit for every branch, unfiltered.
export async function getBranches(onlyFunction?: string): Promise<LookupOption[]> {
  const supabase = await createClient();
  // tbl_branches' columns are PascalCase (BranchID/BranchLocale/BranchCode)
  // -- aliased back to lowercase here so nothing downstream has to know that.
  let query = supabase.from("tbl_branches").select("id:BranchID, locale:BranchLocale, code:BranchCode");
  if (onlyFunction) query = query.eq("Function", onlyFunction);
  const { data } = await query.order("BranchCode");
  return (data ?? []).map((r) => ({ id: r.id, label: formatBranch(r) }));
}

// Branches whose BranchCode is "DEMO" hold fake/test residents used only for
// demonstrations. Admins see all branches by default, but demo data pollutes
// their views of real clinical activity, so these IDs are used to exclude
// demo residents and their records from every admin-facing query.
export async function getDemoBranchIds(): Promise<number[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_branches")
    .select("BranchID")
    .eq("BranchCode", "DEMO");
  return (data ?? []).map((b) => Number(b.BranchID));
}

// A physio-hub branch (Function = "PHY", e.g. AMP) has no residents of its
// own -- its physiotherapists cover the residential (Function = "NUR")
// branches for inpatient work instead, and their own hub for outpatients.
// Used by the physiotherapy module's branch-scoping checks. Driven by the
// Function column rather than a hardcoded branch id, so a newly added
// nursing branch (or a second physio hub) is in scope automatically.
export async function getPhysioIpBranchIds(account: { branch_id: number; branch_function: string | null }): Promise<number[]> {
  if (account.branch_function !== "PHY") return [account.branch_id];
  const nurBranches = await getBranches("NUR");
  return nurBranches.map((b) => Number(b.id));
}

// Used for "who actually did this" pickers on entry forms (progress notes,
// resident admission, nursing chart entries, stock entries, etc.) -- branch
// logins can be shared, so the app never assumes the signed-in account is
// the real person; these forms ask explicitly instead. Scoped to one branch
// and active staff only.
//
// allowedRoles restricts which tbl_staff.role values can be picked on a
// given form -- e.g. a nursing chart entry passes ["STAFF"], a stock entry
// passes ["MODERATOR"]. ADMIN staff are always included regardless, since
// admins can act anywhere. Omit allowedRoles (or pass nothing) for a form
// with no role restriction, which includes every active role.
export async function getStaffRoster(branchId: number, allowedRoles?: string[]): Promise<LookupOption[]> {
  const supabase = await createClient();
  let query = supabase
    .from("tbl_staff")
    .select("id:StaffID, staff_name")
    .eq("branch_id", branchId)
    .eq("status", "ACTIVE");
  if (allowedRoles) query = query.in("role", [...new Set([...allowedRoles, "ADMIN"])]);
  const { data } = await query.order("staff_name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.staff_name }));
}

// Same idea as getStaffRoster, but unscoped + carries branch_id -- for forms
// (like resident admission) where the branch itself is also a form field, so
// filtering has to happen client-side as the user picks a branch.
//
// department restricts to a single tbl_staff.department (e.g. "Physiotherapy"
// for the physio assessment's "Documented by" picker) -- ADMIN staff are
// still always included regardless of department, same "admins can act
// anywhere" convention as allowedRoles below.
export async function getAllStaffWithBranch(
  allowedRoles?: string[],
  department?: string
): Promise<(LookupOption & { branch_id: number })[]> {
  const supabase = await createClient();
  let query = supabase.from("tbl_staff").select("id:StaffID, staff_name, branch_id").eq("status", "ACTIVE");
  if (allowedRoles) query = query.in("role", [...new Set([...allowedRoles, "ADMIN"])]);
  if (department) query = query.or(`department.eq.${department},role.eq.ADMIN`);
  const { data } = await query.order("staff_name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.staff_name, branch_id: r.branch_id }));
}

// The Physiotherapy module (assessment "Documented by" picker, and the
// Analytics dashboard's therapist filter/breakdowns) is used exclusively by
// physiotherapists -- unlike getAllStaffWithBranch's department filter, this
// does NOT fall back to including ADMIN staff, since an admin login is never
// the person who actually performed a physio session.
export async function getPhysiotherapyStaff(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_staff")
    .select("id:StaffID, staff_name")
    .eq("status", "ACTIVE")
    .eq("department", "Physiotherapy")
    .order("staff_name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.staff_name }));
}

// The Nursing Chart tab's "entered by" picker is used exclusively by
// nursing and medical staff -- same "no ADMIN fallback" convention as
// getPhysiotherapyStaff, since an admin login is never the person who
// actually took a nursing chart entry. Carries branch_id (like
// getAllStaffWithBranch) because the form filters client-side once a
// resident/branch is picked.
export async function getNursingStaff(): Promise<(LookupOption & { branch_id: number })[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_staff")
    .select("id:StaffID, staff_name, branch_id")
    .eq("status", "ACTIVE")
    .in("department", ["Nursing", "Medical"])
    .order("staff_name");
  return (data ?? []).map((r) => ({ id: r.id, label: r.staff_name, branch_id: r.branch_id }));
}

// Treatment types + their credit-hour value, e.g. "Full Physio (1hr)" -> 1.
// Lives in tbl_physio_treatment_types (not hardcoded) specifically so credit
// hours can be changed directly in Supabase -- e.g. turning a 1-hour session
// into 2 credit hours -- without editing code. Powers both the assessment
// form's treatment-type dropdown/auto-fill and the analytics dashboard.
// Configurable pressure-injury / wound documentation sites shown as tap
// targets on the Wound Photo body diagram, plus an "Other" free-text
// fallback. Same "lives in Supabase, not hardcoded" reasoning as
// tbl_physio_treatment_types -- new sites can be added without a code change.
export async function getWoundBodyParts(): Promise<LookupOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_wound_body_parts")
    .select("id, label")
    .eq("active", true)
    .order("sort_order");
  return (data ?? []).map((r) => ({ id: r.id, label: r.label }));
}

export async function getDiagnosisOptions(): Promise<DiagnosisOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_diagnosis_options")
    .select("id, name_en, name_ms")
    .order("id");
  return (data ?? []).map((r) => ({ id: Number(r.id), name_en: r.name_en, name_ms: r.name_ms ?? null }));
}

export async function getResidentDiagnoses(residentId: number): Promise<ExistingDiagnosis[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_resident_diagnoses")
    .select("diagnosis_option_id, remark")
    .eq("resident_id", residentId);
  return (data ?? []).map((r) => ({ diagnosis_option_id: Number(r.diagnosis_option_id), remark: r.remark ?? null }));
}

export async function getPhysioTreatmentTypes(): Promise<TreatmentTypeOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tbl_physio_treatment_types")
    .select("dept, treatment_type, credit_hours")
    .order("dept")
    .order("sort_order");
  return (data ?? []).map((r) => ({ label: r.treatment_type, creditHours: Number(r.credit_hours), dept: r.dept }));
}

export type ClinicalLookups = {
  // group_type ("Amount" | "Texture") lets the form enforce one selection
  // per set while letting the two sets mix freely.
  bowelOutputTypes: (LookupOption & { group: string | null })[];
  passUrineTypes: LookupOption[];
  activities: LookupOption[];
  disturbanceLevels: LookupOption[];
  psychoSocialBehaviours: LookupOption[];
  activeComplaints: LookupOption[];
  hygieneCareActivities: (LookupOption & { category: string })[];
  // GCS/AVPU live on tbl_vital ("Advanced Observation"), not the nursing
  // chart -- kept in this same bundle since Vitals needs them fetched the
  // same way, not because they're nursing-chart fields.
  gcsEyeResponses: LookupOption[];
  gcsVerbalResponses: LookupOption[];
  gcsMotorResponses: LookupOption[];
  avpuOptions: LookupOption[];
  mealTypes: LookupOption[];
  mealPortions: LookupOption[];
  feedingTimes: LookupOption[];
};

// Every fixed-vocabulary field the Nursing Chart new-entry form (and its
// two child tables, hygiene episodes + meals) and the Vitals "Advanced
// Observation" section need -- bundled into one call since none of these
// are large enough to bother paginating or lazy-loading.
export async function getClinicalLookups(): Promise<ClinicalLookups> {
  const supabase = await createClient();
  const [
    bowel,
    urine,
    activities,
    disturbance,
    psychoSocial,
    complaints,
    hygiene,
    gcsEye,
    gcsVerbal,
    gcsMotor,
    avpu,
    mealTypes,
    mealPortions,
    feedingTimes,
  ] = await Promise.all([
    supabase.from("tbl_bowel_output_types").select("id, name, group_type").order("id"),
    supabase.from("tbl_pass_urine_types").select("id, name").order("id"),
    supabase.from("tbl_activities").select("id, name").order("id"),
    supabase.from("tbl_disturbance_levels").select("id, description").order("level"),
    supabase.from("tbl_psycho_social_behaviours").select("id, name").order("id"),
    supabase.from("tbl_active_complaints").select("id, name_en").order("id"),
    supabase.from("tbl_hygiene_care_activities").select("id, category, activity").order("id"),
    supabase.from("tbl_gcs_eye_responses").select("id, description").order("score", { ascending: false }),
    supabase.from("tbl_gcs_verbal_responses").select("id, description").order("score", { ascending: false }),
    supabase.from("tbl_gcs_motor_responses").select("id, description").order("score", { ascending: false }),
    supabase.from("tbl_avpu_options").select("id, label").order("id"),
    supabase.from("tbl_meal_types").select("id, name").order("id"),
    supabase.from("tbl_meal_portions").select("id, name").order("id"),
    supabase.from("tbl_feeding_times").select("id, time_of_day").order("id"),
  ]);

  return {
    bowelOutputTypes: (bowel.data ?? []).map((r) => ({ id: r.id, label: r.name, group: r.group_type })),
    passUrineTypes: (urine.data ?? []).map((r) => ({ id: r.id, label: r.name })),
    activities: (activities.data ?? []).map((r) => ({ id: r.id, label: r.name })),
    disturbanceLevels: (disturbance.data ?? []).map((r) => ({ id: r.id, label: r.description })),
    psychoSocialBehaviours: (psychoSocial.data ?? []).map((r) => ({ id: r.id, label: r.name })),
    activeComplaints: (complaints.data ?? []).map((r) => ({ id: r.id, label: r.name_en })),
    hygieneCareActivities: (hygiene.data ?? []).map((r) => ({ id: r.id, label: r.activity, category: r.category })),
    gcsEyeResponses: (gcsEye.data ?? []).map((r) => ({ id: r.id, label: r.description })),
    gcsVerbalResponses: (gcsVerbal.data ?? []).map((r) => ({ id: r.id, label: r.description })),
    gcsMotorResponses: (gcsMotor.data ?? []).map((r) => ({ id: r.id, label: r.description })),
    avpuOptions: (avpu.data ?? []).map((r) => ({ id: r.id, label: r.label })),
    mealTypes: (mealTypes.data ?? []).map((r) => ({ id: r.id, label: r.name })),
    mealPortions: (mealPortions.data ?? []).map((r) => ({ id: r.id, label: r.name })),
    feedingTimes: (feedingTimes.data ?? []).map((r) => ({ id: r.id, label: String(r.time_of_day).slice(0, 5) })),
  };
}
