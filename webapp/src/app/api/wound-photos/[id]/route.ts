import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { readWoundPhotoFromDrive, deleteWoundPhotoFromDrive } from "@/lib/google-drive";

// Photos are never served from a public/"anyone with the link" Drive URL.
// This route re-checks the viewer's branch access the same way every other
// clinical record in this app does, then fetches the bytes through the
// Apps Script Drive integration -- so a wound photo's access control
// matches the rest of the app instead of depending on Drive sharing
// settings.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("tbl_wound_photos")
    .select("drive_file_id, branch_id, mime_type")
    .eq("id", Number(id))
    .single();

  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (account.rights !== "ADMIN" && photo.branch_id !== account.branch_id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const { buffer, mimeType } = await readWoundPhotoFromDrive(photo.drive_file_id);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": mimeType || photo.mime_type || "image/jpeg", "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    console.error(`Failed to fetch wound photo ${id} (drive file ${photo.drive_file_id}):`, err);
    return NextResponse.json({ error: "Failed to load photo from Drive" }, { status: 502 });
  }
}

// Lets staff remove a mis-filed or duplicate shot while a session is still
// in progress. Deliberately refuses once the parent session has
// completed_at set -- a finished session is a permanent clinical record,
// same reasoning as body_part_label being frozen rather than re-derived on
// tbl_wound_photos (see migration/scripts/add_wound_photo_tables.py).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("tbl_wound_photos")
    .select("drive_file_id, branch_id, session_id, tbl_wound_sessions!session_id(completed_at)")
    .eq("id", Number(id))
    .single();

  if (!photo) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  if (account.rights !== "ADMIN" && photo.branch_id !== account.branch_id) {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
  }

  const session = Array.isArray(photo.tbl_wound_sessions) ? photo.tbl_wound_sessions[0] : photo.tbl_wound_sessions;
  if (session?.completed_at) {
    return NextResponse.json({ success: false, error: "This session is already finished -- photos can no longer be removed" }, { status: 409 });
  }

  try {
    await deleteWoundPhotoFromDrive(photo.drive_file_id);
  } catch (err) {
    console.error(`Failed to trash Drive file for wound photo ${id} (drive file ${photo.drive_file_id}):`, err);
    return NextResponse.json({ success: false, error: "Failed to remove photo from Google Drive" }, { status: 502 });
  }

  const { error: deleteError } = await supabase.from("tbl_wound_photos").delete().eq("id", Number(id));
  if (deleteError) {
    console.error(`Drive file trashed but DB delete failed for wound photo ${id}:`, deleteError);
    return NextResponse.json({ success: false, error: "Removed from Drive but failed to remove the record -- please retry" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
