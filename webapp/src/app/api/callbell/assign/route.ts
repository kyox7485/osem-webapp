import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, canAccessAllBranches } from "@/lib/current-user";

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { receiver_id?: unknown; device_num?: unknown; resident_id?: unknown; room_label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { receiver_id, device_num, resident_id, room_label } = body;

  if (!receiver_id || !device_num) {
    return NextResponse.json({ error: "receiver_id and device_num required" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Verify the receiver belongs to a branch the user can access
  const { data: receiver } = await adminClient
    .from("cb_receivers")
    .select("branch_id")
    .eq("id", receiver_id)
    .single();

  if (!receiver) return NextResponse.json({ error: "Receiver not found" }, { status: 404 });

  if (!canAccessAllBranches(account) && receiver.branch_id !== account.branch_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (resident_id === null || resident_id === undefined || resident_id === "") {
    // Unassign: delete the row if it exists
    const { error } = await adminClient
      .from("cb_assignments")
      .delete()
      .eq("receiver_id", receiver_id as number)
      .eq("device_num", device_num as string);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // Assign / reassign
    const { error } = await adminClient
      .from("cb_assignments")
      .upsert(
        {
          receiver_id: receiver_id as number,
          device_num: device_num as string,
          resident_id: resident_id as number,
          room_label: (room_label as string) || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "receiver_id,device_num" }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
