import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { getServerTranslator } from "@/lib/i18n/server";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import { PurchaseListDocument } from "@/lib/pdf/documents/purchase-list-document";
import { formatDate } from "@/lib/format-date";
import { LOW_STOCK_DAYS } from "@/lib/medication-stock";
import { groupPurchaseRows, summarize, type PurchaseListRow } from "@/lib/medication-purchase";
import { nothingToGenerateResponse } from "@/lib/medication-stock-report";

export const runtime = "nodejs";

// Medication Purchase List PDF (internal, branch-wide). Unlike the other
// report routes this one is POSTed: the rows arrive already reviewed and
// edited by the user, so the PDF must show exactly what was approved rather
// than re-reading the database. Nothing is stored — rendered in memory and
// streamed, same as every other report.

const MAX_ROWS = 2000;
const MAX_TEXT = 200;

type IncomingRow = {
  key?: unknown;
  residentId?: unknown;
  medicine?: unknown;
  schedule?: unknown;
  unit?: unknown;
  balance?: unknown;
  daysRemaining?: unknown;
  countable?: unknown;
  suggestedQty?: unknown;
  reason?: unknown;
  addedManually?: unknown;
};

function str(v: unknown, fallback = ""): string {
  if (typeof v !== "string") return fallback;
  return v.trim().slice(0, MAX_TEXT);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { branchId?: unknown; preparedBy?: unknown; rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request body");
  }

  const branchId = Number(body.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0) return bad("Missing or invalid branch");

  if (!Array.isArray(body.rows)) return bad("Missing rows");
  if (body.rows.length > MAX_ROWS) return bad("Too many rows");
  const incoming = body.rows as IncomingRow[];

  // Prepared By is required — the list must be attributable to a real person.
  // It must be a tbl_staff.StaffID, never free text (see CLAUDE.md: accounts
  // are not staff).
  const preparedBy = str(body.preparedBy);
  if (!preparedBy) return bad("Select the staff member who prepared this list");

  if (!canAccessAllBranches(account) && branchId !== account.branch_id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  const excludedBranchIds = isDemoUser ? [] : demoBranchIds;
  if (excludedBranchIds.includes(branchId)) {
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  }

  // ── Validate every row names a resident ─────────────────────────────────────
  // A line must always belong to exactly one resident, so the PDF can never
  // contain an unassigned item.
  const residentIds = incoming.map((r) => num(r.residentId));
  if (residentIds.some((id) => id === null)) return bad("Every item must be assigned to a resident");

  // Names come from the DB, not the client, so the grouping can't be spoofed.
  const supabase = await createClient();

  // ── Resolve the preparing staff member ─────────────────────────────────────
  // Accepts the branch's own staff or HQ staff, matching the Stock screen's
  // "Registered By" picker. The name is read from tbl_staff, never trusted.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: hqBranches } = await (supabase as any)
    .from("tbl_branches")
    .select("BranchID")
    .eq("Function", "HQ");
  const allowedStaffBranchIds = [
    branchId,
    ...((hqBranches ?? []) as { BranchID: number }[]).map((b) => b.BranchID),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staffRaw } = await (supabase as any)
    .from("tbl_staff")
    .select("staff_name, StaffID, branch_id")
    .eq("StaffID", preparedBy)
    .eq("status", "ACTIVE")
    .maybeSingle();
  const staff = (staffRaw ?? null) as { staff_name: string; StaffID: string; branch_id: number } | null;
  if (!staff || !allowedStaffBranchIds.includes(staff.branch_id)) {
    return bad("Select the staff member who prepared this list");
  }

  const uniqueIds = [...new Set(residentIds as number[])];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: residentsRaw, error: residentsError } = await (supabase as any)
    .from("tbl_residents")
    .select("id, resident_name, ResidentID, branch_id")
    .in("id", uniqueIds);
  if (residentsError) return NextResponse.json({ error: residentsError.message }, { status: 500 });

  const residentById = new Map<number, { resident_name: string; ResidentID: string | null; branch_id: number }>();
  for (const r of (residentsRaw ?? []) as { id: number; resident_name: string; ResidentID: string | null; branch_id: number }[]) {
    residentById.set(r.id, r);
  }
  // A resident from another branch (or a deleted one) must not appear here.
  for (const id of uniqueIds) {
    const r = residentById.get(id);
    if (!r) return NextResponse.json({ error: "Resident not found" }, { status: 404 });
    if (excludedBranchIds.includes(r.branch_id)) {
      return NextResponse.json({ error: "Resident not found" }, { status: 404 });
    }
  }

  const rows: PurchaseListRow[] = incoming.map((r, i) => {
    const residentId = residentIds[i] as number;
    const resident = residentById.get(residentId)!;
    const countable = r.countable === true;
    return {
      key: str(r.key) || `row:${i}`,
      residentId,
      residentName: resident.resident_name,
      residentTextId: resident.ResidentID,
      medicine: str(r.medicine) || "—",
      schedule: str(r.schedule),
      unit: str(r.unit, "Unit") || "Unit",
      balance: num(r.balance),
      dailyUsage: null, // display only; not printed
      daysRemaining: num(r.daysRemaining),
      countable,
      // A quantity is the whole point of the sheet — never emit a blank one.
      suggestedQty: Math.max(0, num(r.suggestedQty) ?? 0),
      reason: str(r.reason),
      addedManually: r.addedManually === true,
    };
  });

  const groups = groupPurchaseRows(rows);
  const totals = summarize(groups);

  if (totals.totalItems === 0) {
    const { t } = await getServerTranslator();
    return nothingToGenerateResponse(t("Nothing to generate: there are no items to order."));
  }

  const branch = await getReportBranchInfo(branchId);
  const now = new Date();
  const buffer = await renderToBuffer(
    <PurchaseListDocument
      groups={groups}
      totalItems={totals.totalItems}
      residentCount={totals.residentCount}
      lowStockDays={LOW_STOCK_DAYS}
      generatedOn={formatDate(now.toISOString())}
      preparedBy={staff.staff_name}
      branch={branch}
      logoSrc={getLogoPath()}
    />
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="medication-purchase-list-${branch.branchName.replace(/[^\w-]+/g, "-").toLowerCase()}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
