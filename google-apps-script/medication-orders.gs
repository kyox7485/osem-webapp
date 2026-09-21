// ─── Medication Orders Web App ────────────────────────────────────────────────
// Deployed under osemmedicare@gmail.com as a Google Apps Script Web App.
//
// SETUP:
// 1. This file lives in the same Apps Script project as Config.gs, Utils.gs,
//    MedicationSync.gs and MedicationSummary.gs, and reuses their shared
//    CONFIG object and functions instead of duplicating them.
// 2. Deploy → New deployment → Web app.
//      Execute as: Me (osemmedicare@gmail.com)
//      Who has access: Anyone
//    ("Anyone" is required since Next.js calls this over plain HTTPS with no
//    Google login — the SHARED_SECRET check is the actual access control.)
// 3. Copy the /exec URL into MEDICATION_ORDER_SCRIPT_URL in Vercel env vars,
//    and make sure SHARED_SECRET below matches MEDICATION_ORDER_SCRIPT_SECRET.
// 4. Whenever this code changes: Deploy → Manage deployments → edit existing
//    deployment → New version. A plain Ctrl+S does NOT update the /exec URL.
//
// WHY A DIRECT, SYNCHRONOUS CALL (no async trigger):
// Apps Script onEdit/onChange triggers do NOT fire for programmatic writes
// made by this script. MedicationSummary.gs already ships the exact entry
// point bots/APIs are meant to use for that: syncMedicationOrderAndSummaryNow().
// It (1) syncs just this one row to Supabase tbl_medication_orders and
// (2) rebuilds tbl_residents.current_medication_list for the resident(s)
// affected — a handful of HTTP calls, well inside Vercel's function timeout.
// A prior version of this file scheduled a 30s-delayed trigger that called
// the full syncAllMedicationOrdersToSupabase() reconciliation instead; that
// never rebuilt current_medication_list and was slower for no benefit, so it
// was removed in favor of calling the targeted function directly.

const SHARED_SECRET = "k-google-mirror-osem2020";

// Column names exactly as defined in the sheet — do not reorder.
// The script builds a live column map from the sheet's header row, so
// adding extra columns to the sheet later will not break existing writes.
const COLUMNS = [
  "RxOrderID",
  "ResidentID",
  "Dosage Form",
  "Brand Name",
  "Active Ingredient",
  "Dose",
  "Unit",
  "Frequency",
  "Administration Times",
  "Dosing Days",
  "Indication",
  "Instruction",
  "Duration Type",
  "Start Date",
  "End Date",
  "Noted By",
  "Ordered By",
  "Supplied By",
  "Status",
  "PreviousRxOrderID",
];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.secret !== SHARED_SECRET) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }

    if (payload.action === "create") {
      return jsonResponse(createOrder(payload.order));
    }

    if (payload.action === "update") {
      return jsonResponse(updateOrder(payload.rxOrderId, payload.order));
    }

    return jsonResponse({ success: false, error: "Unknown action: " + payload.action });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

// Simple health check — confirms the deployment is live and reachable.
function doGet() {
  return jsonResponse({ ok: true });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Reuses the shared CONFIG (Config.gs) and getMedicationSheet() (Utils.gs) so
// this file can never point at a different spreadsheet/tab name than
// MedicationSync.gs / MedicationSummary.gs do.
function getSheet() {
  return getMedicationSheet(CONFIG.SHEETS.MEDICATION_ORDER);
}

// Maps each header cell to its 0-based column index so writes use the live
// sheet layout rather than hardcoded positions.
function buildColumnMap(headerRow) {
  const map = {};
  for (let i = 0; i < headerRow.length; i++) {
    map[headerRow[i]] = i;
  }
  return map;
}

// Appends a new row. All COLUMNS fields are placed in the correct column
// based on the live header; unmapped payload keys are silently ignored.
// Syncs to Supabase and rebuilds the resident's medication summary before
// returning (see syncOrderAndSummary_ below).
function createOrder(order) {
  const sheet = getSheet();
  if (!sheet) {
    return { success: false, error: "Sheet '" + CONFIG.SHEETS.MEDICATION_ORDER + "' not found in spreadsheet" };
  }

  const lastCol = sheet.getLastColumn();
  const header = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    : [];

  const colMap = buildColumnMap(header);
  const row = new Array(Math.max(header.length, COLUMNS.length)).fill("");

  for (const col of COLUMNS) {
    const idx = colMap[col];
    if (idx !== undefined && order[col] !== undefined && order[col] !== null) {
      row[idx] = order[col];
    }
  }

  sheet.appendRow(row);

  return Object.assign(
    { success: true },
    syncOrderAndSummary_(order["RxOrderID"], order["ResidentID"])
  );
}

// Finds the row whose RxOrderID matches, then updates every field in the
// payload except RxOrderID (immutable) and any key not present in the payload
// (left unchanged). Syncs to Supabase and rebuilds the affected resident's
// medication summary before returning (see syncOrderAndSummary_ below).
function updateOrder(rxOrderId, order) {
  const sheet = getSheet();
  if (!sheet) {
    return { success: false, error: "Sheet '" + CONFIG.SHEETS.MEDICATION_ORDER + "' not found in spreadsheet" };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { success: false, error: "Order not found: " + rxOrderId };
  }

  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = data[0];
  const colMap = buildColumnMap(header);
  const rxCol = colMap["RxOrderID"];

  if (rxCol === undefined) {
    return { success: false, error: "RxOrderID column not found in sheet header" };
  }

  let found = false;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][rxCol]) === String(rxOrderId)) {
      const rowNum = i + 1; // Sheets rows are 1-indexed
      const newRow = data[i].slice(); // copy existing values

      for (const col of COLUMNS) {
        if (col === "RxOrderID") continue; // never overwrite the identifier
        const idx = colMap[col];
        if (idx !== undefined && order[col] !== undefined) {
          // Don't clear PreviousRxOrderID with an empty string — preserve the
          // existing value if the caller didn't supply a non-empty replacement.
          if (col === "PreviousRxOrderID" && order[col] === "") continue;
          newRow[idx] = order[col] !== null ? order[col] : "";
        }
      }

      sheet.getRange(rowNum, 1, 1, newRow.length).setValues([newRow]);
      found = true;
      break;
    }
  }

  if (!found) {
    return { success: false, error: "Order not found: " + rxOrderId };
  }

  return Object.assign(
    { success: true },
    syncOrderAndSummary_(rxOrderId, order["ResidentID"])
  );
}

// ─── Supabase sync + resident summary rebuild ─────────────────────────────────
//
// syncMedicationOrderAndSummaryNow (MedicationSummary.gs, same project) is the
// documented immediate entry point for bots/APIs: it syncs this one row to
// Supabase tbl_medication_orders, then rebuilds tbl_residents.current_medication_list
// (and its Google tbl_ResidentList mirror) for whichever resident(s) it
// affects — the current resident, and the previous one too if ResidentID
// changed on an update.
//
// A failure here does NOT undo the sheet write above — the Google Sheet
// remains the source of truth, and MedicationSync.gs's 24h reconciliation plus
// MedicationSummary.gs's 1-minute heartbeat will retry automatically. We still
// return the error to the caller so Vercel can log/surface it instead of it
// failing silently.
function syncOrderAndSummary_(rxOrderId, residentId) {
  try {
    const result = syncMedicationOrderAndSummaryNow(rxOrderId, residentId);
    return { supabaseSync: result };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(
      "syncOrderAndSummary_ failed for RxOrderID " + rxOrderId + ": " + message
    );
    return { supabaseSync: { success: false, error: message } };
  }
}
