import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import { ResidentDocument, type ResidentReportData } from "@/lib/pdf/documents/resident-document";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = await createClient();

  const { data: resident, error } = await supabase
    .from("tbl_residents")
    .select(
      `
      id,
      branch_id,
      ResidentID,
      resident_name,
      ic_number,
      age,
      gender,
      marital_status,
      status,
      care_type,
      admission_date,
      discharge_date,
      transfer_from,
      accompanied_by,
      emergency_contact,
      mobility,
      hygiene,
      allergy,
      assessment_and_summary,
      tca_notes,
      reviewed_by,
      reviewed_by_other,
      tbl_nationalities(country_name),
      tbl_diet_types(name),
      tbl_feeding_types(name)
    `
    )
    .eq("id", id)
    .single();

  if (error || !resident) return NextResponse.json({ error: "Resident not found" }, { status: 404 });

  if (!canAccessAllBranches(account) && resident.branch_id !== account.branch_id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Fetch diagnoses
  const { data: diagnosisRows } = await supabase
    .from("tbl_resident_diagnoses")
    .select("diagnosis_option_id, remark, tbl_diagnosis_options(name_en)")
    .eq("resident_id", parseInt(id, 10));

  const diagnosesText = diagnosisRows && diagnosisRows.length > 0
    ? diagnosisRows
        .map((r) => {
          const opt = Array.isArray(r.tbl_diagnosis_options) ? r.tbl_diagnosis_options[0] : r.tbl_diagnosis_options;
          const name = opt?.name_en ?? String(r.diagnosis_option_id);
          return name === "Others" && r.remark ? `Others: ${r.remark}` : name;
        })
        .join(", ")
    : null;

  // Fetch reviewer name
  const reviewedByStaffId = resident.reviewed_by;
  let reviewerName: string | null = resident.reviewed_by_other ?? null;
  if (reviewedByStaffId && !reviewerName) {
    const { data: staff } = await supabase
      .from("tbl_staff")
      .select("staff_name")
      .eq("StaffID", reviewedByStaffId)
      .single();
    reviewerName = staff?.staff_name ?? reviewedByStaffId;
  }

  const nationality = Array.isArray(resident.tbl_nationalities) ? resident.tbl_nationalities[0] : resident.tbl_nationalities;
  const dietType = Array.isArray(resident.tbl_diet_types) ? resident.tbl_diet_types[0] : resident.tbl_diet_types;
  const feedingType = Array.isArray(resident.tbl_feeding_types) ? resident.tbl_feeding_types[0] : resident.tbl_feeding_types;

  const reportData: ResidentReportData = {
    ResidentID: resident.ResidentID ?? null,
    resident_name: resident.resident_name,
    ic_number: resident.ic_number ?? null,
    age: resident.age ?? null,
    gender: resident.gender ?? null,
    marital_status: resident.marital_status ?? null,
    nationality: nationality?.country_name ?? null,
    status: resident.status,
    care_type: resident.care_type ?? null,
    admission_date: resident.admission_date ?? null,
    discharge_date: resident.discharge_date ?? null,
    transfer_from: resident.transfer_from ?? null,
    accompanied_by: resident.accompanied_by ?? null,
    emergency_contact: resident.emergency_contact ?? null,
    mobility: resident.mobility ?? null,
    hygiene: resident.hygiene ?? null,
    diet_type: dietType?.name ?? null,
    feeding_type: feedingType?.name ?? null,
    allergy: resident.allergy ?? null,
    diagnoses: diagnosesText,
    assessment_and_summary: resident.assessment_and_summary ?? null,
    tca_notes: resident.tca_notes ?? null,
    reviewed_by: reviewerName,
  };

  const branch = await getReportBranchInfo(resident.branch_id);
  const buffer = await renderToBuffer(
    <ResidentDocument resident={reportData} branch={branch} logoSrc={getLogoPath()} />
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="resident-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
