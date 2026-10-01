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
 * Sent by the OSEMLoRaSync APK (Phase 2B) after reading DEVICES_BEAN.
 * Body: { receiver_id, schema_probe, devices: [{device_num, room_label, user_name, _room_col, _name_col}] }
 *
 * For each device with a non-empty room_label:
 *   - Inserts a cb_assignments row if none exists (resident_id NULL).
 *   - Updates room_label on any existing row, leaving resident_id untouched.
 *
 * The schema_probe is logged to Vercel so we can inspect DEVICES_BEAN
 * column names without shipping a separate diagnostic tool.
 */
export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: {
    receiver_id?: unknown;
    schema_probe?: unknown;
    devices?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }

  const receiverId = Number(body.receiver_id);
  if (!receiverId || isNaN(receiverId)) {
    return NextResponse.json({ ok: false, code: "MISSING_RECEIVER_ID" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Verify receiver exists
  const { data: receiver } = await adminClient
    .from("cb_receivers")
    .select("id")
    .eq("id", receiverId)
    .maybeSingle();

  if (!receiver) {
    return NextResponse.json({ ok: false, code: "RECEIVER_NOT_FOUND" }, { status: 404 });
  }

  // Log schema probe so Vercel logs show DEVICES_BEAN structure
  if (body.schema_probe) {
    console.log(
      `[callbell/devices] schema_probe receiver_id=${receiverId}`,
      JSON.stringify(body.schema_probe)
    );
  }

  const devices = Array.isArray(body.devices) ? body.devices : [];
  let upserted = 0;

  for (const device of devices) {
    const d = device as Record<string, unknown>;
    const deviceNum = String(d.device_num ?? "").trim();
    const roomLabel = String(d.room_label ?? "").trim();

    if (!deviceNum || !roomLabel) continue; // skip devices with no room label

    // Upsert: insert if new, update only room_label if exists.
    // resident_id is NOT included so it is never cleared on conflict.
    const { error } = await adminClient.from("cb_assignments").upsert(
      {
        receiver_id: receiverId,
        device_num: deviceNum,
        room_label: roomLabel,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "receiver_id,device_num" }
    );

    if (!error) upserted++;
  }

  return NextResponse.json({ ok: true, upserted, total: devices.length });
}
