import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { callInventoryRpc } from "@/lib/inventory/rpc";
import { buildChargesCsv, exportFileName } from "@/lib/inventory/csv";

// Charge export download (docs/inventory-design.md §7.3, D-122, D-163).
// Server-only: the user's own Supabase session calls inv_export_charges (the
// RPC checks the MODERATOR tier and the branch scope, and records the export);
// this route only turns the returned rows into a CSV. The client sends one
// idempotency key per download attempt, so a failed download can be retried
// with the same key and gets the same rows back instead of an empty delta.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function fail(code: string, status: number, data?: unknown) {
  return NextResponse.json({ ok: false, code, data: data ?? null }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const account = await getCurrentUser();
  if (!account) return fail("NOT_AUTHENTICATED", 401);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fail("INVALID_PAYLOAD", 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("INVALID_PAYLOAD", 400);
  }
  const { branch_id, period, layout, full, key } = body;
  if (
    !Number.isInteger(branch_id) ||
    typeof period !== "string" ||
    !PERIOD_RE.test(period) ||
    (layout !== "ITEMISED" && layout !== "SUMMARY") ||
    (full !== undefined && typeof full !== "boolean") ||
    typeof key !== "string" ||
    !UUID_RE.test(key)
  ) {
    return fail("INVALID_PAYLOAD", 400);
  }

  const result = await callInventoryRpc("inv_export_charges", { branch_id, period, layout, full: full === true }, key);
  if (!result.ok) {
    const status = result.code === "FORBIDDEN" ? 403 : result.code === "RPC_ERROR" ? 500 : 422;
    return fail(result.code, status, result.data);
  }

  const data = result.data ?? {};
  const rows = Array.isArray(data.rows) ? (data.rows as Record<string, unknown>[]) : [];
  const columns = Array.isArray(data.columns) ? (data.columns as string[]) : [];
  const periodLocked = data.period_locked === true;
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, empty: true, period_locked: periodLocked }, { headers: { "Cache-Control": "no-store" } });
  }

  const csv = buildChargesCsv(columns, rows);
  const fileName = exportFileName(String(data.export_no ?? "export"), period, layout, full === true);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Rows": String(rows.length),
      "X-Export-Locked": periodLocked ? "1" : "0",
    },
  });
}
