import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import { ProgressNoteDocument, type ProgressNoteReportData } from "@/lib/pdf/documents/progress-note-document";

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
  const { data: note, error } = await supabase
    .from("tbl_progress_notes")
    .select(
      `
      branch_id,
      entry_timestamp,
      progress_note,
      physical_examination,
      medical_plan,
      monitoring_plan,
      feeding_plan,
      dressing_plan,
      nursing_plan,
      physio_plan,
      tbl_residents!resident_id(resident_name, ic_number, past_medical_condition, current_medication_list, branch_id),
      reviewer:tbl_staff!reviewed_by(staff_name),
      author:tbl_staff!created_by(staff_name)
    `
    )
    .eq("id", id)
    .single();

  if (error || !note) return NextResponse.json({ error: "Progress note not found" }, { status: 404 });

  const resident = Array.isArray(note.tbl_residents) ? note.tbl_residents[0] : note.tbl_residents;
  const reviewer = Array.isArray(note.reviewer) ? note.reviewer[0] : note.reviewer;
  const author = Array.isArray(note.author) ? note.author[0] : note.author;

  if (!canAccessAllBranches(account) && note.branch_id !== account.branch_id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const reportData: ProgressNoteReportData = {
    entry_timestamp: note.entry_timestamp,
    resident_name: resident?.resident_name ?? "--",
    ic_number: resident?.ic_number ?? null,
    past_medical_condition: resident?.past_medical_condition ?? null,
    progress_note: note.progress_note,
    physical_examination: note.physical_examination,
    medical_plan: note.medical_plan,
    monitoring_plan: note.monitoring_plan,
    feeding_plan: note.feeding_plan,
    dressing_plan: note.dressing_plan,
    nursing_plan: note.nursing_plan,
    physio_plan: note.physio_plan,
    current_medication_list: resident?.current_medication_list ?? null,
    author_name: author?.staff_name ?? "--",
    reviewer_name: reviewer?.staff_name ?? "--",
  };

  const branch = await getReportBranchInfo(note.branch_id);
  const buffer = await renderToBuffer(
    <ProgressNoteDocument note={reportData} branch={branch} logoSrc={getLogoPath()} />
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="medical-progress-note-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
