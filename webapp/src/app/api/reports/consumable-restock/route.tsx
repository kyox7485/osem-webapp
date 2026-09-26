import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";
import { getDemoBranchIds } from "@/lib/lookups";
import { getReportBranchInfo } from "@/lib/pdf/branch-info";
import { getLogoPath } from "@/lib/pdf/logo-path";
import { registerCjkFont } from "@/lib/pdf/cjk-font";
import { ConsumableFamilyReminderDocument } from "@/lib/pdf/documents/consumable-family-reminder-document";
import { ConsumablePickupListDocument } from "@/lib/pdf/documents/consumable-pickup-list-document";
import { formatDate } from "@/lib/format-date";
import { resolveBranchStaff } from "@/lib/consumables-server";
import { groupRestockRows, isSupplier, type RestockRow } from "@/lib/consumables";

export const runtime = "nodejs";

// Consumables Restock PDFs (Residents → Consumables → Restock). POSTed like
// the medication purchase list: the rows arrive reviewed/edited by the user,
// so the PDF prints exactly what was approved. Resident names are re-read from
// the DB. Rendered in memory and streamed — never stored.
//   audience "Family" → bilingual reminder for ONE resident
//   audience "OSEM"   → internal pick-up list (whole branch or one resident)

const MAX_ROWS = 2000;
const MAX_TEXT = 100;

type IncomingRow = {
  residentId?: unknown;
  item?: unknown;
  unit?: unknown;
  currentStock?: unknown;
  lastCount?: unknown;
  suggestedQty?: unknown;
  addedManually?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
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
  if (!account) return bad("Not authenticated", 401);

  let body: { audience?: unknown; branchId?: unknown; residentId?: unknown; preparedBy?: unknown; rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request body");
  }

  if (!isSupplier(body.audience)) return bad("Invalid PDF type");
  const audience = body.audience;

  const branchId = Number(body.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0) return bad("Missing or invalid branch");
  const scopeResidentId = body.residentId === null || body.residentId === undefined ? null : Number(body.residentId);
  if (audience === "Family" && (scopeResidentId === null || !Number.isInteger(scopeResidentId)))
    return bad("Select a resident for the family reminder");

  if (!Array.isArray(body.rows) || body.rows.length === 0) return bad("There is nothing to generate.");
  if (body.rows.length > MAX_ROWS) return bad("Too many rows");
  const incoming = body.rows as IncomingRow[];

  if (!canAccessAllBranches(account) && branchId !== account.branch_id) return bad("Access denied", 403);
  const demoBranchIds = await getDemoBranchIds();
  const isDemoUser = demoBranchIds.includes(account.branch_id);
  if (!isDemoUser && demoBranchIds.includes(branchId)) return bad("Branch not found", 404);

  const supabase = await createClient();

  const staff = await resolveBranchStaff(supabase, str(body.preparedBy), branchId);
  if (!staff) return bad("Select the staff member who prepared this list");

  // Every row must belong to a resident of this branch (and to the chosen
  // resident, when one is set). Names come from the DB, never the client.
  const residentIds = incoming.map((r) => num(r.residentId));
  if (residentIds.some((id) => id === null)) return bad("Every item must belong to a resident");
  const uniqueIds = [...new Set(residentIds as number[])];
  if (scopeResidentId !== null && uniqueIds.some((id) => id !== scopeResidentId)) return bad("Items belong to another resident");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: residentsRaw, error } = await (supabase as any)
    .from("tbl_residents")
    .select("id, resident_name, ResidentID, branch_id")
    .in("id", uniqueIds);
  if (error) return bad(error.message, 500);
  const residents = new Map<number, { resident_name: string; ResidentID: string | null; branch_id: number }>();
  for (const r of (residentsRaw ?? []) as { id: number; resident_name: string; ResidentID: string | null; branch_id: number }[]) {
    residents.set(r.id, r);
  }
  for (const id of uniqueIds) {
    const r = residents.get(id);
    if (!r || r.branch_id !== branchId) return bad("Resident not found", 404);
  }

  const rows: RestockRow[] = incoming.map((r, i) => ({
    key: `row:${i}`,
    residentId: residentIds[i] as number,
    consumableId: "",
    item: str(r.item) || "—",
    unit: str(r.unit) || "Unit",
    supplier: audience,
    currentStock: num(r.currentStock),
    lastCount: str(r.lastCount) || null,
    suggestedQty: Math.max(0, num(r.suggestedQty) ?? 0),
    addedManually: r.addedManually === true,
  }));

  const groups = groupRestockRows(rows, (id) => {
    const r = residents.get(id)!;
    return { name: r.resident_name, textId: r.ResidentID };
  });

  const now = new Date();
  const branch = await getReportBranchInfo(branchId);
  const common = {
    generatedOn: formatDate(now.toISOString()),
    preparedBy: staff.name,
    branch,
    logoSrc: getLogoPath(),
  };

  let buffer: Buffer;
  let filename: string;
  if (audience === "Family") {
    registerCjkFont();
    const g = groups[0];
    buffer = await renderToBuffer(<ConsumableFamilyReminderDocument residentName={g.residentName} rows={g.rows} {...common} />);
    filename = `consumable-reminder-${g.residentTextId ?? g.residentId}.pdf`;
  } else {
    buffer = await renderToBuffer(<ConsumablePickupListDocument groups={groups} {...common} />);
    filename = `consumable-pickup-list-${branch.branchName.replace(/[^\w-]+/g, "-").toLowerCase()}.pdf`;
  }

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
