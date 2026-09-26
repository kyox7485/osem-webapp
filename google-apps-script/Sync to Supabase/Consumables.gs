// ─── Consumables ──────────────────────────────────────────────────────────────
// The consumables spreadsheet (CONFIG.CONSUMABLE_SPREADSHEET_ID) is the SOURCE
// OF TRUTH, same model as tbl_MedicationStock. That spreadsheet has no Apps
// Script of its own — this project opens it by ID. Flow:
//
//   Next.js inventory-actions.ts ──doPost {action:"consumableCountCreate"}──▶
//     createConsumableCounts ──append──▶ tbl_ResidentConsumable
//        ──▶ Supabase tbl_consumable_master + tbl_resident_consumables
//
// AppSheet also writes these tabs directly. AppSheet writes never fire
// onEdit/onChange, so a 1-minute fingerprint heartbeat (consumableHeartbeat)
// plus a 24-hour reconciliation (syncAllConsumablesToSupabase) mirror them.
// Run setupConsumableTriggers() ONCE after pasting this file.
//
// This file must NOT define doPost/doGet — Code.gs is the single entry point.
// All globals are prefixed cons/CONS to avoid duplicate-global collisions.
//
// Reuses from the same project: CONFIG (Config.gs), buildColumnMap
// (medication-orders.gs), getMedicationSupabaseConfig_,
// cleanMedicationString_, MED_SUPABASE_CONFIG (MedicationSync.gs),
// medStockFetchIn_, medStockNormalizeDateTime_, medStockNumber_,
// medStockUnique_ (MedicationStock.gs).
//
// tbl_ResidentConsumable is an append-only COUNT log: every weekly count adds
// a row; the latest LastCount per resident + item is the current stock.
//
// IDs: the sheet has unpadded IDs (AMN-138, AMN-1) while Supabase uses the
// zero-padded form (AMN-0138, AMN-0001). consNormalizeId_ pads to 4 digits
// before every lookup, so both forms resolve to the same resident/staff.

const CONS_CONFIG = {
  SPREADSHEET_ID: CONFIG.CONSUMABLE_SPREADSHEET_ID,
  MASTER_SHEET: CONFIG.SHEETS.CONSUMABLE_MASTER,
  RECORD_SHEET: CONFIG.SHEETS.RESIDENT_CONSUMABLE,
  MASTER_TABLE: "tbl_consumable_master",
  RECORD_TABLE: "tbl_resident_consumables",
  HEARTBEAT_PROPERTY: "CONSUMABLE_SHEET_FINGERPRINT",
  UPSERT_CHUNK: 200
};

const CONS_MASTER_COLUMNS = ["ConsumableID", "Consumable", "Unit", "MaxStock", "RestockRequired"];

const CONS_RECORD_COLUMNS = [
  "RecordID",
  "ResidentID",
  "ConsumableID",
  "OtherConsumable",
  "OtherUnit",
  "Supplier",
  "CurrentStock",
  "LastCount",
  "CountedBy"
];

const CONS_SUPPLIERS = ["Family", "OSEM"];

// Tab names are matched case-insensitively (the sheet has been referred to as
// both tbl_ConsumableMaster and tbl_consumablemaster).
function consGetSheet_(name) {
  const ss = SpreadsheetApp.openById(CONS_CONFIG.SPREADSHEET_ID);
  const exact = ss.getSheetByName(name);
  if (exact) return exact;
  const wanted = String(name).toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === wanted) return sheets[i];
  }
  throw new Error("Sheet '" + name + "' not found in consumables spreadsheet " + CONS_CONFIG.SPREADSHEET_ID);
}

function consHeaderMap_(sheet, required, label) {
  const lastCol = sheet.getLastColumn();
  const header = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const colMap = buildColumnMap(header.map(function(h) { return String(h).trim(); }));
  const missing = required.filter(function(c) { return colMap[c] === undefined; });
  if (missing.length) throw new Error(label + " is missing column(s): " + missing.join(", "));
  return { header: header, colMap: colMap };
}

// ─── Webapp write (doPost action "consumableCountCreate") ─────────────────────
// One weekly count = several rows (one per item counted), sent together.

function createConsumableCounts(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { success: false, error: "No count rows" };
  }
  for (let i = 0; i < entries.length; i++) {
    const err = consValidateEntry_(entries[i] || {});
    if (err) return { success: false, error: "Row " + (i + 1) + ": " + err };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, error: "Sheet is busy, please try again" };

  let appended = 0;
  try {
    const sheet = consGetSheet_(CONS_CONFIG.RECORD_SHEET);
    const map = consHeaderMap_(sheet, CONS_RECORD_COLUMNS, CONS_CONFIG.RECORD_SHEET);

    // Idempotent on RecordID: the webapp retries on HTTP errors, and a retry
    // can arrive after the rows were already appended.
    const existing = consExistingIds_(sheet, map.colMap);
    const rows = [];
    entries.forEach(function(entry) {
      if (existing[String(entry.RecordID)]) return;
      const row = new Array(map.header.length).fill("");
      CONS_RECORD_COLUMNS.forEach(function(col) {
        const value = entry[col];
        row[map.colMap[col]] = value === undefined || value === null ? "" : value;
      });
      // Real date cell, displayed like existing AppSheet rows.
      const text = String(entry.LastCount).length === 16 ? entry.LastCount + ":00" : entry.LastCount;
      row[map.colMap["LastCount"]] = Utilities.parseDate(text, "Asia/Kuala_Lumpur", "dd/MM/yyyy HH:mm:ss");
      rows.push(row);
    });

    if (rows.length) {
      const start = sheet.getLastRow() + 1;
      sheet.getRange(start, 1, rows.length, map.header.length).setValues(rows);
      sheet.getRange(start, map.colMap["LastCount"] + 1, rows.length, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
      appended = rows.length;
    }
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  } finally {
    lock.releaseLock();
  }

  return Object.assign(
    { success: true, appended: appended },
    consSyncIdsWithRetry_(entries.map(function(e) { return String(e.RecordID); }))
  );
}

function consValidateEntry_(entry) {
  if (!cleanMedicationString_(entry.RecordID)) return "RecordID is required";
  if (!cleanMedicationString_(entry.ResidentID)) return "ResidentID is required";
  if (!cleanMedicationString_(entry.ConsumableID)) return "ConsumableID is required";
  if (CONS_SUPPLIERS.indexOf(entry.Supplier) === -1) return "Invalid Supplier: " + entry.Supplier;
  if (!cleanMedicationString_(entry.CountedBy)) return "CountedBy is required";
  if (typeof entry.CurrentStock !== "number" || !isFinite(entry.CurrentStock) || entry.CurrentStock < 0) {
    return "CurrentStock must be a non-negative number";
  }
  if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}(:\d{2})?$/.test(String(entry.LastCount || ""))) {
    return "LastCount must be DD/MM/YYYY HH:mm:ss";
  }
  return null;
}

function consExistingIds_(sheet, colMap) {
  const out = {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return out;
  sheet.getRange(2, colMap["RecordID"] + 1, lastRow - 1, 1).getValues()
    .forEach(function(r) { const id = String(r[0]).trim(); if (id) out[id] = true; });
  return out;
}

// ─── Targeted sync (fast path) ────────────────────────────────────────────────
// A failure never undoes the Sheet write; it is logged to the visible
// tbl_MedicationSyncLog and retried by the heartbeat/reconciliation.

function consSyncIdsWithRetry_(recordIds) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return { supabaseSync: consSyncIds_(recordIds) };
    } catch (err) {
      lastError = err;
      console.error("consSyncIds_ attempt " + attempt + " failed: " + (err && err.message ? err.message : err));
      if (attempt < 2) Utilities.sleep(800);
    }
  }
  consLogError_("", recordIds.join(","), lastError);
  return {
    supabaseSync: {
      success: false,
      error: lastError && lastError.message ? lastError.message : String(lastError),
      willRetryAutomatically: true
    }
  };
}

function consSyncIds_(recordIds) {
  const supabase = getMedicationSupabaseConfig_();
  const master = consSyncMaster_(supabase);

  const wanted = {};
  recordIds.forEach(function(id) { wanted[id] = true; });
  const raws = consReadRecords_().filter(function(r) { return wanted[r.id]; }).map(function(r) { return r.raw; });
  if (raws.length !== recordIds.length) {
    throw new Error("RecordID(s) not found in sheet after write");
  }

  const lookups = consResolveLookups_(supabase, raws, master);
  consUpsert_(supabase, CONS_CONFIG.RECORD_TABLE, "external_ref_id",
    raws.map(function(raw) { return consBuildRecord_(raw, lookups); }));
  return { success: true, records: raws.length };
}

// ─── Master (catalogue) ───────────────────────────────────────────────────────
// Always synced before records (records reference consumable_id). Master rows
// are never deleted from Supabase: count history still points at them.

function consSyncMaster_(supabase) {
  const sheet = consGetSheet_(CONS_CONFIG.MASTER_SHEET);
  const map = consHeaderMap_(sheet, CONS_MASTER_COLUMNS, CONS_CONFIG.MASTER_SHEET);
  const values = sheet.getDataRange().getValues();

  const byId = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const id = cleanMedicationString_(row[map.colMap["ConsumableID"]]);
    if (!id) continue;
    const name = cleanMedicationString_(row[map.colMap["Consumable"]]);
    if (!name) {
      consLogError_(i + 1, "Master " + id, new Error("Consumable name is blank"));
      continue;
    }
    byId[id] = {
      consumable_id: id,
      consumable: name,
      unit: cleanMedicationString_(row[map.colMap["Unit"]]) || "Unit",
      max_stock: medStockNumber_(row[map.colMap["MaxStock"]], "MaxStock"),
      restock_required: String(row[map.colMap["RestockRequired"]]).trim().toLowerCase() === "yes",
      updated_at: new Date().toISOString()
    };
  }

  const records = Object.keys(byId).map(function(id) { return byId[id]; });
  if (records.length) consUpsert_(supabase, CONS_CONFIG.MASTER_TABLE, "consumable_id", records);
  return byId;
}

// ─── Full reconciliation ──────────────────────────────────────────────────────

function syncAllConsumablesToSupabase() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.warn("syncAllConsumablesToSupabase: script lock busy, will retry next run.");
    return { success: false, skipped: true };
  }
  try {
    return consSyncAllUnlocked_();
  } finally {
    lock.releaseLock();
  }
}

function consReadRecords_() {
  const sheet = consGetSheet_(CONS_CONFIG.RECORD_SHEET);
  const map = consHeaderMap_(sheet, CONS_RECORD_COLUMNS, CONS_CONFIG.RECORD_SHEET);
  const values = sheet.getDataRange().getValues();

  // Last occurrence of a RecordID wins (a duplicate would fail the batch).
  const byId = {};
  const order = [];
  for (let i = 1; i < values.length; i++) {
    const raw = {};
    CONS_RECORD_COLUMNS.forEach(function(c) { raw[c] = values[i][map.colMap[c]]; });
    const id = cleanMedicationString_(raw.RecordID);
    if (!id) continue;
    if (!byId[id]) order.push(id);
    byId[id] = { id: id, rowNumber: i + 1, raw: raw };
  }
  return order.map(function(id) { return byId[id]; });
}

function consSyncAllUnlocked_() {
  const supabase = getMedicationSupabaseConfig_();
  const master = consSyncMaster_(supabase);
  const rows = consReadRecords_();
  const lookups = consResolveLookups_(supabase, rows.map(function(r) { return r.raw; }), master);

  const built = [];
  const failures = [];
  rows.forEach(function(r) {
    try {
      built.push({ id: r.id, rowNumber: r.rowNumber, record: consBuildRecord_(r.raw, lookups) });
    } catch (err) {
      failures.push(r.id);
      consLogError_(r.rowNumber, r.id, err);
    }
  });

  for (let start = 0; start < built.length; start += CONS_CONFIG.UPSERT_CHUNK) {
    const chunk = built.slice(start, start + CONS_CONFIG.UPSERT_CHUNK);
    try {
      consUpsert_(supabase, CONS_CONFIG.RECORD_TABLE, "external_ref_id", chunk.map(function(b) { return b.record; }));
    } catch (chunkErr) {
      // Isolate the bad row(s) instead of failing the whole chunk.
      chunk.forEach(function(b) {
        try {
          consUpsert_(supabase, CONS_CONFIG.RECORD_TABLE, "external_ref_id", [b.record]);
        } catch (err) {
          failures.push(b.id);
          consLogError_(b.rowNumber, b.id, err);
        }
      });
    }
  }

  // Mirror sheet deletions — only after a pass with ZERO failures, and never
  // against an empty sheet (same anti-data-loss rule as medication stock).
  let deleted = 0;
  if (failures.length === 0 && rows.length > 0) {
    const inSheet = {};
    rows.forEach(function(r) { inSheet[r.id] = true; });
    const orphans = consGetAllSupabaseIds_(supabase).filter(function(id) { return !inSheet[id]; });
    if (orphans.length) {
      consDelete_(supabase, orphans);
      deleted = orphans.length;
    }
  }

  return {
    success: failures.length === 0,
    masterItems: Object.keys(master).length,
    rows: rows.length,
    synced: built.length - failures.length,
    failed: failures.length,
    deleted: deleted
  };
}

// ─── Heartbeat (catches AppSheet writes within ~1 minute) ─────────────────────

function consumableHeartbeat() {
  try {
    const props = PropertiesService.getScriptProperties();
    const current = consFingerprint_();
    if (current === props.getProperty(CONS_CONFIG.HEARTBEAT_PROPERTY)) return;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return; // busy — next minute retries
    try {
      consSyncAllUnlocked_();
    } finally {
      lock.releaseLock();
    }
    // Advanced even when individual rows failed (already logged); the 24h
    // reconciliation retries them. A thrown whole-pass error skips this.
    props.setProperty(CONS_CONFIG.HEARTBEAT_PROPERTY, current);
  } catch (err) {
    console.error(err);
  }
}

function consFingerprint_() {
  const values = [
    consGetSheet_(CONS_CONFIG.MASTER_SHEET).getDataRange().getValues(),
    consGetSheet_(CONS_CONFIG.RECORD_SHEET).getDataRange().getValues()
  ];
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(values))
  );
}

function setupConsumableTriggers() {
  const handlers = ["consumableHeartbeat", "syncAllConsumablesToSupabase"];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("consumableHeartbeat").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("syncAllConsumablesToSupabase").timeBased().everyHours(24).create();
  Logger.log("Consumable triggers created: 1-minute heartbeat + 24-hour reconciliation.");
}

// ─── Record building ──────────────────────────────────────────────────────────

// "AMN-138" → "AMN-0138", "amn-1" → "AMN-0001". Anything else is returned
// trimmed and unchanged.
function consNormalizeId_(value) {
  const text = cleanMedicationString_(value);
  if (!text) return null;
  const m = text.match(/^([A-Za-z]+)-0*(\d+)$/);
  if (!m) return text;
  const digits = m[2].length >= 4 ? m[2] : ("0000" + m[2]).slice(-4);
  return m[1].toUpperCase() + "-" + digits;
}

function consResolveLookups_(supabase, raws, master) {
  const residentIds = medStockUnique_(raws.map(function(r) { return consNormalizeId_(r.ResidentID); }));
  const staffIds = medStockUnique_(raws.map(function(r) { return consNormalizeId_(r.CountedBy); }));

  const residents = {};
  medStockFetchIn_(supabase, "tbl_residents", ["id", "ResidentID", "branch_id"], "ResidentID", residentIds)
    .forEach(function(r) { residents[r.ResidentID] = r; });

  const staff = {};
  medStockFetchIn_(supabase, "tbl_staff", ["StaffID"], "StaffID", staffIds)
    .forEach(function(s) { staff[s.StaffID] = true; });

  return { residents: residents, staff: staff, master: master };
}

function consBuildRecord_(raw, lookups) {
  const recordId = cleanMedicationString_(raw.RecordID);
  if (!recordId) throw new Error("RecordID is blank");

  const residentId = consNormalizeId_(raw.ResidentID);
  const resident = residentId ? lookups.residents[residentId] : null;
  if (!resident) throw new Error("Resident not found in Supabase: " + raw.ResidentID);

  const consumableId = cleanMedicationString_(raw.ConsumableID);
  const item = consumableId ? lookups.master[consumableId] : null;
  if (!item) throw new Error("ConsumableID not in " + CONS_CONFIG.MASTER_SHEET + ": " + consumableId);

  const countedBy = consNormalizeId_(raw.CountedBy);
  if (countedBy && !lookups.staff[countedBy]) {
    throw new Error("CountedBy StaffID not found in Supabase tbl_staff: " + raw.CountedBy);
  }

  const stock = medStockNumber_(raw.CurrentStock, "CurrentStock");
  if (stock === null || stock < 0) throw new Error("CurrentStock must be a non-negative number");

  // OtherConsumable / OtherUnit only mean something for the "Other" item;
  // AppSheet sometimes leaves a stray OtherUnit on normal rows.
  const isOther = String(item.consumable).trim().toLowerCase() === "other";

  return {
    external_ref_id: recordId,
    branch_id: resident.branch_id,
    resident_id: resident.id,
    consumable_id: consumableId,
    other_consumable: isOther ? cleanMedicationString_(raw.OtherConsumable) : null,
    other_unit: isOther ? cleanMedicationString_(raw.OtherUnit) : null,
    supplier: consCanonicalSupplier_(raw.Supplier),
    current_stock: stock,
    last_count: medStockNormalizeDateTime_(raw.LastCount),
    counted_by: countedBy
  };
}

function consCanonicalSupplier_(value) {
  const text = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
  if (!text) return null;
  for (let i = 0; i < CONS_SUPPLIERS.length; i++) {
    if (CONS_SUPPLIERS[i].toLowerCase() === text) return CONS_SUPPLIERS[i];
  }
  throw new Error("Invalid Supplier: " + value);
}

// ─── Supabase writes ──────────────────────────────────────────────────────────

function consUpsert_(supabase, table, conflictColumn, records) {
  const url = supabase.url + "/rest/v1/" + table + "?on_conflict=" + encodeURIComponent(conflictColumn);
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
    throw new Error("Supabase " + table + " UPSERT failed. HTTP " + status + ": " + response.getContentText());
  }
}

function consGetAllSupabaseIds_(supabase) {
  const ids = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = supabaseGetMedicationRows_(
      supabase,
      CONS_CONFIG.RECORD_TABLE,
      ["external_ref_id"],
      { order: "id.asc", offset: String(offset) },
      PAGE
    );
    rows.forEach(function(r) { ids.push(r.external_ref_id); });
    if (rows.length < PAGE) break;
  }
  return ids;
}

function consDelete_(supabase, ids) {
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    const list = chunk.map(function(v) { return '"' + String(v).replace(/"/g, '\\"') + '"'; }).join(",");
    const url = supabase.url + "/rest/v1/" + CONS_CONFIG.RECORD_TABLE +
      "?external_ref_id=" + encodeURIComponent("in.(" + list + ")");
    const response = UrlFetchApp.fetch(url, {
      method: "delete",
      muteHttpExceptions: true,
      headers: { apikey: supabase.apiKey, Prefer: "return=minimal" }
    });
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error("Supabase consumable DELETE failed. HTTP " + status + ": " + response.getContentText());
    }
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────
// Same visible log sheet as medication (tbl_MedicationSyncLog) — nothing is
// added to the consumables spreadsheet. Rows are "Consumable <RecordID>".

function consLogError_(rowNumber, recordId, error) {
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
      "Consumable " + recordId,
      error && error.message ? error.message : String(error)
    ]);
  } catch (logError) {
    console.error("Unable to write consumable sync log: " + logError);
  }
}

// ─── Diagnostics (run from the editor; hits production data) ─────────────────

function testConsumableSync() {
  Logger.log(JSON.stringify(syncAllConsumablesToSupabase(), null, 2));
}
