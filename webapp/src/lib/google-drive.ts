// Wound photos are the one place this app stores an actual binary asset
// (everywhere else is structured data in Supabase), and they must live in
// Google Drive, not Supabase Storage. This originally targeted a Google
// Cloud service account + Shared Drive, but OSEM's Drive is a personal
// (non-Workspace) @gmail.com account -- service accounts have zero
// personal storage quota, and Shared Drives (the usual workaround) are a
// Workspace-only feature a personal account can't create. Apps Script
// deployed under that real account sidesteps both problems: it runs with
// the account's own real Drive storage, no Cloud project or Shared Drive
// needed. See google-apps-script/wound-photo-drive.gs for the script this
// module calls, and its own header comment for deployment steps.
//
// Required env vars (server-only, never NEXT_PUBLIC_):
//   GOOGLE_APPS_SCRIPT_URL    -- the deployed Web App's /exec URL
//   GOOGLE_APPS_SCRIPT_SECRET -- shared secret, must match the constant
//     pasted into the Apps Script project (Apps Script Web Apps must
//     allow "Anyone" access to be callable from Next.js at all, so this
//     secret is the actual access control)

export class DriveNotConfiguredError extends Error {
  constructor() {
    super("Google Drive is not configured (missing GOOGLE_APPS_SCRIPT_* env vars) -- wound photo upload is unavailable until this is set up.");
    this.name = "DriveNotConfiguredError";
  }
}

function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_APPS_SCRIPT_URL && process.env.GOOGLE_APPS_SCRIPT_SECRET);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Apps Script Web Apps under a personal (non-Workspace) account intermittently
// return a bare HTTP 404/5xx for an otherwise-valid request -- observed in
// testing to flip between failing and succeeding on the exact same URL
// seconds apart, consistent with the lower per-account quotas/instability
// a consumer account gets versus Workspace. A short retry absorbs these
// transient blips instead of surfacing them to the user as a failed upload.
async function callAppsScript(payload: Record<string, unknown>, attempt = 1): Promise<any> {
  if (!isConfigured()) throw new DriveNotConfiguredError();

  const res = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret: process.env.GOOGLE_APPS_SCRIPT_SECRET }),
    redirect: "follow", // Apps Script Web App URLs 302 once to the actual execution URL
  });

  if (!res.ok) {
    if (attempt < 3) {
      await sleep(500 * attempt);
      return callAppsScript(payload, attempt + 1);
    }
    throw new Error(`Apps Script HTTP ${res.status}`);
  }

  const json = await res.json();
  // Apps Script's ContentService always returns HTTP 200 for a completed
  // execution -- failures are only visible via this `success` field, not
  // the status code.
  if (!json.success) throw new Error(json.error || "Apps Script request failed");
  return json;
}

export type UploadedWoundPhoto = { driveFileId: string; driveFolderId: string };

// OSEM Clinical Photos / {ResidentID} - {ResidentName} ({BranchCode}) / {YYYY-MM-DD}
// ResidentID leads the resident folder name so it stays unambiguous even
// if two residents share a name; folder creation happens entirely inside
// the Apps Script call (find-or-create each level).
//
// Resolving that chain is 2 sequential Drive API calls (originally 4, with
// a separate branch level and a year level -- flattened since each level
// is real, measurable latency: a single upload was clocked taking several
// seconds even when every folder already existed). Every photo after the
// first one in a session lands in the exact same day folder, so
// `knownFolderId` lets the caller skip resolution entirely: pass the
// folder id a previous upload in this session already returned, and Apps
// Script uses it directly.
export async function uploadWoundPhotoToDrive(params: {
  branchCode: string;
  residentId: number;
  residentName: string;
  date: Date;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  knownFolderId?: string;
}): Promise<UploadedWoundPhoto> {
  const json = await callAppsScript({
    action: "upload",
    folderId: params.knownFolderId,
    branchCode: params.branchCode,
    residentId: params.residentId,
    residentName: params.residentName,
    isoDate: params.date.toISOString().slice(0, 10),
    fileName: params.fileName,
    mimeType: params.mimeType,
    fileBase64: params.buffer.toString("base64"),
  });
  return { driveFileId: json.fileId, driveFolderId: json.folderId };
}

// Used by the /api/wound-photos/[id] proxy route -- photos are never
// served via a public/"anyone with the link" Drive URL. The route applies
// this app's own branch/auth check first, then fetches the bytes through
// this call, so access control stays consistent with the rest of the app
// instead of depending on Drive sharing settings. Apps Script has no true
// streaming response, so the whole file comes back as one base64 payload
// -- fine at wound-photo sizes (compressed to ~1600px/JPEG client-side
// before upload), not suitable for very large files.
export async function readWoundPhotoFromDrive(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const json = await callAppsScript({ action: "read", fileId });
  return { buffer: Buffer.from(json.fileBase64, "base64"), mimeType: json.mimeType };
}

export { isConfigured as isDriveConfigured };
