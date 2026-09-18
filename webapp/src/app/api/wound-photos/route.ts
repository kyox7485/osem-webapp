import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/current-user";
import { uploadWoundPhotoToDrive, DriveNotConfiguredError } from "@/lib/google-drive";

// Binary upload endpoint -- deliberately a Route Handler taking multipart
// FormData rather than a "use server" action, since a compressed photo can
// exceed the ~1MB default body-size limit Next.js applies to Server Action
// payloads. Handles two distinct failure modes so the client can retry
// without ever re-uploading an image that already made it to Drive:
//
//   1. file present, no driveFileId  -> upload to Drive, then insert the
//      Supabase record. If Drive succeeds but the Supabase insert fails,
//      the response still carries driveFileId/driveFolderId so the client
//      can retry as case 2 below instead of re-uploading.
//   2. driveFileId + driveFolderId present, no file -> skip Drive
//      entirely, just (re)try the Supabase insert.
//
// A session is only ever created once Drive has confirmed the upload
// succeeded (or the caller already has a driveFileId from a prior
// attempt) -- never before -- so a failed first photo never leaves behind
// an empty, photo-less session row.
export async function POST(req: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });

  const form = await req.formData();
  const residentId = Number(form.get("residentId"));
  // Deliberately optional here -- staff pick "Uploaded by" once at Finish
  // Session, not before every photo. finishWoundSession() backfills it
  // onto every photo in the session afterward.
  const uploadedBy = form.get("uploadedBy") ? String(form.get("uploadedBy")) : null;
  const bodyPartId = form.get("bodyPartId") ? Number(form.get("bodyPartId")) : null;
  const bodyPartLabel = String(form.get("bodyPartLabel") || "");
  const description = form.get("description") ? String(form.get("description")) : null;
  const existingSessionId = form.get("sessionId") ? Number(form.get("sessionId")) : null;
  const existingDriveFileId = form.get("driveFileId") ? String(form.get("driveFileId")) : null;
  const existingDriveFolderId = form.get("driveFolderId") ? String(form.get("driveFolderId")) : null;
  const existingFileName = form.get("fileName") ? String(form.get("fileName")) : null;
  const existingMimeType = form.get("mimeType") ? String(form.get("mimeType")) : null;
  const file = form.get("file") as File | null;

  if (!residentId || !bodyPartLabel) {
    return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: resident } = await supabase
    .from("tbl_residents")
    .select("id, resident_name, branch_id, tbl_branches!branch_id(BranchName, BranchCode)")
    .eq("id", residentId)
    .single();

  if (!resident) return NextResponse.json({ success: false, error: "Resident not found" }, { status: 404 });
  if (account.rights !== "ADMIN" && resident.branch_id !== account.branch_id) {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
  }

  const branch = Array.isArray(resident.tbl_branches) ? resident.tbl_branches[0] : resident.tbl_branches;

  let driveFileId = existingDriveFileId;
  let driveFolderId = existingDriveFolderId;
  let fileName = existingFileName;
  let mimeType = existingMimeType;
  let fileSizeBytes: number | null = null;

  if (!driveFileId) {
    if (!file) return NextResponse.json({ success: false, error: "No photo file provided" }, { status: 400 });

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
      fileName = `${ts}_${bodyPartLabel.replace(/[^a-z0-9]+/gi, "")}.jpg`;
      mimeType = file.type || "image/jpeg";
      fileSizeBytes = buffer.length;

      const uploaded = await uploadWoundPhotoToDrive({
        branchCode: branch?.BranchCode || "UNKNOWN",
        branchName: branch?.BranchName || "Unknown Branch",
        residentId: resident.id,
        residentName: resident.resident_name,
        date: new Date(),
        fileName,
        mimeType,
        buffer,
      });
      driveFileId = uploaded.driveFileId;
      driveFolderId = uploaded.driveFolderId;
    } catch (err) {
      const message = err instanceof DriveNotConfiguredError ? err.message : "Failed to upload photo to Google Drive";
      console.error("Wound photo Drive upload failed:", err);
      return NextResponse.json({ success: false, error: message, stage: "drive" }, { status: 502 });
    }
  }

  try {
    let sessionId = existingSessionId;
    if (!sessionId) {
      const { data: session, error: sessionError } = await supabase
        .from("tbl_wound_sessions")
        .insert({ resident_id: resident.id, branch_id: resident.branch_id, uploaded_by: uploadedBy })
        .select("id")
        .single();
      if (sessionError || !session) throw sessionError || new Error("Failed to create wound session");
      sessionId = session.id;
    }

    const { data: photo, error: photoError } = await supabase
      .from("tbl_wound_photos")
      .insert({
        session_id: sessionId,
        body_part_id: bodyPartId,
        body_part_label: bodyPartLabel,
        description,
        drive_file_id: driveFileId,
        drive_folder_id: driveFolderId,
        file_name: fileName,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        uploaded_by: uploadedBy,
      })
      .select("id")
      .single();
    if (photoError || !photo) throw photoError || new Error("Failed to save photo record");

    return NextResponse.json({ success: true, sessionId, photoId: photo.id });
  } catch (err) {
    // Drive already has the file at this point -- surface the Drive ids so
    // the client's retry skips re-uploading and only retries this insert.
    console.error("Wound photo metadata save failed after successful Drive upload:", {
      err,
      driveFileId,
      driveFolderId,
      residentId,
    });
    return NextResponse.json(
      {
        success: false,
        error: "Photo uploaded but could not be saved -- retry to finish saving it",
        stage: "db",
        driveFileId,
        driveFolderId,
        fileName,
        mimeType,
      },
      { status: 500 }
    );
  }
}
