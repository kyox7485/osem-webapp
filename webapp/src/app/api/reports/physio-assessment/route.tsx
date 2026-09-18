import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { getPhysioIpBranchIds } from "@/lib/lookups";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import { PhysioAssessmentDocument, type PhysioAssessmentReportData } from "@/lib/pdf/documents/physio-assessment-document";
import { EMPTY_BALANCE, EMPTY_COORDINATION, EMPTY_FUNCTIONAL } from "@/lib/physio-scoring";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = await createClient();
  const { data: assessment, error } = await supabase
    .from("physio_assessments")
    .select(
      `
      id,
      branch_id,
      resident_id,
      op_patient_id,
      care_setting,
      entry_timestamp,
      treatment_type,
      chief_complaint,
      current_history,
      past_medical_history,
      social_history,
      impression,
      plan_intervention,
      evaluation,
      treatment_compliance,
      total_score,
      tbl_staff!documented_by(staff_name),
      tbl_residents!resident_id(resident_name, ic_number, gender, age),
      tbl_physio_op_patients!op_patient_id(patient_name, ic_number, gender, age)
    `
    )
    .eq("id", id)
    .single();

  if (error || !assessment) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });

  if (account.rights !== "ADMIN") {
    const allowedBranchIds = assessment.care_setting === "OP" ? [account.branch_id] : await getPhysioIpBranchIds(account);
    if (!allowedBranchIds.includes(assessment.branch_id)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }

  const author = Array.isArray(assessment.tbl_staff) ? assessment.tbl_staff[0] : assessment.tbl_staff;
  const residentRaw = Array.isArray(assessment.tbl_residents) ? assessment.tbl_residents[0] : assessment.tbl_residents;
  const opPatientRaw = Array.isArray(assessment.tbl_physio_op_patients) ? assessment.tbl_physio_op_patients[0] : assessment.tbl_physio_op_patients;
  const patient = assessment.care_setting === "OP" ? opPatientRaw : residentRaw;
  const patientName = patient ? ("patient_name" in patient ? patient.patient_name : patient.resident_name) : "--";

  const [{ data: examRowsRaw }, { data: bodyChartRaw }, { data: functionalRaw }, { data: balanceRaw }, { data: coordinationRaw }] = await Promise.all([
    supabase.from("physio_examinations").select("limb, region, movement, side, power, tone, rom, reflexes").eq("assessment_id", id),
    supabase.from("physio_body_chart_findings").select("region, side, comment").eq("assessment_id", id),
    supabase.from("physio_functional_assessments").select("*").eq("assessment_id", id).maybeSingle(),
    supabase.from("physio_balance_assessments").select("*").eq("assessment_id", id).maybeSingle(),
    supabase.from("physio_coordination_assessments").select("*").eq("assessment_id", id).maybeSingle(),
  ]);

  const reportData: PhysioAssessmentReportData = {
    entry_timestamp: assessment.entry_timestamp,
    patient_name: patientName,
    ic_number: patient?.ic_number ?? null,
    gender: patient?.gender ?? null,
    age: patient?.age ?? null,
    care_setting: assessment.care_setting,
    treatment_type: assessment.treatment_type,
    total_score: assessment.total_score,
    chief_complaint: assessment.chief_complaint,
    current_history: assessment.current_history,
    past_medical_history: assessment.past_medical_history,
    social_history: assessment.social_history,
    impression: assessment.impression,
    plan_intervention: assessment.plan_intervention,
    evaluation: assessment.evaluation,
    treatment_compliance: assessment.treatment_compliance,
    documented_by_name: author?.staff_name ?? "--",
    examRows: examRowsRaw ?? [],
    bodyChart: bodyChartRaw ?? [],
    functional: functionalRaw
      ? {
          supine_to_side_lying: functionalRaw.supine_to_side_lying,
          side_lying_to_sitting: functionalRaw.side_lying_to_sitting,
          sitting_to_standing: functionalRaw.sitting_to_standing,
          sit_at_edge_of_bed: functionalRaw.sit_at_edge_of_bed,
          ambulation: functionalRaw.ambulation,
        }
      : EMPTY_FUNCTIONAL,
    balance: balanceRaw
      ? {
          sitting_static: balanceRaw.sitting_static,
          sitting_dynamic: balanceRaw.sitting_dynamic,
          standing_static: balanceRaw.standing_static,
          standing_dynamic: balanceRaw.standing_dynamic,
        }
      : EMPTY_BALANCE,
    coordination: coordinationRaw
      ? {
          upper_limb_right: coordinationRaw.upper_limb_right,
          upper_limb_left: coordinationRaw.upper_limb_left,
          lower_limb_right: coordinationRaw.lower_limb_right,
          lower_limb_left: coordinationRaw.lower_limb_left,
        }
      : EMPTY_COORDINATION,
  };

  const branch = await getReportBranchInfo(assessment.branch_id);
  const buffer = await renderToBuffer(<PhysioAssessmentDocument data={reportData} branch={branch} logoSrc={getLogoPath()} />);

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="physio-assessment-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
