// ─── Medication Stock ─────────────────────────────────────────────────────────
// Google Sheet tab `tbl_MedicationStock` is the SOURCE OF TRUTH (same model
// as tbl_MedicationOrder). Flow:
//
//   Next.js stock-actions.ts ──doPost {action:"stockCreate"}──▶ createStockEntry
//        ──appendRow──▶ tbl_MedicationStock ──▶ Supabase tbl_medication_stock
//
// AppSheet also writes this tab directly. AppSheet/API writes never fire
// onEdit/onChange, so a 1-minute fingerprint heartbeat
// (medicationStockHeartbeat) plus a 24-hour reconciliation
// (syncAllMedicationStockToSupabase) mirror those too. Run
// setupMedicationStockTriggers() ONCE after pasting this file.
//
// This file must NOT define doPost/doGet — Code.gs is the single entry point.
// All globals here are prefixed medStock/MED_STOCK to avoid the
// duplicate-global-name collisions documented in docs/google-apps-script.md.
//
// Reuses from the same project: CONFIG (Config.gs), buildColumnMap
// (medication-orders.gs), getMedicationSupabaseConfig_,
// supabaseGetMedicationRows_, cleanMedicationString_, MED_SUPABASE_CONFIG
// (MedicationSync.gs).
//
// Rows are an append-only audit trail of events (Stock Count / Stock
// Received / Order Changed) — never a daily row. The webapp computes the
// live forecast from the latest event; Daily Usage / Days Remaining in the
// sheet are snapshots at event time (0 = not applicable, AppSheet convention).

const MED_STOCK_CONFIG = {
  SPREADSHEET_ID: CONFIG.MEDICATION_STOCK_SPREADSHEET_ID,
  SHEET_NAME: CONFIG.SHEETS.MEDICATION_STOCK,
  SUPABASE_TABLE: "tbl_medication_stock",
  UNIQUE_COLUMN: "external_ref_id",
  HEARTBEAT_PROPERTY: "MEDICATION_STOCK_SHEET_FINGERPRINT",
  UPSERT_CHUNK: 200,
  LOOKUP_CHUNK: 100
};

// Exact sheet headers. Writes go through a live header map, so column order
// in the sheet does not matter.
const MED_STOCK_COLUMNS = [
  "StockID",
  "ResidentID",
  "RxOrderID",
  "Balance",
  "Unit",
  "Daily Usage",
  "Days Remaining",
  "StockDate",
  "RegisteredBy",
  "EntryType"
];

const MED_STOCK_ENTRY_TYPES = ["Stock Count", "Stock Received", "Order Changed"];

// Must match the check constraint on tbl_medication_stock.unit and
// webapp/src/lib/medication-stock.ts STOCK_UNITS.
const MED_STOCK_UNITS = [
  "Tablet", "Capsule", "Sachet", "Ampoule", "mL", "Puff", "Unit",
  "Bottle", "Tube", "Jar", "Cannister", "Pump", "Drop", "Pen", "Application"
];

function getMedicationStockSheet_() {
  return SpreadsheetApp
    .openById(MED_STOCK_CONFIG.SPREADSHEET_ID)
    .getSheetByName(MED_STOCK_CONFIG.SHEET_NAME);
}

// ─── Webapp write (doPost action "stockCreate") ───────────────────────────────

function createStockEntry(entry) {
  entry = entry || {};

  const validationError = medStockValidateEntry_(entry);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const sheet = getMedicationStockSheet_();
  if (!sheet) {
    return {
      success: false,
      error: "Sheet '" + MED_STOCK_CONFIG.SHEET_NAME + "' not found in spreadsheet " +
        MED_STOCK_CONFIG.SPREADSHEET_ID + " (check CONFIG.MEDICATION_STOCK_SPREADSHEET_ID)"
    };
  }

  const lastCol = sheet.getLastColumn();
  const header = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const colMap = buildColumnMap(header);
  const missing = MED_STOCK_COLUMNS.filter(function(c) { return colMap[c] === undefined; });
  if (missing.length) {
    return { success: false, error: "tbl_MedicationStock is missing column(s): " + missing.join(", ") };
  }

  // Idempotent: the webapp retries on HTTP errors, and a retry can arrive
  // after this row was already appended.
  if (medStockFindRow_(sheet, colMap, entry.StockID) !== -1) {
    return Object.assign(
      { success: true, duplicate: true },
      medStockSyncOneWithRetry_(entry.StockID)
    );
  }

  const row = new Array(header.length).fill("");
  MED_STOCK_COLUMNS.forEach(function(col) {
    const value = entry[col];
    row[colMap[col]] = value === undefined || value === null ? "" : value;
  });

  // Store StockDate as a real date cell (not text) so AppSheet and the PDF
  // project's getLatestMedicationStock read it reliably; displayed in the
  // same DD/MM/YYYY HH:mm:ss shape as existing AppSheet rows.
  const stockDateText = String(entry.StockDate).length === 16
    ? entry.StockDate + ":00"
    : entry.StockDate;
  row[colMap["StockDate"]] = Utilities.parseDate(stockDateText, "Asia/Kuala_Lumpur", "dd/MM/yyyy HH:mm:ss");

  sheet.appendRow(row);
  sheet.getRange(sheet.getLastRow(), colMap["StockDate"] + 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");

  return Object.assign({ success: true }, medStockSyncOneWithRetry_(entry.StockID));
}

function medStockValidateEntry_(entry) {
  if (!cleanMedicationString_(entry.StockID)) return "StockID is required";
  if (!cleanMedicationString_(entry.ResidentID)) return "ResidentID is required";
  if (!cleanMedicationString_(entry.RxOrderID)) return "RxOrderID is required";
  if (MED_STOCK_ENTRY_TYPES.indexOf(entry.EntryType) === -1) return "Invalid EntryType: " + entry.EntryType;
  if (MED_STOCK_UNITS.indexOf(entry.Unit) === -1) return "Invalid Unit: " + entry.Unit;
  if (typeof entry.Balance !== "number" || !isFinite(entry.Balance) || entry.Balance < 0) {
    return "Balance must be a non-negative number";
  }
  if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}(:\d{2})?$/.test(String(entry.StockDate || ""))) {
    return "StockDate must be DD/MM/YYYY HH:mm";
  }
  return null;
}

function medStockFindRow_(sheet, colMap, stockId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, colMap["StockID"] + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(stockId)) return i + 2;
  }
  return -1;
}

// ─── Targeted sync (fast path) ────────────────────────────────────────────────
// Same contract as medication-orders.gs's syncOrderAndSummary_: a failure
// never undoes the Sheet write; it is logged to the visible
// tbl_MedicationSyncLog and retried by the heartbeat/reconciliation.

function medStockSyncOneWithRetry_(stockId) {
  const MAX_ATTEMPTS = 2;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return { supabaseSync: medStockSyncOne_(stockId) };
    } catch (err) {
      lastError = err;
      console.error("medStockSyncOne_ attempt " + attempt + "/" + MAX_ATTEMPTS +
        " failed for StockID " + stockId + ": " + (err && err.message ? err.message : err));
      if (attempt < MAX_ATTEMPTS) Utilities.sleep(800);
    }
  }

  medStockLogError_("", stockId, lastError);

  return {
    supabaseSync: {
      success: false,
      error: lastError && lastError.message ? lastError.message : String(lastError),
      willRetryAutomatically: true
    }
  };
}

function medStockSyncOne_(stockId) {
  const sheet = getMedicationStockSheet_();
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const colMap = buildColumnMap(header);

  let raw = null;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][colMap["StockID"]]).trim() === String(stockId)) {
      raw = medStockRowToRaw_(header, values[i]);
    }
  }
  if (!raw) throw new Error("StockID not found in sheet: " + stockId);

  const supabase = getMedicationSupabaseConfig_();
  const lookups = medStockResolveLookups_(supabase, [raw]);
  const record = medStockBuildRecord_(raw, lookups);
  medStockUpsert_(supabase, [record]);

  return { success: true, stockId: stockId };
}

// ─── Full reconciliation ──────────────────────────────────────────────────────

function syncAllMedicationStockToSupabase() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.warn("syncAllMedicationStockToSupabase: script lock busy, will retry next run.");
    return { success: false, skipped: true };
  }
  try {
    return medStockSyncAllUnlocked_();
  } finally {
    lock.releaseLock();
  }
}

function medStockSyncAllUnlocked_() {
  const sheet = getMedicationStockSheet_();
  if (!sheet) throw new Error("Sheet '" + MED_STOCK_CONFIG.SHEET_NAME + "' not found");

  const values = sheet.getDataRange().getValues();
  if (values.length < 1) throw new Error("tbl_MedicationStock has no header row");

  const header = values[0];
  const colMap = buildColumnMap(header);
  const missing = MED_STOCK_COLUMNS.filter(function(c) { return colMap[c] === undefined; });
  if (missing.length) throw new Error("tbl_MedicationStock is missing column(s): " + missing.join(", "));

  // Last occurrence of a StockID wins; duplicates would make a single
  // upsert batch fail ("cannot affect row a second time").
  const byId = {};
  const order = [];
  for (let i = 1; i < values.length; i++) {
    const raw = medStockRowToRaw_(header, values[i]);
    const id = cleanMedicationString_(raw.StockID);
    if (!id) continue;
    if (!byId[id]) order.push(id);
    byId[id] = { rowNumber: i + 1, raw: raw };
  }

  const supabase = getMedicationSupabaseConfig_();
  const lookups = medStockResolveLookups_(supabase, order.map(function(id) { return byId[id].raw; }));

  const built = [];
  const failures = [];

  order.forEach(function(id) {
    try {
      built.push({ id: id, rowNumber: byId[id].rowNumber, record: medStockBuildRecord_(byId[id].raw, lookups) });
    } catch (err) {
      failures.push(id);
      medStockLogError_(byId[id].rowNumber, id, err);
    }
  });

  for (let start = 0; start < built.length; start += MED_STOCK_CONFIG.UPSERT_CHUNK) {
    const chunk = built.slice(start, start + MED_STOCK_CONFIG.UPSERT_CHUNK);
    try {
      medStockUpsert_(supabase, chunk.map(function(b) { return b.record; }));
    } catch (chunkErr) {
      // Isolate the bad row(s) instead of failing the whole chunk.
      chunk.forEach(function(b) {
        try {
          medStockUpsert_(supabase, [b.record]);
        } catch (err) {
          failures.push(b.id);
          medStockLogError_(b.rowNumber, b.id, err);
        }
      });
    }
  }

  // Mirror sheet deletions — only after a pass with ZERO failures, and never
  // against an empty sheet (same anti-data-loss rule as the order snapshot).
  let deleted = 0;
  if (failures.length === 0 && order.length > 0) {
    const inSheet = {};
    order.forEach(function(id) { inSheet[id] = true; });
    const orphans = medStockGetAllSupabaseIds_(supabase).filter(function(id) { return !inSheet[id]; });
    if (orphans.length) {
      medStockDelete_(supabase, orphans);
      deleted = orphans.length;
    }
  }

  return {
    success: failures.length === 0,
    rows: order.length,
    synced: built.length - failures.length,
    failed: failures.length,
    deleted: deleted
  };
}

// ─── Heartbeat (catches AppSheet / programmatic writes within ~1 minute) ──────

function medicationStockHeartbeat() {
  try {
    const props = PropertiesService.getScriptProperties();
    const current = medStockFingerprint_();
    if (current === props.getProperty(MED_STOCK_CONFIG.HEARTBEAT_PROPERTY)) return;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return; // busy — next minute retries

    try {
      medStockSyncAllUnlocked_();
    } finally {
      lock.releaseLock();
    }

    // Advanced even when individual rows failed: those are data problems,
    // already written to tbl_MedicationSyncLog, and re-logging them every
    // minute would flood the log. The 24h reconciliation retries them.
    // A thrown (whole-pass) error skips this line, so it retries next minute.
    props.setProperty(MED_STOCK_CONFIG.HEARTBEAT_PROPERTY, current);
  } catch (err) {
    console.error(err);
  }
}

function medStockFingerprint_() {
  const values = getMedicationStockSheet_().getDataRange().getValues();
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(values))
  );
}

function setupMedicationStockTriggers() {
  const handlers = ["medicationStockHeartbeat", "syncAllMedicationStockToSupabase"];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("medicationStockHeartbeat").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("syncAllMedicationStockToSupabase").timeBased().everyHours(24).create();

  Logger.log("Medication stock triggers created: 1-minute heartbeat + 24-hour reconciliation.");
}

// ─── Record building ──────────────────────────────────────────────────────────

function medStockRowToRaw_(header, rowValues) {
  const raw = {};
  for (let i = 0; i < header.length; i++) raw[header[i]] = rowValues[i];
  return raw;
}

function medStockResolveLookups_(supabase, raws) {
  const residentIds = medStockUnique_(raws.map(function(r) { return cleanMedicationString_(r.ResidentID); }));
  const rxIds = medStockUnique_(raws.map(function(r) { return cleanMedicationString_(r.RxOrderID); }));
  const staffIds = medStockUnique_(raws.map(function(r) { return cleanMedicationString_(r.RegisteredBy); }));

  const residents = {};
  medStockFetchIn_(supabase, "tbl_residents", ["id", "ResidentID", "branch_id"], "ResidentID", residentIds)
    .forEach(function(r) { residents[r.ResidentID] = r; });

  const orders = {};
  medStockFetchIn_(supabase, "tbl_medication_orders", ["id", "external_ref_id", "resident_id"], "external_ref_id", rxIds)
    .forEach(function(o) { orders[o.external_ref_id] = o; });

  const staff = {};
  medStockFetchIn_(supabase, "tbl_staff", ["StaffID"], "StaffID", staffIds)
    .forEach(function(s) { staff[s.StaffID] = true; });

  return { residents: residents, orders: orders, staff: staff };
}

function medStockFetchIn_(supabase, table, columns, column, values) {
  const out = [];
  for (let start = 0; start < values.length; start += MED_STOCK_CONFIG.LOOKUP_CHUNK) {
    const chunk = values.slice(start, start + MED_STOCK_CONFIG.LOOKUP_CHUNK);
    const list = chunk.map(function(v) { return '"' + String(v).replace(/"/g, '\\"') + '"'; }).join(",");
    const filters = {};
    filters[column] = "in.(" + list + ")";
    supabaseGetMedicationRows_(supabase, table, columns, filters, null)
      .forEach(function(row) { out.push(row); });
  }
  return out;
}

function medStockBuildRecord_(raw, lookups) {
  const stockId = cleanMedicationString_(raw.StockID);
  if (!stockId) throw new Error("StockID is blank");

  const residentId = cleanMedicationString_(raw.ResidentID);
  const resident = residentId ? lookups.residents[residentId] : null;
  if (!resident) throw new Error("Resident not found in Supabase: " + residentId);

  const rxOrderId = cleanMedicationString_(raw.RxOrderID);
  const order = rxOrderId ? lookups.orders[rxOrderId] : null;
  if (!order) {
    throw new Error("Medication order not found in Supabase: RxOrderID " + rxOrderId +
      " (it may not have synced yet — will retry)");
  }
  if (String(order.resident_id) !== String(resident.id)) {
    throw new Error("RxOrderID " + rxOrderId + " does not belong to resident " + residentId);
  }

  const registeredBy = cleanMedicationString_(raw.RegisteredBy);
  if (registeredBy && !lookups.staff[registeredBy]) {
    throw new Error("RegisteredBy StaffID not found in Supabase tbl_staff: " + registeredBy);
  }

  const entryType = cleanMedicationString_(raw.EntryType);
  if (MED_STOCK_ENTRY_TYPES.indexOf(entryType) === -1) throw new Error("Invalid EntryType: " + entryType);

  const unit = medStockCanonicalUnit_(raw.Unit);
  const balance = medStockNumber_(raw.Balance, "Balance");
  if (balance === null || balance < 0) throw new Error("Balance must be a non-negative number");

  return {
    external_ref_id: stockId,
    branch_id: resident.branch_id,
    resident_id: resident.id,
    medication_order_id: order.id,
    balance: balance,
    unit: unit,
    daily_usage: medStockNumber_(raw["Daily Usage"], "Daily Usage"),
    days_remaining: medStockNumber_(raw["Days Remaining"], "Days Remaining"),
    stock_date: medStockNormalizeDateTime_(raw.StockDate),
    registered_by: registeredBy,
    entry_type: entryType
  };
}

// Case-insensitive match onto the fixed list (so AppSheet "ml" → "mL").
function medStockCanonicalUnit_(value) {
  const text = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
  for (let i = 0; i < MED_STOCK_UNITS.length; i++) {
    if (MED_STOCK_UNITS[i].toLowerCase() === text) return MED_STOCK_UNITS[i];
  }
  throw new Error("Invalid Unit: " + value);
}

function medStockNumber_(value, label) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  const n = parseFloat(String(value).replace(/,/g, "").trim());
  if (isNaN(n)) throw new Error(label + " is not a number: " + value);
  return n;
}

// StockDate is DD/MM/YYYY HH:mm[:ss] in the sheet (or a Date object when
// Sheets has parsed it). Parsed explicitly — never via new Date(text), which
// reads DD/MM as MM/DD. Returned as ISO with the script-timezone offset.
function medStockNormalizeDateTime_(value) {
  const tz = Session.getScriptTimeZone() || "Asia/Kuala_Lumpur";

  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) throw new Error("Invalid StockDate");
    return Utilities.formatDate(value, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  const text = String(value === null || value === undefined ? "" : value).trim();
  if (!text) throw new Error("StockDate is required");

  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;

  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) throw new Error("Invalid StockDate (expected DD/MM/YYYY HH:mm): " + text);

  const pad = function(s) { return ("0" + (s || "0")).slice(-2); };
  const offset = Utilities.formatDate(new Date(), tz, "XXX");
  return m[3] + "-" + pad(m[2]) + "-" + pad(m[1]) + "T" +
    pad(m[4]) + ":" + pad(m[5]) + ":" + pad(m[6]) + offset;
}

function medStockUnique_(list) {
  const seen = {};
  const out = [];
  list.forEach(function(v) {
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  return out;
}

// ─── Supabase writes ──────────────────────────────────────────────────────────

function medStockUpsert_(supabase, records) {
  const url = supabase.url + "/rest/v1/" + MED_STOCK_CONFIG.SUPABASE_TABLE +
    "?on_conflict=" + encodeURIComponent(MED_STOCK_CONFIG.UNIQUE_COLUMN);

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(records),
    muteHttpExceptions: true,
    headers: {
      apikey: supabase.apiKey,
      Prefer: "resolution=merge-duplicates,return=minimal",
      Accept: "application/json"
    }
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("Supabase stock UPSERT failed. HTTP " + status + ": " + response.getContentText());
  }
}

function medStockGetAllSupabaseIds_(supabase) {
  const ids = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = supabaseGetMedicationRows_(
      supabase,
      MED_STOCK_CONFIG.SUPABASE_TABLE,
      ["external_ref_id"],
      { order: "id.asc", offset: String(offset) },
      PAGE
    );
    rows.forEach(function(r) { ids.push(r.external_ref_id); });
    if (rows.length < PAGE) break;
  }
  return ids;
}

function medStockDelete_(supabase, ids) {
  for (let start = 0; start < ids.length; start += MED_STOCK_CONFIG.LOOKUP_CHUNK) {
    const chunk = ids.slice(start, start + MED_STOCK_CONFIG.LOOKUP_CHUNK);
    const list = chunk.map(function(v) { return '"' + String(v).replace(/"/g, '\\"') + '"'; }).join(",");
    const url = supabase.url + "/rest/v1/" + MED_STOCK_CONFIG.SUPABASE_TABLE +
      "?" + MED_STOCK_CONFIG.UNIQUE_COLUMN + "=" + encodeURIComponent("in.(" + list + ")");

    const response = UrlFetchApp.fetch(url, {
      method: "delete",
      muteHttpExceptions: true,
      headers: { apikey: supabase.apiKey, Prefer: "return=minimal" }
    });

    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error("Supabase stock DELETE failed. HTTP " + status + ": " + response.getContentText());
    }
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────
// Same visible log sheet as medication orders. The third column is labelled
// RxOrderID there; stock rows are written as "Stock <StockID>" to tell them apart.

function medStockLogError_(rowNumber, stockId, error) {
  try {
    const ss = SpreadsheetApp.openById(MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(MED_SUPABASE_CONFIG.LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(MED_SUPABASE_CONFIG.LOG_SHEET_NAME);
      sheet.appendRow(["Timestamp", "Row", "RxOrderID", "Error"]);
    }
    sheet.appendRow([
      new Date(),
      rowNumber,
      "Stock " + stockId,
      error && error.message ? error.message : String(error)
    ]);
  } catch (logError) {
    console.error("Unable to write medication stock sync log: " + logError);
  }
}

// ─── Diagnostics (run from the editor; hits production data) ─────────────────

function testMedicationStockSync() {
  Logger.log(JSON.stringify(syncAllMedicationStockToSupabase(), null, 2));
}
