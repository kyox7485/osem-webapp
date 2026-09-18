import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { getClinicalLookups } from "@/lib/lookups";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import { VitalSignsDocument, type VitalSignRow } from "@/lib/pdf/documents/vital-signs-document";
import { formatDate } from "@/lib/format-date";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const residentId = request.nextUrl.searchParams.get("resident");
  const start = request.nextUrl.searchParams.get("start") || "";
  const end = request.nextUrl.searchParams.get("end") || "";
  if (!residentId) return NextResponse.json({ error: "Missing resident" }, { status: 400 });

  const supabase = await createClient();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("resident_name, ic_number, branch_id")
    .eq("id", residentId)
    .single();

  if (!resident) return NextResponse.json({ error: "Resident not found" }, { status: 404 });
  if (account.rights !== "ADMIN" && resident.branch_id !== account.branch_id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let query = supabase
    .from("tbl_vital")
    .select(
      `
      id,
      entry_timestamp,
      systolic_bp,
      diastolic_bp,
      heart_rate,
      temperature,
      spo2,
      spo2_condition,
      dxt,
      dxt_remark,
      insulin_adjustment,
      respiration_rate,
      gcs_eye_id,
      gcs_verbal_id,
      gcs_motor_id,
      avpu_id,
      tbl_staff!reviewed_by(staff_name)
    `
    )
    .eq("resident_id", residentId)
    .order("entry_timestamp", { ascending: false });

  if (start) query = query.gte("entry_timestamp", `${start}T00:00:00`);
  if (end) query = query.lte("entry_timestamp", `${end}T23:59:59`);

  const [{ data: rawVitals, error }, lookups] = await Promise.all([query, getClinicalLookups()]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const gcsEyeById = new Map(lookups.gcsEyeResponses.map((o) => [Number(o.id), o.label]));
  const gcsVerbalById = new Map(lookups.gcsVerbalResponses.map((o) => [Number(o.id), o.label]));
  const gcsMotorById = new Map(lookups.gcsMotorResponses.map((o) => [Number(o.id), o.label]));
  const avpuById = new Map(lookups.avpuOptions.map((o) => [Number(o.id), o.label]));

  const rows: VitalSignRow[] = (rawVitals ?? []).map((v: any) => {
    const staff = Array.isArray(v.tbl_staff) ? v.tbl_staff[0] : v.tbl_staff;
    const gcsParts = [
      v.gcs_eye_id ? `E${gcsEyeById.get(v.gcs_eye_id)?.split(" - ")[0]}` : null,
      v.gcs_verbal_id ? `V${gcsVerbalById.get(v.gcs_verbal_id)?.split(" - ")[0]}` : null,
      v.gcs_motor_id ? `M${gcsMotorById.get(v.gcs_motor_id)?.split(" - ")[0]}` : null,
    ].filter(Boolean);

    return {
      id: v.id,
      entry_timestamp: v.entry_timestamp,
      systolic_bp: v.systolic_bp,
      diastolic_bp: v.diastolic_bp,
      heart_rate: v.heart_rate,
      temperature: v.temperature,
      spo2: v.spo2,
      spo2_condition: v.spo2_condition,
      dxt: v.dxt,
      dxt_remark: v.dxt_remark,
      insulin_adjustment: v.insulin_adjustment,
      respiration_rate: v.respiration_rate,
      gcs_label: gcsParts.length > 0 ? gcsParts.join(" ") : null,
      avpu_label: v.avpu_id ? avpuById.get(v.avpu_id) ?? null : null,
      reviewed_by_name: staff?.staff_name ?? null,
    };
  });

  const rangeLabel = start || end ? `${start ? formatDate(`${start}T00:00:00`) : "--"} to ${end ? formatDate(`${end}T00:00:00`) : "--"}` : "All Records";

  const branch = await getReportBranchInfo(resident.branch_id);
  const buffer = await renderToBuffer(
    <VitalSignsDocument
      residentName={resident.resident_name}
      icNumber={resident.ic_number}
      rangeLabel={rangeLabel}
      rows={rows}
      branch={branch}
      logoSrc={getLogoPath()}
    />
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="vital-signs-${residentId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
