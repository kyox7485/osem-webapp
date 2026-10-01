import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";

/**
 * POST /api/callbell/disarm
 *   { receiver_id, device_num, minutes, reason? }  → disarm a bell for `minutes`
 *   { receiver_id, device_num, rearm: true }       → end any active disarm now
 *
 * A disarmed bell still logs every call; the receiver APK withdraws the
 * call immediately so the receiver stops announcing it. MODERATOR/ADMIN only.
 */
const MAX_MINUTES = 7 * 24 * 60;

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (account.rights !== "ADMIN" && account.rights !== "MODERATOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { receiver_id?: unknown; device_num?: unknown; minutes?: unknown; reason?: unknown; rearm?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const receiverId = Number(body.receiver_id);
  const deviceNum = typeof body.device_num === "string" ? body.device_num.trim() : "";
  if (!receiverId || !deviceNum) {
    return NextResponse.json({ error: "receiver_id and device_num required" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: receiver } = await adminClient
    .from("cb_receivers")
    .select("branch_id")
    .eq("id", receiverId)
    .maybeSingle();
  if (!receiver) return NextResponse.json({ error: "Receiver not found" }, { status: 404 });
  if (!canAccessAllBranches(account) && receiver.branch_id !== account.branch_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: bell } = await adminClient
    .from("cb_assignments")
    .select("id")
    .eq("receiver_id", receiverId)
    .eq("device_num", deviceNum)
    .maybeSingle();
  if (!bell) return NextResponse.json({ error: "Device is not in this receiver's inventory" }, { status: 404 });

  const now = new Date().toISOString();

  // End any disarm still running for this bell (re-arm, or before a new one).
  const { error: endError } = await adminClient
    .from("cb_disarm_events")
    .update({ disarm_end: now })
    .eq("receiver_id", receiverId)
    .eq("device_num", deviceNum)
    .gt("disarm_end", now);
  if (endError) return NextResponse.json({ error: endError.message }, { status: 500 });

  if (body.rearm === true) return NextResponse.json({ ok: true });

  const minutes = Number(body.minutes);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_MINUTES) {
    return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";

  const { error } = await adminClient.from("cb_disarm_events").insert({
    receiver_id: receiverId,
    device_num: deviceNum,
    disarm_start: now,
    disarm_end: new Date(Date.now() + minutes * 60_000).toISOString(),
    reason: reason || null,
    authorized_by: account.username,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
