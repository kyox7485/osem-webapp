import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function checkSecret(req: NextRequest): boolean {
  const secret = process.env.CALLBELL_API_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * POST /api/callbell/devices
 *
 * Device inventory from the OSEMLoRaSync APK, read from the Wenze receiver's
 * own /manager/getalldevices API (the source of truth for which bells exist).
 * Body: { receiver_id, complete: true, devices: [{ device_num, call_number, nick_name }] }
 *
 * cb_assignments holds one row per paired bell:
 *   - room_label  = receiver NAME (call number) — always overwritten from the receiver
 *   - resident_id = OSEM assignment — never touched here
 * When the list is complete, rows for bells no longer paired on the receiver are removed.
 */
export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: { receiver_id?: unknown; complete?: unknown; devices?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }

  const receiverId = Number(body.receiver_id);
  if (!receiverId || isNaN(receiverId)) {
    return NextResponse.json({ ok: false, code: "MISSING_RECEIVER_ID" }, { status: 400 });
  }
  if (!Array.isArray(body.devices)) {
    return NextResponse.json({ ok: false, code: "MISSING_DEVICES" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: receiver } = await adminClient
    .from("cb_receivers")
    .select("id")
    .eq("id", receiverId)
    .maybeSingle();
  if (!receiver) {
    return NextResponse.json({ ok: false, code: "RECEIVER_NOT_FOUND" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const byNum = new Map<string, { receiver_id: number; device_num: string; room_label: string | null; updated_at: string }>();
  for (const device of body.devices) {
    const d = device as Record<string, unknown>;
    const deviceNum = String(d.device_num ?? "").trim().toUpperCase();
    if (!deviceNum) continue;
    const callNumber = String(d.call_number ?? "").trim();
    byNum.set(deviceNum, { receiver_id: receiverId, device_num: deviceNum, room_label: callNumber || null, updated_at: now });
  }
  const rows = [...byNum.values()];

  if (rows.length > 0) {
    // resident_id is omitted, so existing assignments survive the upsert.
    const { error } = await adminClient
      .from("cb_assignments")
      .upsert(rows, { onConflict: "receiver_id,device_num" });
    if (error) {
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: error.message }, { status: 500 });
    }
  }

  // Remove bells that are no longer paired on the receiver. Guarded by
  // `complete` + a non-empty list so a failed/partial read never wipes inventory.
  let removed = 0;
  if (body.complete === true && rows.length > 0) {
    const { data: existing } = await adminClient
      .from("cb_assignments")
      .select("id, device_num")
      .eq("receiver_id", receiverId);
    const stale = (existing ?? []).filter((r) => !byNum.has(String(r.device_num).toUpperCase())).map((r) => r.id);
    if (stale.length > 0) {
      const { error } = await adminClient.from("cb_assignments").delete().in("id", stale);
      if (!error) removed = stale.length;
    }
  }

  return NextResponse.json({ ok: true, upserted: rows.length, removed });
}
