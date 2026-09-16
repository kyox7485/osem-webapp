import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { getAllStaffWithBranch } from "@/lib/lookups";
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
import { PhysioAssessmentTabs } from "./assessment-tabs";
import { PhysioDirtyProvider } from "./physio-dirty-context";
import { ResidentPicker } from "./resident-picker";
import type { PreviousAssessment } from "./new-physio-assessment-form";
import type { ReviewAssessment } from "./assessment-review";

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

  const { type, resident: residentIdParam } = await searchParams;
  const careSetting: PhysioCareSetting = type === "op" ? "OP" : "IP";
  const supabase = await createClient();

  let residentQuery = supabase
    .from("tbl_residents")
    .select("id, resident_name, branch_id")
    .eq("status", "ACTIVE")
    .order("resident_name");

  if (account.rights !== "ADMIN") {
    residentQuery = residentQuery.eq("branch_id", account.branch_id);
  }

  const { data: residents } = await residentQuery;

  const selectedResident = residentIdParam
    ? (residents ?? []).find((r) => String(r.id) === residentIdParam)
    : undefined;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Physiotherapy</h1>
      </div>

      <CareSettingTabs current={careSetting} />

      {careSetting === "OP" ? (
        <div className="mt-4 rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
          Outpatient module coming soon.
        </div>
      ) : (
        <PhysioDirtyProvider>
          <ResidentPicker residents={residents ?? []} currentResident={residentIdParam || ""} />

          {!selectedResident ? (
            <div className="mt-4 rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
              Select a resident to view or add a physiotherapy assessment.
            </div>
          ) : (
            <div className="mt-4">
              {/* Keyed by resident so switching residents fully remounts the
                  form (fresh state, tab reset to New Entry) instead of
                  reusing the previous resident's component instance. */}
              <PhysiotherapyResidentContent
                key={selectedResident.id}
                residentId={selectedResident.id}
                careSetting={careSetting}
                account={account}
              />
            </div>
          )}
        </PhysioDirtyProvider>
      )}
    </div>
  );
}

async function PhysiotherapyResidentContent({
  residentId,
  careSetting,
  account,
}: {
  residentId: number;
  careSetting: PhysioCareSetting;
  account: { rights: string; branch_id: number };
}) {
  const supabase = await createClient();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("id, resident_name, ic_number, branch_id, gender, age, past_medical_condition")
    .eq("id", residentId)
    .single();

  if (!resident) {
    return <p className="text-sm text-red-600">Resident not found.</p>;
  }

  if (account.rights !== "ADMIN" && resident.branch_id !== account.branch_id) {
    return <p className="text-sm text-red-600">Access denied.</p>;
  }

  const [{ data: assessments, error: assessmentsError }, staffOptions] = await Promise.all([
    supabase
      .from("physio_assessments")
      .select("*, tbl_staff!documented_by(staff_name)")
      .eq("resident_id", residentId)
      .eq("care_setting", careSetting)
      .order("entry_timestamp", { ascending: false }),
    getAllStaffWithBranch(undefined, "Physiotherapy"),
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
        residentName={resident.resident_name}
        icNumber={resident.ic_number}
        gender={resident.gender}
        age={resident.age}
        careSetting={careSetting}
        defaultEntryTimestamp={toDatetimeLocalValue(new Date().toISOString())}
        pastMedicalCondition={resident.past_medical_condition}
        staffOptions={staffOptions}
        previous={previous}
        reviewAssessments={reviewAssessments}
      />
    </>
  );
}
