import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import { HospitalReferralDocument, type HospitalReferralReportData } from "@/lib/pdf/documents/hospital-referral-document";

// Node runtime, not Edge -- @react-pdf/renderer needs Node APIs (Buffer,
// fs for the bundled logo) that the Edge runtime doesn't provide.
export const runtime = "nodejs";

// Renders straight into an in-memory buffer and streams it back as the HTTP
// response -- nothing is ever written to disk, so there is nothing to clean
// up once the user closes the tab.
export async function GET(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = await createClient();
  const { data: referral, error } = await supabase
    .from("tbl_hospital_referrals")
    .select(
      `
      branch_id,
      referral_datetime,
      chief_complaints,
      vital_signs,
      mobility,
      feeding,
      hygiene,
      tbl_residents!resident_id(resident_name, ic_number, admission_date, emergency_contact, allergy, past_medical_condition, current_medication_list, branch_id),
      reviewer:tbl_staff!reviewed_by(staff_name)
    `
    )
    .eq("id", id)
    .single();

  if (error || !referral) return NextResponse.json({ error: "Hospital referral not found" }, { status: 404 });

  const resident = Array.isArray(referral.tbl_residents) ? referral.tbl_residents[0] : referral.tbl_residents;
  const reviewer = Array.isArray(referral.reviewer) ? referral.reviewer[0] : referral.reviewer;

  if (account.rights !== "ADMIN" && referral.branch_id !== account.branch_id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const reportData: HospitalReferralReportData = {
    referral_datetime: referral.referral_datetime,
    resident_name: resident?.resident_name ?? "--",
    ic_number: resident?.ic_number ?? null,
    admission_date: resident?.admission_date ?? null,
    emergency_contact: resident?.emergency_contact ?? null,
    allergy: resident?.allergy ?? null,
    past_medical_condition: resident?.past_medical_condition ?? null,
    current_medication_list: resident?.current_medication_list ?? null,
    chief_complaints: referral.chief_complaints,
    vital_signs: referral.vital_signs,
    mobility: referral.mobility,
    feeding: referral.feeding,
    hygiene: referral.hygiene,
    reviewer_name: reviewer?.staff_name ?? "--",
  };

  const branch = await getReportBranchInfo(referral.branch_id);
  const buffer = await renderToBuffer(
    <HospitalReferralDocument referral={reportData} branch={branch} logoSrc={getLogoPath()} />
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="hospital-referral-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
