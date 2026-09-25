import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { getServerTranslator } from "@/lib/i18n/server";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import { OsemPurchaseListDocument } from "@/lib/pdf/documents/osem-purchase-list-document";
import { formatDate } from "@/lib/format-date";
import { LOW_STOCK_DAYS } from "@/lib/medication-stock";
import { buildStockReport, nothingToGenerateResponse } from "@/lib/medication-stock-report";

export const runtime = "nodejs";

// Medication Purchase List PDF (internal): OSEM-supplied active orders, grouped by
// buildStockReport. Rendered in memory and streamed — never stored.

export async function GET(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const residentId = request.nextUrl.searchParams.get("resident");
  if (!residentId) return NextResponse.json({ error: "Missing resident" }, { status: 400 });

  const supabase = await createClient();

  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("id, resident_name, ResidentID, branch_id")
    .eq("id", residentId)
    .single();
  if (!resident) return NextResponse.json({ error: "Resident not found" }, { status: 404 });
  if (!canAccessAllBranches(account) && resident.branch_id !== account.branch_id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;
  if (excludedBranchIds.includes(resident.branch_id)) {
    return NextResponse.json({ error: "Resident not found" }, { status: 404 });
  }

  const now = new Date();
  const result = await buildStockReport(supabase, resident.id, "OSEM", now);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });
  const { report } = result;

  if (report.orderCount === 0) {
    const { t } = await getServerTranslator();
    return nothingToGenerateResponse(t("Nothing to generate: this resident has no active OSEM-supplied medicine."));
  }

  const branch = await getReportBranchInfo(resident.branch_id);
  const buffer = await renderToBuffer(
    <OsemPurchaseListDocument
      residentName={resident.resident_name}
      generatedOn={formatDate(now.toISOString())}
      lastStockDate={report.lastCountableStockDate ? formatDate(report.lastCountableStockDate) : null}
      restock={report.restock}
      sufficient={report.sufficient}
      uncountable={report.uncountable}
      lowStockDays={LOW_STOCK_DAYS}
      branch={branch}
      logoSrc={getLogoPath()}
    />
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="osem-purchase-list-${resident.ResidentID ?? residentId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
