// ─── Medication Orders Web App ────────────────────────────────────────────────
// Deployed under osemmedicare@gmail.com as a Google Apps Script Web App.
//
// SETUP:
// 1. https://script.google.com → New project (signed in as osemmedicare@gmail.com).
// 2. Paste this file as Code.gs (alongside medicationsync.gs in the same project).
// 3. Replace SHARED_SECRET below with a strong random string, then add the
//    same value as MEDICATION_ORDER_SCRIPT_SECRET in Vercel env vars.
// 4. Deploy → New deployment → Web app.
//      Execute as: Me (osemmedicare@gmail.com)
//      Who has access: Anyone
//    ("Anyone" is required since Next.js calls this over plain HTTPS with no
//    Google login — the SHARED_SECRET check is the actual access control.)
// 5. Copy the /exec URL into MEDICATION_ORDER_SCRIPT_URL in Vercel env vars.
// 6. Whenever this code changes: Deploy → Manage deployments → edit existing
//    deployment → New version. A plain Ctrl+S does NOT update the /exec URL.
//
// WHY IS syncMedicationSheetRowToSupabase_ CALLED HERE?
// Apps Script onEdit triggers do NOT fire for programmatic writes made by
// other scripts. When this Web App writes to the sheet via appendRow/setValues,
// medicationsync.gs never sees the change until its 24-hour reconciliation
// cron runs. To sync immediately, we call syncMedicationSheetRowToSupabase_()
// (defined in medicationsync.gs, same project) directly after each write.

const SPREADSHEET_ID = "1HXT8HFjjjBakaZiLeU9FggM8cKLZJDBrUjnNqRK3goA";
const SHEET_NAME = "tbl_medicationorder";
const SHARED_SECRET = "REPLACE_ME";

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

function getSheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
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
// After the sheet write, syncs the new row to Supabase immediately.
function createOrder(order) {
  const sheet = getSheet();
  if (!sheet) {
    return { success: false, error: "Sheet '" + SHEET_NAME + "' not found in spreadsheet" };
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

  // onEdit does not fire for script writes — call the medicationsync.gs
  // function directly (same project) to sync this row to Supabase now.
  const newRowNum = sheet.getLastRow();
  try {
    syncMedicationSheetRowToSupabase_(sheet, newRowNum);
  } catch (syncErr) {
    // Log but do not fail the create — the 24-hour reconciliation cron
    // in medicationsync.gs will catch it if this immediate sync fails.
    console.error("Post-create Supabase sync failed (row " + newRowNum + "):", syncErr);
  }

  return { success: true };
}

// Finds the row whose RxOrderID matches, then updates every field in the
// payload except RxOrderID (immutable) and any key not present in the payload
// (left unchanged).
// After the sheet write, syncs the updated row to Supabase immediately.
function updateOrder(rxOrderId, order) {
  const sheet = getSheet();
  if (!sheet) {
    return { success: false, error: "Sheet '" + SHEET_NAME + "' not found in spreadsheet" };
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

  let updatedRowNum = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][rxCol]) === String(rxOrderId)) {
      updatedRowNum = i + 1; // Sheets rows are 1-indexed
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

      sheet.getRange(updatedRowNum, 1, 1, newRow.length).setValues([newRow]);
      break;
    }
  }

  if (updatedRowNum === -1) {
    return { success: false, error: "Order not found: " + rxOrderId };
  }

  // onEdit does not fire for script writes — call the medicationsync.gs
  // function directly (same project) to sync this row to Supabase now.
  try {
    syncMedicationSheetRowToSupabase_(sheet, updatedRowNum);
  } catch (syncErr) {
    console.error("Post-update Supabase sync failed (row " + updatedRowNum + "):", syncErr);
  }

  return { success: true };
}
