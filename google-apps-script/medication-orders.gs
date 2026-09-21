// ─── Medication Orders (create/update) ────────────────────────────────────────
// Deployed as part of the same Apps Script project/Web App as Code.gs, under
// osemmedicare@gmail.com.
//
// IMPORTANT: this file does NOT define doPost/doGet. Code.gs is the single
// entry point for the whole project's Web App — its doPost() routes
// action:"create"/"update" here (createOrder/updateOrder), gated by
// SHARED_SECRET below. A previous version of this file defined its own
// doPost/doGet, which silently collided with Code.gs's doPost/doGet (Apps
// Script only allows one global function of a given name per project — the
// last file evaluated wins, discarding the other's routes entirely). That
// caused intermittent failures depending on load order: sometimes Code.gs's
// dispatcher won and rejected "create"/"update" as an unknown action,
// sometimes this file's won and Code.gs's MedicationByResident/VitalUpdates
// GET consumers broke instead. Never redefine doPost/doGet here again.
//
// SETUP:
// 1. This file lives in the same Apps Script project as Config.gs, Utils.gs,
//    MedicationSync.gs and MedicationSummary.gs, and reuses their shared
//    CONFIG object and functions instead of duplicating them.
// 2. Make sure SHARED_SECRET below matches MEDICATION_ORDER_SCRIPT_SECRET in
//    Vercel env vars.
// 3. Whenever this code changes: Deploy → Manage deployments → edit existing
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
  "Noted By StaffID",
  "Ordered By",
  "Supplied By",
  "Status",
  "PreviousRxOrderID",
];

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
// remains the source of truth. Retries a couple of times inline first (most
// failures at this point are transient Supabase/network blips), then leaves
// the row for the two automatic safety nets to pick up:
//   - MedicationSummary.gs's 1-minute heartbeat (medicationSummaryHeartbeat)
//   - MedicationSync.gs's 24-hour reconciliation (syncAllMedicationOrdersToSupabase)
// Both re-run the same underlying sync, so a row that fails here is retried
// automatically without any human action — PROVIDED those triggers are
// actually installed. If they are not, run setupMedicationSummaryTrigger()
// and setupMedicationReconciliationTrigger() once each (Apps Script editor,
// or the Triggers/clock-icon page to confirm they exist) — those two
// triggers are what actually makes "sync must not fail" true; this function
// is only the fast path.
function syncOrderAndSummary_(rxOrderId, residentId) {
  const MAX_ATTEMPTS = 2;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = syncMedicationOrderAndSummaryNow(rxOrderId, residentId);
      return { supabaseSync: result };
    } catch (err) {
      lastError = err;
      const message = err && err.message ? err.message : String(err);
      console.error(
        "syncOrderAndSummary_ attempt " + attempt + "/" + MAX_ATTEMPTS +
        " failed for RxOrderID " + rxOrderId + ": " + message
      );
      if (attempt < MAX_ATTEMPTS) {
        Utilities.sleep(800);
      }
    }
  }

  const message = lastError && lastError.message ? lastError.message : String(lastError);

  // Write the failure into the visible tbl_MedicationSyncLog sheet (function
  // shared from MedicationSync.gs), not just the execution transcript — so a
  // human can see it without opening Apps Script logs.
  try {
    logMedicationSyncError_(findMedicationRowByRxOrderID_(rxOrderId), lastError);
  } catch (logErr) {
    console.error("Could not write to tbl_MedicationSyncLog: " + logErr);
  }

  return {
    supabaseSync: {
      success: false,
      error: message,
      willRetryAutomatically: true
    }
  };
}
