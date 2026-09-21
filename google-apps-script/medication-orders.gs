// ─── Medication Orders Web App ────────────────────────────────────────────────
// Deployed under osemmedicare@gmail.com as a Google Apps Script Web App.
//
// SETUP:
// 1. https://script.google.com → New project (signed in as osemmedicare@gmail.com).
// 2. Paste this file as Code.gs.
// 3. Replace SHARED_SECRET below with a strong random string, then add the
//    same value as MEDICATION_ORDER_SCRIPT_SECRET in Vercel env vars.
// 4. Save Supabase credentials to Script Properties (run once manually):
//      setMedOrderScriptProperties("https://YOUR.supabase.co", "YOUR_SERVICE_ROLE_OR_ANON_KEY")
//    These are the same Supabase URL and API key used by medicationsync.gs.
// 5. Deploy → New deployment → Web app.
//      Execute as: Me (osemmedicare@gmail.com)
//      Who has access: Anyone
//    ("Anyone" is required since Next.js calls this over plain HTTPS with no
//    Google login — the SHARED_SECRET check is the actual access control.)
// 6. Copy the /exec URL into MEDICATION_ORDER_SCRIPT_URL in Vercel env vars.
// 7. Whenever this code changes: Deploy → Manage deployments → edit existing
//    deployment → New version. A plain Ctrl+S does NOT update the /exec URL.
//
// WHY IS SUPABASE SYNC DONE HERE?
// The onEdit trigger in medicationsync.gs only fires for human (keyboard)
// edits. Writes made by this script via appendRow/setValues are "bot writes"
// and never trigger onEdit. To avoid relying solely on the 24-hour
// reconciliation cron, this script syncs the affected row to Supabase
// immediately after every sheet write.

const SPREADSHEET_ID = "1HXT8HFjjjBakaZiLeU9FggM8cKLZJDBrUjnNqRK3goA";
const SHEET_NAME = "tbl_medicationorder";
const SHARED_SECRET = "REPLACE_ME";
const SUPABASE_TABLE = "tbl_medication_orders";

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

  // onEdit does not fire for programmatic writes — sync immediately.
  const newRowNum = sheet.getLastRow();
  try {
    syncRowToSupabase_(sheet, newRowNum);
  } catch (syncErr) {
    // Log but do not fail the create — medicationsync.gs 24h reconciliation
    // will catch it if this one-time sync fails.
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

      // onEdit does not fire for programmatic writes — sync immediately.
      try {
        syncRowToSupabase_(sheet, rowNum);
      } catch (syncErr) {
        console.error("Post-update Supabase sync failed (row " + rowNum + "):", syncErr);
      }

      return { success: true };
    }
  }

  return { success: false, error: "Order not found: " + rxOrderId };
}

// ─── Supabase sync (called after every sheet write) ────────────────────────
//
// onEdit triggers are not fired by Apps Script writes, so we sync the
// affected row to Supabase directly here.  The FK resolution mirrors the
// logic in medicationsync.gs:
//   ResidentID text  → tbl_residents.id + branch_id
//   PreviousRxOrderID text → tbl_medication_orders.id (nullable)

function syncRowToSupabase_(sheet, rowNum) {
  const config = getSupabaseConfig_();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  const row = {};
  headers.forEach(function(h, i) { row[String(h).trim()] = values[i]; });

  const rxOrderId = cleanStr_(row["RxOrderID"]);
  if (!rxOrderId) {
    Logger.log("syncRowToSupabase_: row " + rowNum + " has no RxOrderID, skipping.");
    return;
  }

  const residentCode = cleanStr_(row["ResidentID"]);
  if (!residentCode) {
    throw new Error("ResidentID is blank in row " + rowNum);
  }

  // Resolve resident FK
  const residentRows = supabaseGet_(config, "tbl_residents",
    ["id", "ResidentID", "branch_id"], { ResidentID: "eq." + residentCode }, 1);
  if (!residentRows.length) {
    throw new Error("Resident not found in Supabase: " + residentCode);
  }
  const resident = residentRows[0];

  // Resolve PreviousRxOrderID FK (optional)
  let previousOrderId = null;
  const prevRef = cleanStr_(row["PreviousRxOrderID"]);
  if (prevRef) {
    const prevRows = supabaseGet_(config, SUPABASE_TABLE,
      ["id", "external_ref_id"], { external_ref_id: "eq." + prevRef }, 1);
    if (prevRows.length) {
      previousOrderId = prevRows[0].id;
    } else {
      Logger.log("PreviousRxOrderID " + prevRef + " not yet in Supabase; leaving FK null.");
    }
  }

  const record = {
    external_ref_id: rxOrderId,
    resident_id: resident.id,
    branch_id: resident.branch_id,
    dosage_form: cleanStr_(row["Dosage Form"]),
    brand_name: cleanStr_(row["Brand Name"]),
    active_ingredient: cleanStr_(row["Active Ingredient"]),
    dose: cleanStr_(row["Dose"]),
    unit: cleanStr_(row["Unit"]),
    frequency: cleanStr_(row["Frequency"]),
    administration_times: cleanStr_(row["Administration Times"]),
    dosing_days: cleanStr_(row["Dosing Days"]),
    indication: cleanStr_(row["Indication"]),
    instruction: cleanStr_(row["Instruction"]),
    duration_type: cleanStr_(row["Duration Type"]),
    start_date: normalizeDate_(row["Start Date"]),
    end_date: normalizeDate_(row["End Date"]),
    noted_by: cleanStr_(row["Noted By"]),
    ordered_by: cleanStr_(row["Ordered By"]),
    supplied_by: cleanStr_(row["Supplied By"]),
    status: cleanStr_(row["Status"]) || "Active",
    previous_order_id: previousOrderId,
  };

  const url = config.url + "/rest/v1/" + encodeURIComponent(SUPABASE_TABLE)
    + "?on_conflict=external_ref_id";

  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(record),
    muteHttpExceptions: true,
    headers: {
      apikey: config.apiKey,
      Prefer: "resolution=merge-duplicates,return=minimal",
      Accept: "application/json",
    },
  });

  const status = resp.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("Supabase upsert failed HTTP " + status + ": " + resp.getContentText());
  }

  Logger.log("Supabase sync OK: RxOrderID=" + rxOrderId + " row=" + rowNum + " HTTP=" + status);
}

function supabaseGet_(config, table, columns, filters, limit) {
  let query = "?select=" + encodeURIComponent(columns.join(","));
  Object.keys(filters || {}).forEach(function(k) {
    query += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(String(filters[k]));
  });
  if (limit) query += "&limit=" + limit;

  const resp = UrlFetchApp.fetch(
    config.url + "/rest/v1/" + encodeURIComponent(table) + query,
    {
      method: "get",
      muteHttpExceptions: true,
      headers: { apikey: config.apiKey, Accept: "application/json" },
    }
  );

  const status = resp.getResponseCode();
  const body = resp.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error("Supabase GET " + table + " failed HTTP " + status + ": " + body);
  }
  return JSON.parse(body);
}

function getSupabaseConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty("SUPABASE_URL") || "").trim().replace(/\/+$/, "");
  const apiKey = String(props.getProperty("SUPABASE_API_KEY") || "").trim();
  if (!url) throw new Error("Missing Script Property: SUPABASE_URL");
  if (!apiKey) throw new Error("Missing Script Property: SUPABASE_API_KEY");
  return { url: url, apiKey: apiKey };
}

// Run once manually to store Supabase credentials in Script Properties.
// Do NOT hard-code credentials in source.
function setMedOrderScriptProperties(supabaseUrl, supabaseApiKey) {
  if (!supabaseUrl || !supabaseApiKey) {
    throw new Error("Both Supabase URL and API key are required.");
  }
  PropertiesService.getScriptProperties().setProperties({
    SUPABASE_URL: String(supabaseUrl).trim().replace(/\/+$/, ""),
    SUPABASE_API_KEY: String(supabaseApiKey).trim(),
  });
  Logger.log("Supabase Script Properties saved.");
}

function cleanStr_(value) {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  return t === "" ? null : t;
}

function normalizeDate_(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) return null;
    return Utilities.formatDate(value,
      Session.getScriptTimeZone() || "Asia/Kuala_Lumpur", "yyyy-MM-dd");
  }
  const t = String(value).trim();
  if (!t) return null;
  const iso = t.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(t);
  if (isNaN(parsed.getTime())) throw new Error("Invalid date: " + t);
  return Utilities.formatDate(parsed,
    Session.getScriptTimeZone() || "Asia/Kuala_Lumpur", "yyyy-MM-dd");
}

// ─── Manual test helpers ───────────────────────────────────────────────────

function testSupabaseConnection() {
  const config = getSupabaseConfig_();
  const resp = UrlFetchApp.fetch(
    config.url + "/rest/v1/" + SUPABASE_TABLE + "?select=id,external_ref_id&limit=1",
    { method: "get", muteHttpExceptions: true,
      headers: { apikey: config.apiKey, Accept: "application/json" } }
  );
  Logger.log("HTTP " + resp.getResponseCode() + ": " + resp.getContentText());
}

function testSyncFirstRow() {
  const sheet = getSheet();
  if (!sheet || sheet.getLastRow() < 2) throw new Error("No data rows found.");
  syncRowToSupabase_(sheet, 2);
  Logger.log("testSyncFirstRow complete.");
}
