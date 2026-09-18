// Deploy this as a Google Apps Script Web App under osemmedicare@gmail.com --
// see the deployment steps in the PR/chat notes. It is the entire Drive
// integration layer for the Wound Photo module: the Next.js app posts to
// this script's Web App URL for both saving a new photo and reading one
// back for display, since a personal (non-Workspace) Google account has no
// Shared Drive to point a service account at -- running as the real
// account under Apps Script is the workaround, using that account's own
// real Drive storage.
//
// SETUP:
// 1. https://script.google.com -> New project (while signed in as
//    osemmedicare@gmail.com).
// 2. Paste this file's contents in as Code.gs.
// 3. Replace SHARED_SECRET below with the value the webapp's
//    GOOGLE_APPS_SCRIPT_SECRET env var is set to (ask the developer for it
//    -- it must match exactly on both sides).
// 4. Deploy -> New deployment -> type "Web app".
//      Execute as: Me (osemmedicare@gmail.com)
//      Who has access: Anyone
//    ("Anyone" is required since Next.js calls this over plain HTTPS with
//    no Google login of its own -- the SHARED_SECRET check below is what
//    keeps this endpoint from being usable by anyone else who finds the
//    URL.)
// 5. Copy the resulting Web App URL (ends in /exec) into the webapp's
//    GOOGLE_APPS_SCRIPT_URL env var.
// 6. Whenever this script's code is edited, Deploy -> Manage deployments
//    -> edit the existing deployment -> New version, so the /exec URL
//    picks up the change (a plain save does not).

const ROOT_FOLDER_ID = "1aHAjVw9aRWdBaFR5uHO0Y1KIMFodXpZD"; // "OSEM Clinical Photos"
const SHARED_SECRET = "REPLACE_WITH_SHARED_SECRET";

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: "Invalid JSON body" });
  }

  if (body.secret !== SHARED_SECRET) {
    return jsonResponse({ success: false, error: "Unauthorized" });
  }

  try {
    if (body.action === "upload") return handleUpload(body);
    if (body.action === "read") return handleRead(body);
    if (body.action === "delete") return handleDelete(body);
    return jsonResponse({ success: false, error: "Unknown action: " + body.action });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

// Drive has no unique-name constraint, so every level is find-or-create by
// exact name under its parent.
function findOrCreateFolder(name, parentFolder) {
  const existing = parentFolder.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parentFolder.createFolder(name);
}

// OSEM Clinical Photos / {ResidentID} - {ResidentName} ({BranchCode}) / {YYYY-MM-DD}
//
// Originally a 4-level Branch/Resident/Year/Date chain; flattened to 2
// levels (branch folded into the resident folder's name, year dropped)
// since each level is a sequential DriveApp lookup -- a real API call
// each -- and was measured taking several seconds total even when every
// folder already existed. If the caller already knows the target folder
// (every photo after the first one in a session shares the same day
// folder), it passes `folderId` and this skips resolution entirely.
function handleUpload(body) {
  const targetFolder = body.folderId ? DriveApp.getFolderById(body.folderId) : resolveDateFolder(body);

  const bytes = Utilities.base64Decode(body.fileBase64);
  const blob = Utilities.newBlob(bytes, body.mimeType || "image/jpeg", body.fileName || "photo.jpg");
  const file = targetFolder.createFile(blob);

  return jsonResponse({ success: true, fileId: file.getId(), folderId: targetFolder.getId() });
}

function resolveDateFolder(body) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const residentFolder = findOrCreateFolder(body.residentId + " - " + body.residentName + " (" + body.branchCode + ")", root);
  return findOrCreateFolder(body.isoDate, residentFolder);
}

// Trashes rather than permanently deletes -- lets a staff mistake (or a bug
// on the Next.js side) be recovered from Drive's trash instead of being
// unrecoverable, same safety margin Drive gives for any manual delete.
function handleDelete(body) {
  const file = DriveApp.getFileById(body.fileId);
  file.setTrashed(true);
  return jsonResponse({ success: true });
}

function handleRead(body) {
  const file = DriveApp.getFileById(body.fileId);
  const blob = file.getBlob();
  return jsonResponse({
    success: true,
    mimeType: blob.getContentType(),
    fileBase64: Utilities.base64Encode(blob.getBytes()),
  });
}

// Apps Script's ContentService can't set a custom HTTP status code (it's
// always 200 for a successful script execution) -- callers must check the
// `success` field in the body instead of the HTTP status.
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
