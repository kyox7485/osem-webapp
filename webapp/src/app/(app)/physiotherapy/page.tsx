import { createClient } from "@/lib/supabase/server";
import { getServerTranslator } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/current-user";
import { getPhysiotherapyStaff, getPhysioTreatmentTypes, getPhysioIpBranchIds } from "@/lib/lookups";
import { toDatetimeLocalValue } from "@/lib/format-date";
import { redirect } from "next/navigation";
import {
  EMPTY_BALANCE,
  EMPTY_COORDINATION,
  EMPTY_FUNCTIONAL,
  type BalanceScores,
  type CoordinationScores,
  type ExamRow,
  type FunctionalScores,
  type PhysioCareSetting,
} from "@/lib/physio-scoring";
import { CareSettingTabs } from "./care-setting-tabs";
import { PhysioModuleTabs } from "./module-tabs";
import { PhysioAssessmentTabs } from "./assessment-tabs";
import { PhysioDirtyProvider } from "./physio-dirty-context";
import { ResidentPicker } from "./resident-picker";
import { NewOpPatientForm } from "./new-op-patient-form";
import type { PreviousAssessment } from "./new-physio-assessment-form";
import type { ReviewAssessment } from "./assessment-review";
import { PageTitle } from "@/components/page-header";

// These rows come from `select("*")`, which also carries id/branch_id/
// assessment_id -- pick only the named score fields so those extra numeric
// columns can never leak into computePhysioScore (it sums every value in
// these objects).
function pickFunctional(row: any): FunctionalScores {
  if (!row) return EMPTY_FUNCTIONAL;
  return {
    supine_to_side_lying: row.supine_to_side_lying,
    side_lying_to_sitting: row.side_lying_to_sitting,
    sitting_to_standing: row.sitting_to_standing,
    sit_at_edge_of_bed: row.sit_at_edge_of_bed,
    ambulation: row.ambulation,
  };
}

function pickBalance(row: any): BalanceScores {
  if (!row) return EMPTY_BALANCE;
  return {
    sitting_static: row.sitting_static,
    sitting_dynamic: row.sitting_dynamic,
    standing_static: row.standing_static,
    standing_dynamic: row.standing_dynamic,
  };
}

function pickCoordination(row: any): CoordinationScores {
  if (!row) return EMPTY_COORDINATION;
  return {
    upper_limb_right: row.upper_limb_right,
    upper_limb_left: row.upper_limb_left,
    lower_limb_right: row.lower_limb_right,
    lower_limb_left: row.lower_limb_left,
  };
}


export default async function PhysiotherapyPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; resident?: string }>;
}) {
  const account = await getCurrentUser();
  if (!account) redirect("/login");

  const { t } = await getServerTranslator();

  const { type, resident: residentIdParam } = await searchParams;
  const careSetting: PhysioCareSetting = type === "op" ? "OP" : "IP";
  const supabase = await createClient();

  // IP patients are active tbl_residents; OP patients are the separate
  // tbl_physio_op_patients list (no "ACTIVE" status column of its own --
  // every row in that table is a standing outpatient registration).
  let patientQuery =
    careSetting === "OP"
      ? supabase.from("tbl_physio_op_patients").select("id, resident_name:patient_name, branch_id").order("patient_name")
      : supabase.from("tbl_residents").select("id, resident_name, branch_id").eq("status", "ACTIVE").order("resident_name");

  if (account.rights !== "ADMIN") {
    if (careSetting === "OP") {
      patientQuery = patientQuery.eq("branch_id", account.branch_id);
    } else {
      patientQuery = patientQuery.in("branch_id", await getPhysioIpBranchIds(account));
    }
  }

  const { data: patients } = await patientQuery;

  const selectedPatient = residentIdParam
    ? (patients ?? []).find((r) => String(r.id) === residentIdParam)
    : undefined;

  return (
    <div>
      <PageTitle title={t("Physiotherapy")} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PhysioModuleTabs />
        <CareSettingTabs current={careSetting} />
      </div>

      <PhysioDirtyProvider>
        <ResidentPicker
          residents={patients ?? []}
          currentResident={residentIdParam || ""}
          careSetting={careSetting}
          label={careSetting === "OP" ? t("Patient") : t("Resident")}
        />

        {careSetting === "OP" && <NewOpPatientForm />}

        <div className="mt-4">
          {/* Keyed by patient (or "all") so switching fully remounts (fresh
              state, tab reset) instead of reusing the previous instance. */}
          <PhysiotherapyContent
            key={`${careSetting}-${selectedPatient?.id ?? "all"}`}
            residentId={selectedPatient?.id ?? null}
            careSetting={careSetting}
            account={account}
          />
        </div>
      </PhysioDirtyProvider>
    </div>
  );
}

// Same "unfiltered by default" convention as Clinical's Vital Signs and
// Medical Progress Notes tabs: with no specific patient picked above,
// Review Notes shows every entry for the branch(es)/care setting in
// scope, each row labelled with whose it is. New Entry has nothing to
// attach to without a patient, so it just prompts to pick one (handled by
// PhysioAssessmentTabs itself when residentId is null).
async function AllPatientsReview({
  careSetting,
  account,
}: {
  careSetting: PhysioCareSetting;
  account: { rights: string; branch_id: number; branch_function: string | null };
}) {
  const supabase = await createClient();

  let query = supabase
    .from("physio_assessments")
    .select(
      careSetting === "OP"
        ? "*, tbl_staff!documented_by(staff_name), tbl_physio_op_patients!op_patient_id(patient_name)"
        : "*, tbl_staff!documented_by(staff_name), tbl_residents!resident_id(resident_name)"
    )
    .eq("care_setting", careSetting)
    .order("entry_timestamp", { ascending: false });

  if (account.rights !== "ADMIN") {
    const allowedBranchIds = careSetting === "OP" ? [account.branch_id] : await getPhysioIpBranchIds(account);
    query = query.in("branch_id", allowedBranchIds);
  }

  const { data: assessments, error } = await query;

  type RawRow = {
    id: number;
    entry_timestamp: string;
    treatment_type: string | null;
    total_score: number | null;
    chief_complaint: string | null;
    current_history: string | null;
    past_medical_history: string | null;
    social_history: string | null;
    impression: string | null;
    plan_intervention: string | null;
    evaluation: string | null;
    treatment_compliance: string | null;
    tbl_staff: { staff_name: string } | { staff_name: string }[] | null;
    tbl_residents?: { resident_name: string } | { resident_name: string }[] | null;
    tbl_physio_op_patients?: { patient_name: string } | { patient_name: string }[] | null;
  };

  const reviewAssessments: ReviewAssessment[] = ((assessments ?? []) as unknown as RawRow[]).map((a) => {
    const author = Array.isArray(a.tbl_staff) ? a.tbl_staff[0] : a.tbl_staff;
    const patientRaw = careSetting === "OP" ? a.tbl_physio_op_patients : a.tbl_residents;
    const patient = Array.isArray(patientRaw) ? patientRaw[0] : patientRaw;
    return {
      id: a.id,
      entry_timestamp: a.entry_timestamp,
      treatment_type: a.treatment_type,
      total_score: a.total_score,
      documented_by_name: author?.staff_name ?? "--",
      patient_name: patient ? ("patient_name" in patient ? patient.patient_name : patient.resident_name) : "--",
      chief_complaint: a.chief_complaint,
      current_history: a.current_history,
      past_medical_history: a.past_medical_history,
      social_history: a.social_history,
      impression: a.impression,
      plan_intervention: a.plan_intervention,
      evaluation: a.evaluation,
      treatment_compliance: a.treatment_compliance,
      // Body chart / exam grid aren't fetched here -- pulling those for
      // every assessment across every patient in scope would be a much
      // heavier query for a list that's mostly used to spot an entry and
      // then open that one patient. The narrative fields above (and the
      // summary line) are enough to identify it; switching to that
      // specific patient shows the full detail.
      examRows: [],
      bodyChart: [],
    };
  });

  return (
    <>
      {error && <p className="mb-4 text-sm text-red-600">{error.message}</p>}
      <PhysioAssessmentTabs
        residentId={null}
        residentName={null}
        icNumber={null}
        gender={null}
        age={null}
        careSetting={careSetting}
        defaultEntryTimestamp={toDatetimeLocalValue(new Date().toISOString())}
        pastMedicalCondition={null}
        staffOptions={[]}
        treatmentTypeOptions={[]}
        previous={null}
        reviewAssessments={reviewAssessments}
      />
    </>
  );
}

async function PhysiotherapyContent({
  residentId,
  careSetting,
  account,
}: {
  residentId: number | null;
  careSetting: PhysioCareSetting;
  account: { rights: string; branch_id: number; branch_function: string | null };
}) {
  if (residentId === null) {
    return <AllPatientsReview careSetting={careSetting} account={account} />;
  }

  const supabase = await createClient();
  const { t } = await getServerTranslator();

  // OP patients don't have past_medical_condition -- their equivalent
  // free-text field is "remark" -- so pull the columns that exist on each
  // source table and normalize to the same shape below.
  const { data: resident } =
    careSetting === "OP"
      ? await supabase
          .from("tbl_physio_op_patients")
          .select("id, patient_name, ic_number, branch_id, gender, age, remark")
          .eq("id", residentId)
          .single()
      : await supabase
          .from("tbl_residents")
          .select("id, resident_name, ic_number, branch_id, gender, age, past_medical_condition")
          .eq("id", residentId)
          .single();

  if (!resident) {
    return (
      <p className="text-sm text-red-600">
        {careSetting === "OP" ? t("Patient") : t("Resident")} {t("not found.")}
      </p>
    );
  }

  if (account.rights !== "ADMIN") {
    const allowedBranchIds = careSetting === "OP" ? [account.branch_id] : await getPhysioIpBranchIds(account);
    if (!allowedBranchIds.includes(resident.branch_id)) {
      return <p className="text-sm text-red-600">{t("Access denied.")}</p>;
    }
  }

  const residentName = careSetting === "OP" ? (resident as { patient_name: string }).patient_name : (resident as { resident_name: string }).resident_name;
  const pastMedicalCondition =
    careSetting === "OP" ? (resident as { remark: string | null }).remark : (resident as { past_medical_condition: string | null }).past_medical_condition;

  const patientColumn = careSetting === "OP" ? "op_patient_id" : "resident_id";
  const [{ data: assessments, error: assessmentsError }, staffOptions, treatmentTypeOptions] = await Promise.all([
    supabase
      .from("physio_assessments")
      .select("*, tbl_staff!documented_by(staff_name)")
      .eq(patientColumn, residentId)
      .eq("care_setting", careSetting)
      .order("entry_timestamp", { ascending: false }),
    getPhysiotherapyStaff(),
    getPhysioTreatmentTypes(),
  ]);

  const assessmentIds = (assessments ?? []).map((a) => a.id);

  const [{ data: examRowsRaw }, { data: bodyChartRaw }, { data: functionalRaw }, { data: balanceRaw }, { data: coordinationRaw }] =
    assessmentIds.length > 0
      ? await Promise.all([
          supabase.from("physio_examinations").select("*").in("assessment_id", assessmentIds),
          supabase.from("physio_body_chart_findings").select("*").in("assessment_id", assessmentIds),
          supabase.from("physio_functional_assessments").select("*").in("assessment_id", assessmentIds),
          supabase.from("physio_balance_assessments").select("*").in("assessment_id", assessmentIds),
          supabase.from("physio_coordination_assessments").select("*").in("assessment_id", assessmentIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const examByAssessment = new Map<number, ExamRow[]>();
  (examRowsRaw ?? []).forEach((r: any) => {
    const list = examByAssessment.get(r.assessment_id) ?? [];
    list.push({ limb: r.limb, region: r.region, movement: r.movement, side: r.side, power: r.power, tone: r.tone, rom: r.rom, reflexes: r.reflexes });
    examByAssessment.set(r.assessment_id, list);
  });

  const bodyChartByAssessment = new Map<number, { region: string; side: string | null; comment: string }[]>();
  (bodyChartRaw ?? []).forEach((r: any) => {
    const list = bodyChartByAssessment.get(r.assessment_id) ?? [];
    list.push({ region: r.region, side: r.side, comment: r.comment });
    bodyChartByAssessment.set(r.assessment_id, list);
  });

  const functionalByAssessment = new Map((functionalRaw ?? []).map((r: any) => [r.assessment_id, r]));
  const balanceByAssessment = new Map((balanceRaw ?? []).map((r: any) => [r.assessment_id, r]));
  const coordinationByAssessment = new Map((coordinationRaw ?? []).map((r: any) => [r.assessment_id, r]));

  const reviewAssessments: ReviewAssessment[] = (assessments ?? []).map((a: any) => {
    const author = Array.isArray(a.tbl_staff) ? a.tbl_staff[0] : a.tbl_staff;
    return {
      id: a.id,
      entry_timestamp: a.entry_timestamp,
      treatment_type: a.treatment_type,
      total_score: a.total_score,
      documented_by_name: author?.staff_name ?? "--",
      chief_complaint: a.chief_complaint,
      current_history: a.current_history,
      past_medical_history: a.past_medical_history,
      social_history: a.social_history,
      impression: a.impression,
      plan_intervention: a.plan_intervention,
      evaluation: a.evaluation,
      treatment_compliance: a.treatment_compliance,
      examRows: examByAssessment.get(a.id) ?? [],
      bodyChart: bodyChartByAssessment.get(a.id) ?? [],
    };
  });

  const latest = assessments && assessments.length > 0 ? assessments[0] : null;
  const previous: PreviousAssessment | null = latest
    ? {
        chief_complaint: latest.chief_complaint,
        current_history: latest.current_history,
        social_history: latest.social_history,
        treatment_type: latest.treatment_type,
        credit_hours: latest.credit_hours,
        total_score: latest.total_score,
        examRows: examByAssessment.get(latest.id) ?? [],
        functional: pickFunctional(functionalByAssessment.get(latest.id)),
        balance: pickBalance(balanceByAssessment.get(latest.id)),
        coordination: pickCoordination(coordinationByAssessment.get(latest.id)),
      }
    : null;

  return (
    <>
      {assessmentsError && <p className="mb-4 text-sm text-red-600">{assessmentsError.message}</p>}

      <PhysioAssessmentTabs
        residentId={resident.id}
        residentName={residentName}
        icNumber={resident.ic_number}
        gender={resident.gender}
        age={resident.age}
        careSetting={careSetting}
        defaultEntryTimestamp={toDatetimeLocalValue(new Date().toISOString())}
        pastMedicalCondition={pastMedicalCondition}
        staffOptions={staffOptions}
        treatmentTypeOptions={treatmentTypeOptions}
        previous={previous}
        reviewAssessments={reviewAssessments}
      />
    </>
  );
}
