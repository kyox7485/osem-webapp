import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";

/**
 * POST /api/callbell/assign  { receiver_id, device_num, resident_id | null }
 *
 * Sets (or clears) the resident on an existing bell. The bell row itself comes
 * from the receiver inventory (/api/callbell/devices) and is never created or
 * deleted here; the call number (room_label) is never changed here.
 */
export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { receiver_id?: unknown; device_num?: unknown; resident_id?: unknown };
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
  const residentId =
    body.resident_id === null || body.resident_id === undefined || body.resident_id === ""
      ? null
      : Number(body.resident_id);
  if (residentId !== null && (!Number.isInteger(residentId) || residentId <= 0)) {
    return NextResponse.json({ error: "Invalid resident_id" }, { status: 400 });
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

  // The resident must be ACTIVE and belong to the receiver's branch.
  if (residentId !== null) {
    const { data: resident } = await adminClient
      .from("tbl_residents")
      .select("id")
      .eq("id", residentId)
      .eq("branch_id", receiver.branch_id)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (!resident) {
      return NextResponse.json({ error: "Resident is not an active resident of this branch" }, { status: 400 });
    }

    // One bell per resident (also enforced by cb_assignments_resident_unique).
    const { data: taken } = await adminClient
      .from("cb_assignments")
      .select("device_num, room_label")
      .eq("resident_id", residentId)
      .not("device_num", "eq", deviceNum)
      .limit(1)
      .maybeSingle();
    if (taken) {
      return NextResponse.json(
        { error: `Resident is already assigned to bell ${taken.room_label || taken.device_num}` },
        { status: 409 }
      );
    }
  }

  const { data: updated, error } = await adminClient
    .from("cb_assignments")
    .update({ resident_id: residentId, updated_at: new Date().toISOString() })
    .eq("receiver_id", receiverId)
    .eq("device_num", deviceNum)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Device is not in this receiver's inventory" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
