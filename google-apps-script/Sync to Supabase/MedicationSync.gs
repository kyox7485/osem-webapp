/** ===== svgMedicationSync ===== */
function getMedicationUpdates(lastSync) {

  const residentSheet = getSystemSheet(CONFIG.SHEETS.RESIDENT);

  const data = residentSheet.getDataRange().getValues();
  const header = data[0];

  const residentIDCol = header.indexOf("ResidentID");
  const medCol = header.indexOf("CurrentMedList");
  const updatedCol = header.indexOf("MedicationLastUpdated");

  const lastSyncTime = new Date(lastSync).getTime();

  const results = [];

  for (let i = 1; i < data.length; i++) {

    const updated = data[i][updatedCol];

    if (!updated)
      continue;

    const updatedTime = new Date(updated).getTime();

    if (isNaN(updatedTime))
      continue;

    if (updatedTime > lastSyncTime) {

      results.push({

        ResidentID: data[i][residentIDCol],

        CurrentMedList: data[i][medCol],

        MedicationLastUpdated: updated

      });

    }

  }

  return results;

}

function getMedicationByResident(residentID) {

  const sheet =
    getSystemSheet(
      CONFIG.SHEETS.RESIDENT
    );

  const lastRow =
    sheet.getLastRow();

  const lastColumn =
    sheet.getLastColumn();

  if (lastRow < 2) {

    return {
      success: false,
      error: "No resident data found."
    };

  }

  //------------------------------------------------
  // Get headers
  //------------------------------------------------

  const header =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getValues()[0];

  const residentIDCol =
    header.indexOf("ResidentID");

  const currentMedCol =
    header.indexOf("CurrentMedList");

  const medicationUpdatedCol =
    header.indexOf("MedicationLastUpdated");

  //------------------------------------------------
  // Validate columns
  //------------------------------------------------

  if (residentIDCol == -1)
    throw new Error(
      "ResidentID column not found."
    );

  if (currentMedCol == -1)
    throw new Error(
      "CurrentMedList column not found."
    );

  if (medicationUpdatedCol == -1)
    throw new Error(
      "MedicationLastUpdated column not found."
    );

  //------------------------------------------------
  // Normalize requested ID
  //------------------------------------------------

  residentID =
    String(residentID || "")
      .trim();

  //------------------------------------------------
  // Google ResidentID
  // Example:
  //
  // Access = 138
  // Google = AMN-138
  //
  // This function expects Google ID.
  //------------------------------------------------

  const idValues =
    sheet
      .getRange(
        2,
        residentIDCol + 1,
        lastRow - 1,
        1
      )
      .getValues();

  let targetRow = -1;

  for (
    let i = 0;
    i < idValues.length;
    i++
  ) {

    if (
      String(idValues[i][0])
        .trim() ==
      residentID
    ) {

      targetRow =
        i + 2;

      break;

    }

  }

  //------------------------------------------------
  // Resident not found
  //------------------------------------------------

  if (targetRow == -1) {

    return {

      success: false,

      error:
        "Resident not found: " +
        residentID

    };

  }

  //------------------------------------------------
  // Get only required fields
  //------------------------------------------------

  const currentMed =
    sheet
      .getRange(
        targetRow,
        currentMedCol + 1
      )
      .getValue();

  const medicationUpdated =
    sheet
      .getRange(
        targetRow,
        medicationUpdatedCol + 1
      )
      .getValue();

  //------------------------------------------------
  // Return
  //------------------------------------------------

  return {

    success: true,

    ResidentID:
      residentID,

    CurrentMedList:
      currentMed || "",

    MedicationLastUpdated:
      medicationUpdated || ""

  };

}
/**
 * ================================================================
 * SUPABASE MEDICATION SYNC
 * ================================================================
 * Google tbl_MedicationOrder is the temporary medication master.
 * Human edits are synced near-real-time to Supabase by an installable
 * spreadsheet edit trigger. A 24-hour reconciliation is also provided
 * as a safety net for programmatic/AppSheet/bot changes, because Apps Script
 * edit triggers are not fired by changes made by other scripts/APIs/bots.
 *
 * Supabase table:
 *   public.tbl_medication_orders
 *
 * Important mapping:
 *   Google RxOrderID          -> Supabase external_ref_id (UNIQUE)
 *   Google ResidentID         -> Supabase resident_id (numeric FK)
 *   Resident branch           -> Supabase branch_id (numeric FK)
 *   Google Noted By           -> Supabase noted_by (tbl_staff.StaffID FK)
 *   Google PreviousRxOrderID  -> Supabase previous_order_id (numeric FK)
 *
 * Credentials are stored only in Apps Script Properties:
 *   SUPABASE_URL
 *   SUPABASE_API_KEY
 * ================================================================
 */

const MED_SUPABASE_CONFIG = {
  MEDICATION_SPREADSHEET_ID: CONFIG.MEDICATION_SPREADSHEET_ID,
  MEDICATION_SHEET_NAME: CONFIG.SHEETS.MEDICATION_ORDER,
  RESIDENT_SHEET_NAME: CONFIG.SHEETS.RESIDENT,
  SUPABASE_TABLE: "tbl_medication_orders",
  UNIQUE_COLUMN: "external_ref_id",
  SCRIPT_PROPERTY_URL: "SUPABASE_URL",
  SCRIPT_PROPERTY_KEY: "SUPABASE_API_KEY",
  LOG_SHEET_NAME: "tbl_MedicationSyncLog",
  // Safety reconciliation runs once every 24 hours.
  RECONCILIATION_MINUTES: 1440,
  BATCH_SIZE: 50,
  SNAPSHOT_SHEET_NAME: "_MedicationSyncSnapshot"
};

/**
 * Run once after installing/updating this file.
 *
 * Creates the edit trigger used for near-real-time user edits and the change
 * trigger used to detect physical row deletions. A hidden snapshot is also
 * initialized so RxOrderID changes/clears can be detected safely.
 */
function setupMedicationSupabaseTrigger() {
  const spreadsheetId = MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID;

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();

    if (
      handler === "onMedicationEdit" ||
      handler === "onMedicationChange"
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("onMedicationEdit")
    .forSpreadsheet(spreadsheetId)
    .onEdit()
    .create();

  ScriptApp.newTrigger("onMedicationChange")
    .forSpreadsheet(spreadsheetId)
    .onChange()
    .create();

  initializeMedicationSyncSnapshot_();

  Logger.log(
    "Medication Supabase edit/change triggers created and snapshot initialized."
  );
}

/**
 * Installable edit trigger.
 *
 * Handles normal user edits immediately. It also detects an RxOrderID being
 * changed or cleared: the old ID is removed from Supabase only after the new
 * row value has been successfully synced.
 *
 * IMPORTANT: edits made by Apps Script, API integrations, AppSheet or other
 * bots do not fire this trigger. Those changes are handled by the 24-hour
 * reconciliation safety net, or the writing bot can explicitly call
 * syncMedicationChangesToSupabase() after it writes.
 */
function onMedicationEdit(e) {
  if (!e || !e.range) return;

  const range = e.range;
  const sheet = range.getSheet();

  if (sheet.getName() !== MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME) return;
  if (range.getRow() < 2) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const previousIds = getMedicationSyncSnapshotIds_();
    const firstRow = range.getRow();
    const lastRow = range.getLastRow();
    let allSuccessful = true;

    for (let row = firstRow; row <= lastRow; row++) {
      try {
        syncMedicationSheetRowToSupabase_(sheet, row);
      } catch (err) {
        allSuccessful = false;
        logMedicationSyncError_(row, err);
        console.error(err);
      }
    }

    // Only delete old IDs after every affected row was processed successfully.
    // This prevents a transient Supabase failure from causing data loss.
    if (allSuccessful) {
      deleteMedicationIdsMissingFromSheet_(previousIds, sheet);
      updateMedicationSyncSnapshot_();
    } else {
      Logger.log(
        "Medication edit had sync errors; snapshot was retained for retry."
      );
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Installable spreadsheet change trigger.
 *
 * REMOVE_ROW is handled immediately by comparing the previous snapshot with
 * the current sheet. INSERT_ROW/INSERT_GRID simply refresh the snapshot; the
 * subsequent row edit or reconciliation will sync the actual medication data.
 */
function onMedicationChange(e) {
  if (!e || !e.changeType) return;

  const changeType = String(e.changeType).toUpperCase();

  if (changeType !== "REMOVE_ROW" &&
      changeType !== "INSERT_ROW" &&
      changeType !== "INSERT_GRID") {
    return;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(
      MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID
    );
    const sheet = ss.getSheetByName(
      MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME
    );

    if (!sheet) return;

    if (changeType === "REMOVE_ROW") {
      const previousIds = getMedicationSyncSnapshotIds_();
      deleteMedicationIdsMissingFromSheet_(previousIds, sheet);
    }

    updateMedicationSyncSnapshot_();
  } catch (err) {
    console.error(err);
    Logger.log(
      "Medication change trigger failed: " +
      (err && err.message ? err.message : String(err))
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Explicit sync entry point for bots / Apps Script / API workflows.
 *
 * If a bot writes tbl_MedicationOrder programmatically and needs the change
 * reflected immediately instead of waiting for the 24-hour reconciliation,
 * call this function after the write completes.
 */
function syncMedicationChangesToSupabase() {
  // syncAllMedicationOrdersToSupabase already owns the script lock and performs
  // both upserts and deletion reconciliation.
  return syncAllMedicationOrdersToSupabase();
}

/**
 * Create the hidden snapshot sheet if it does not exist.
 */
function initializeMedicationSyncSnapshot_() {
  const ss = SpreadsheetApp.openById(
    MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID
  );

  let snapshot = ss.getSheetByName(
    MED_SUPABASE_CONFIG.SNAPSHOT_SHEET_NAME
  );

  if (!snapshot) {
    snapshot = ss.insertSheet(
      MED_SUPABASE_CONFIG.SNAPSHOT_SHEET_NAME
    );
  }

  if (snapshot.getLastRow() === 0) {
    snapshot.getRange(1, 1).setValue("RxOrderID");
  }

  updateMedicationSyncSnapshot_();

  try {
    snapshot.hideSheet();
  } catch (err) {
    // Hiding can fail in unusual spreadsheet states; the sync itself remains valid.
    console.warn(err);
  }
}

/**
 * Read the previously known RxOrderIDs from the snapshot.
 */
function getMedicationSyncSnapshotIds_() {
  const ss = SpreadsheetApp.openById(
    MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID
  );
  const snapshot = ss.getSheetByName(
    MED_SUPABASE_CONFIG.SNAPSHOT_SHEET_NAME
  );

  if (!snapshot || snapshot.getLastRow() < 2) {
    return {};
  }

  const values = snapshot
    .getRange(2, 1, snapshot.getLastRow() - 1, 1)
    .getValues();

  const ids = {};

  values.forEach(function(row) {
    const id = cleanMedicationString_(row[0]);
    if (id) ids[id] = true;
  });

  return ids;
}

/**
 * Store the current Google RxOrderID list as the next comparison snapshot.
 */
function updateMedicationSyncSnapshot_() {
  const ss = SpreadsheetApp.openById(
    MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID
  );
  const sheet = ss.getSheetByName(
    MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME
  );

  if (!sheet) {
    throw new Error(
      "Sheet not found: " + MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME
    );
  }

  let snapshot = ss.getSheetByName(
    MED_SUPABASE_CONFIG.SNAPSHOT_SHEET_NAME
  );

  if (!snapshot) {
    snapshot = ss.insertSheet(
      MED_SUPABASE_CONFIG.SNAPSHOT_SHEET_NAME
    );
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  snapshot.clearContents();
  snapshot.getRange(1, 1).setValue("RxOrderID");

  if (lastRow < 2) return;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const rxCol = headers.indexOf("RxOrderID");

  if (rxCol === -1) {
    throw new Error("RxOrderID column not found.");
  }

  const values = sheet
    .getRange(2, rxCol + 1, lastRow - 1, 1)
    .getValues();

  const ids = [];
  const seen = {};

  values.forEach(function(row) {
    const id = cleanMedicationString_(row[0]);
    if (id && !seen[id]) {
      seen[id] = true;
      ids.push([id]);
    }
  });

  if (ids.length) {
    snapshot.getRange(2, 1, ids.length, 1).setValues(ids);
  }

  try {
    snapshot.hideSheet();
  } catch (err) {}
}

/**
 * Delete every previously known RxOrderID that no longer exists in Google.
 *
 * This catches all of these cases:
 *   1. Whole row deleted
 *   2. RxOrderID cell cleared
 *   3. RxOrderID changed from OLD -> NEW
 *
 * For OLD -> NEW, the new ID is synced first by onMedicationEdit(), then OLD
 * is removed here. For a blank RxOrderID, the old Supabase row is removed.
 */
function deleteMedicationIdsMissingFromSheet_(previousIds, sheet) {
  if (!previousIds || !sheet) return;

  const currentIds = {};
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow >= 2 && lastColumn >= 1) {
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const rxCol = headers.indexOf("RxOrderID");

    if (rxCol === -1) {
      throw new Error("RxOrderID column not found.");
    }

    const values = sheet
      .getRange(2, rxCol + 1, lastRow - 1, 1)
      .getValues();

    values.forEach(function(row) {
      const id = cleanMedicationString_(row[0]);
      if (id) currentIds[id] = true;
    });
  }

  Object.keys(previousIds).forEach(function(oldId) {
    if (currentIds[oldId]) return;

    try {
      supabaseMedicationDelete_(oldId);
      Logger.log(
        "Medication deleted from Supabase because RxOrderID disappeared from Google: " +
        oldId
      );
    } catch (err) {
      // Do not hide failures. If deletion fails, reconciliation will retry.
      console.error(err);
      throw err;
    }
  });
}

/**
 * Sync one Google medication row to Supabase.
 */
function syncMedicationSheetRowToSupabase_(sheet, rowNumber, options) {
  options = options || {};

  const lastColumn = sheet.getLastColumn();
  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0];
  const values = sheet
    .getRange(rowNumber, 1, 1, lastColumn)
    .getValues()[0];

  const rawRecord = buildMedicationSheetRecord_(headers, values);

  if (!rawRecord.rx_order_id) {
    Logger.log(
      "Medication row " + rowNumber +
      " skipped: RxOrderID is blank."
    );
    return {
      success: true,
      skipped: true,
      reason: "blank_rx_order_id",
      row: rowNumber
    };
  }

  const record = resolveMedicationForeignKeys_(rawRecord, options);
  validateResolvedMedicationRecord_(record);

  const result = supabaseMedicationUpsert_(record);

  Logger.log(
    "Medication synced: RxOrderID=" +
    record.external_ref_id +
    ", row=" + rowNumber +
    ", HTTP=" + result.status
  );

  return {
    success: true,
    row: rowNumber,
    rxOrderID: record.external_ref_id,
    residentID: record.resident_id,
    branchID: record.branch_id,
    previousOrderID: record.previous_order_id,
    status: result.status
  };
}

/**
 * Convert the exact Google medication headers into the Supabase structure.
 * Foreign keys are resolved separately after this conversion.
 */
function buildMedicationSheetRecord_(headers, values) {
  const row = {};

  headers.forEach(function(header, index) {
    row[String(header).trim()] = values[index];
  });

  return {
    rx_order_id: cleanMedicationString_(row["RxOrderID"]),
    resident_code: cleanMedicationString_(row["ResidentID"]),
    dosage_form: cleanMedicationString_(row["Dosage Form"]),
    brand_name: cleanMedicationString_(row["Brand Name"]),
    active_ingredient: cleanMedicationString_(row["Active Ingredient"]),
    dose: cleanMedicationString_(row["Dose"]),
    unit: cleanMedicationString_(row["Unit"]),
    frequency: cleanMedicationString_(row["Frequency"]),
    administration_times: cleanMedicationString_(row["Administration Times"]),
    dosing_days: cleanMedicationString_(row["Dosing Days"]),
    indication: cleanMedicationString_(row["Indication"]),
    instruction: cleanMedicationString_(row["Instruction"]),
    duration_type: cleanMedicationString_(row["Duration Type"]),
    start_date: normalizeMedicationDate_(row["Start Date"]),
    end_date: normalizeMedicationDate_(row["End Date"]),
    // "Noted By" holds either a tbl_staff StaffID (internal staff picked) or
    // a free-text name (external person entered via "Others") — there is
    // only one sheet column. resolveMedicationForeignKeys_ below tells the
    // two cases apart by looking this value up against tbl_staff.
    noted_by_raw: cleanMedicationString_(row["Noted By"]),
    ordered_by: cleanMedicationString_(row["Ordered By"]),
    supplied_by: cleanMedicationString_(row["Supplied By"]),
    status: cleanMedicationString_(row["Status"]),
    previous_rx_order_id: cleanMedicationString_(row["PreviousRxOrderID"])
  };
}

/**
 * Resolve Google-facing IDs to the actual Supabase FK values.
 *
 * ResidentID format generated by the existing resident sync is:
 *   BRANCHCODE-NUMERIC_SUPABASE_ID
 * Example:
 *   BMN-0134 -> tbl_residents.id = 134
 */
function resolveMedicationForeignKeys_(raw, options) {
  options = options || {};

  const supabase = getMedicationSupabaseConfig_();
  const record = {
    external_ref_id: raw.rx_order_id,
    resident_id: null,
    branch_id: null,
    dosage_form: raw.dosage_form,
    brand_name: raw.brand_name,
    active_ingredient: raw.active_ingredient,
    dose: raw.dose,
    unit: raw.unit,
    frequency: raw.frequency,
    administration_times: raw.administration_times,
    dosing_days: raw.dosing_days,
    indication: raw.indication,
    instruction: raw.instruction,
    duration_type: raw.duration_type,
    start_date: raw.start_date,
    end_date: raw.end_date,
    // noted_by / noted_by_external_name are filled in below, after we know
    // whether raw.noted_by_raw is a real tbl_staff.StaffID.
    noted_by: null,
    noted_by_external_name: null,
    ordered_by: raw.ordered_by,
    supplied_by: raw.supplied_by,
    status: raw.status,
    previous_order_id: null
  };

  //--------------------------------------------------------------
  // Resident + branch
  //--------------------------------------------------------------
  const resident = getMedicationResidentByGoogleID_(
    supabase,
    raw.resident_code
  );

  record.resident_id = resident.id;
  record.branch_id = resident.branch_id;

  //--------------------------------------------------------------
  // Noted By — one sheet column, two possible Supabase columns
  //--------------------------------------------------------------
  const notedBy = resolveMedicationNotedBy_(supabase, raw.noted_by_raw);
  record.noted_by = notedBy.noted_by;
  record.noted_by_external_name = notedBy.noted_by_external_name;

  //--------------------------------------------------------------
  // Previous medication revision
  //--------------------------------------------------------------
  if (raw.previous_rx_order_id) {
    record.previous_order_id = resolvePreviousMedicationOrderID_(
      supabase,
      raw.previous_rx_order_id,
      options
    );
  }

  return record;
}

/**
 * Resolve Google-facing ResidentID to the actual Supabase resident row.
 *
 * IMPORTANT:
 * Do NOT derive tbl_residents.id from the numeric suffix of ResidentID.
 *
 * Example:
 *   BMN-0145 -> tbl_residents.ResidentID = BMN-0145
 *             -> actual tbl_residents.id = 356
 *
 *   BMN-0148 -> tbl_residents.ResidentID = BMN-0148
 *             -> actual tbl_residents.id = 359
 */
function getMedicationResidentByGoogleID_(supabase, googleResidentID) {
  const value = cleanMedicationString_(googleResidentID);

  if (!value) {
    throw new Error("ResidentID is required.");
  }

  const rows = supabaseGetMedicationRows_(
    supabase,
    "tbl_residents",
    ["id", "ResidentID", "branch_id"],
    {
      ResidentID: "eq." + value
    },
    1
  );

  if (!rows.length) {
    throw new Error(
      "Resident not found in Supabase: " +
      value +
      " (matched by tbl_residents.ResidentID)"
    );
  }

  if (
    rows[0].branch_id === null ||
    rows[0].branch_id === undefined ||
    rows[0].branch_id === ""
  ) {
    throw new Error(
      "Resident " +
      value +
      " has no branch_id in Supabase tbl_residents."
    );
  }

  return rows[0];
}

/**
 * Decide whether the sheet's single "Noted By" value is an internal
 * tbl_staff.StaffID (an internal staff member was picked) or a free-text
 * name (entered via "Others" — a visiting doctor, family GP, etc).
 *
 * Looked up by an exact StaffID match rather than guessed from format,
 * since StaffID values are not distinguishable from a name by shape alone.
 */
function resolveMedicationNotedBy_(supabase, rawValue) {
  if (!rawValue) {
    return { noted_by: null, noted_by_external_name: null };
  }

  const rows = supabaseGetMedicationRows_(
    supabase,
    "tbl_staff",
    ["StaffID"],
    { StaffID: "eq." + rawValue },
    1
  );

  return rows.length
    ? { noted_by: rawValue, noted_by_external_name: null }
    : { noted_by: null, noted_by_external_name: rawValue };
}

/**
 * Resolve the Google PreviousRxOrderID to tbl_medication_orders.id.
 *
 * If the previous order is present in Google but not yet in Supabase,
 * the previous Google row is synced first. This preserves the revision
 * chain even during an initial full migration.
 */
function resolvePreviousMedicationOrderID_(
  supabase,
  previousRxOrderID,
  options
) {
  const ref = cleanMedicationString_(previousRxOrderID);

  if (!ref) return null;

  const existing = supabaseGetMedicationRows_(
    supabase,
    "tbl_medication_orders",
    ["id", "external_ref_id"],
    {
      external_ref_id: "eq." + ref
    },
    1
  );

  if (existing.length) {
    return existing[0].id;
  }

  //--------------------------------------------------------------
  // Previous order not in Supabase yet.
  // Find it in Google and sync it first.
  //--------------------------------------------------------------
  const previousRow = findMedicationRowByRxOrderID_(ref);

  if (previousRow < 2) {
    throw new Error(
      "PreviousRxOrderID not found in Supabase or Google: " +
      ref
    );
  }

  const sheet = SpreadsheetApp
    .openById(MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID)
    .getSheetByName(MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME);

  if (!sheet) {
    throw new Error(
      "Medication sheet not found: " +
      MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME
    );
  }

  const guard = options && options.visited
    ? options.visited
    : {};

  if (guard[ref]) {
    throw new Error(
      "Circular PreviousRxOrderID chain detected at: " +
      ref
    );
  }

  guard[ref] = true;

  syncMedicationSheetRowToSupabase_(
    sheet,
    previousRow,
    { visited: guard }
  );

  const synced = supabaseGetMedicationRows_(
    supabase,
    "tbl_medication_orders",
    ["id", "external_ref_id"],
    {
      external_ref_id: "eq." + ref
    },
    1
  );

  if (!synced.length) {
    throw new Error(
      "Previous medication order could not be created in Supabase: " +
      ref
    );
  }

  return synced[0].id;
}

/**
 * Find a Google medication row by RxOrderID.
 */
function findMedicationRowByRxOrderID_(rxOrderID) {
  const sheet = SpreadsheetApp
    .openById(MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID)
    .getSheetByName(MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME);

  if (!sheet || sheet.getLastRow() < 2) return -1;

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0];
  const rxCol = headers.indexOf("RxOrderID");

  if (rxCol === -1) {
    throw new Error("RxOrderID column not found in medication sheet.");
  }

  const values = sheet
    .getRange(2, rxCol + 1, sheet.getLastRow() - 1, 1)
    .getValues();

  const target = String(rxOrderID).trim();

  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === target) {
      return i + 2;
    }
  }

  return -1;
}

/**
 * Validate the final Supabase record after FK resolution.
 */
function validateResolvedMedicationRecord_(record) {
  if (!record.external_ref_id) {
    throw new Error("RxOrderID is required.");
  }

  if (!record.resident_id) {
    throw new Error(
      "Resident FK could not be resolved for RxOrderID " +
      record.external_ref_id
    );
  }

  if (!record.branch_id) {
    throw new Error(
      "Branch FK could not be resolved for RxOrderID " +
      record.external_ref_id
    );
  }

  if (!record.active_ingredient) {
    throw new Error(
      "Active Ingredient is required for RxOrderID " +
      record.external_ref_id
    );
  }

  if (!record.start_date) {
    throw new Error(
      "Start Date is required for RxOrderID " +
      record.external_ref_id
    );
  }
}

/**
 * UPSERT one medication record.
 * external_ref_id is the unique conflict key.
 */
function supabaseMedicationUpsert_(record) {
  const config = getMedicationSupabaseConfig_();

  const url =
    config.url +
    "/rest/v1/" +
    encodeURIComponent(MED_SUPABASE_CONFIG.SUPABASE_TABLE) +
    "?on_conflict=" +
    encodeURIComponent(MED_SUPABASE_CONFIG.UNIQUE_COLUMN);

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(record),
    muteHttpExceptions: true,
    headers: {
      apikey: config.apiKey,
      Prefer: "resolution=merge-duplicates,return=minimal",
      Accept: "application/json"
    }
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      "Supabase medication UPSERT failed. HTTP " +
      status +
      ": " +
      body
    );
  }

  return {
    success: true,
    status: status,
    body: body
  };
}

/**
 * Physically delete one medication order from Supabase by external_ref_id.
 */
function supabaseMedicationDelete_(rxOrderID) {
  const id = cleanMedicationString_(rxOrderID);

  if (!id) {
    throw new Error("Cannot delete medication: RxOrderID is blank.");
  }

  const config = getMedicationSupabaseConfig_();

  const url =
    config.url +
    "/rest/v1/" +
    encodeURIComponent(MED_SUPABASE_CONFIG.SUPABASE_TABLE) +
    "?" +
    encodeURIComponent(MED_SUPABASE_CONFIG.UNIQUE_COLUMN) +
    "=eq." +
    encodeURIComponent(id);

  const response = UrlFetchApp.fetch(url, {
    method: "delete",
    muteHttpExceptions: true,
    headers: {
      apikey: config.apiKey,
      Accept: "application/json",
      Prefer: "return=minimal"
    }
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      "Supabase medication DELETE failed for RxOrderID " +
      id +
      ". HTTP " +
      status +
      ": " +
      body
    );
  }

  return {
    success: true,
    status: status,
    body: body
  };
}

/**
 * Full reconciliation from Google -> Supabase.
 *
 * Rows are processed sequentially so PreviousRxOrderID relationships can
 * safely resolve to actual Supabase IDs.
 */
function syncAllMedicationOrdersToSupabase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const previousIds = getMedicationSyncSnapshotIds_();

    const sheet = SpreadsheetApp
      .openById(MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID)
      .getSheetByName(MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME);

    if (!sheet) {
      throw new Error(
        "Sheet not found: " +
        MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME
      );
    }

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastRow < 2) {
      Logger.log("No medication rows to sync.");
      return { success: true, synced: 0, failed: 0 };
    }

    const headers = sheet
      .getRange(1, 1, 1, lastColumn)
      .getValues()[0];
    const data = sheet
      .getRange(2, 1, lastRow - 1, lastColumn)
      .getValues();

    const results = [];
    const visited = {};

    for (let i = 0; i < data.length; i++) {
      const rowNumber = i + 2;
      const raw = buildMedicationSheetRecord_(headers, data[i]);

      if (!raw.rx_order_id) {
        continue;
      }

      try {
        const record = resolveMedicationForeignKeys_(raw, {
          visited: visited
        });

        validateResolvedMedicationRecord_(record);
        const response = supabaseMedicationUpsert_(record);

        results.push({
          row: rowNumber,
          rxOrderID: record.external_ref_id,
          success: true,
          status: response.status
        });
      } catch (err) {
        results.push({
          row: rowNumber,
          rxOrderID: raw.rx_order_id,
          success: false,
          error: err && err.message
            ? err.message
            : String(err)
        });

        logMedicationSyncError_(rowNumber, err);
      }
    }

    const failed = results.filter(function(item) {
      return !item.success;
    });

    Logger.log(
      "Medication reconciliation completed. Synced=" +
      (results.length - failed.length) +
      ", Failed=" +
      failed.length
    );

    if (failed.length === 0) {
      // Reconciliation is also responsible for deletions, cleared IDs and
      // changed IDs that may have been written by bots/AppSheet/scripts.
      deleteMedicationIdsMissingFromSheet_(previousIds, sheet);
      updateMedicationSyncSnapshot_();
    } else {
      Logger.log(
        "Medication reconciliation had failures; snapshot retained for retry."
      );
    }

    return {
      success: failed.length === 0,
      processed: results.length,
      synced: results.length - failed.length,
      failed: failed.length,
      results: results
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Create/replace the 24-hour reconciliation trigger.
 *
 * This is the safety net for programmatic/AppSheet/bot changes that do not
 * fire onMedicationEdit/onMedicationChange.
 */
function setupMedicationReconciliationTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (
      trigger.getHandlerFunction() ===
      "syncAllMedicationOrdersToSupabase"
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("syncAllMedicationOrdersToSupabase")
    .timeBased()
    .everyDays(1)
    .create();

  Logger.log("24-hour medication reconciliation trigger created.");
}

/**
 * Test Supabase connection and medication table access.
 */
function testMedicationSupabaseConnection() {
  const config = getMedicationSupabaseConfig_();

  const url =
    config.url +
    "/rest/v1/" +
    encodeURIComponent(MED_SUPABASE_CONFIG.SUPABASE_TABLE) +
    "?select=" +
    encodeURIComponent("id,external_ref_id") +
    "&limit=1";

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      apikey: config.apiKey,
      Accept: "application/json"
    }
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  Logger.log("Supabase medication test HTTP status: " + status);
  Logger.log("Supabase medication test response: " + body);

  if (status < 200 || status >= 300) {
    throw new Error(
      "Supabase medication table test failed. HTTP " +
      status +
      ": " +
      body
    );
  }

  return {
    success: true,
    status: status,
    body: body
  };
}

/**
 * Test the resident FK resolution only.
 */
function testMedicationResidentResolution() {
  const sheet = SpreadsheetApp
    .openById(MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID)
    .getSheetByName(MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME);

  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error("No medication data row found.");
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0];
  const values = sheet
    .getRange(2, 1, 1, sheet.getLastColumn())
    .getValues()[0];

  const raw = buildMedicationSheetRecord_(headers, values);
  const supabase = getMedicationSupabaseConfig_();
  const resident = getMedicationResidentByGoogleID_(
    supabase,
    raw.resident_code
  );

  Logger.log(JSON.stringify({
    GoogleResidentID: raw.resident_code,
    SupabaseResidentID: resident.id,
    BranchID: resident.branch_id
  }, null, 2));

  return resident;
}

/**
 * Test a single medication row without needing to edit the spreadsheet.
 */
function testFirstMedicationRowSync() {
  const sheet = SpreadsheetApp
    .openById(MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID)
    .getSheetByName(MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME);

  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error("No medication data row found.");
  }

  return syncMedicationSheetRowToSupabase_(sheet, 2);
}

/**
 * Save Supabase credentials to Apps Script Script Properties.
 * Run this manually once if the properties are not already present.
 *
 * Do NOT hard-code the secret key into source code.
 */
function setMedicationSupabaseProperties(supabaseUrl, supabaseApiKey) {
  if (!supabaseUrl || !supabaseApiKey) {
    throw new Error("Both Supabase URL and API key are required.");
  }

  PropertiesService.getScriptProperties().setProperties({
    SUPABASE_URL: String(supabaseUrl).trim().replace(/\/+$/, ""),
    SUPABASE_API_KEY: String(supabaseApiKey).trim()
  });

  Logger.log("Supabase Script Properties saved.");
}

/**
 * Read Supabase credentials from Script Properties.
 */
function getMedicationSupabaseConfig_() {
  const props = PropertiesService.getScriptProperties();

  const url = String(
    props.getProperty(MED_SUPABASE_CONFIG.SCRIPT_PROPERTY_URL) || ""
  ).trim();

  const apiKey = String(
    props.getProperty(MED_SUPABASE_CONFIG.SCRIPT_PROPERTY_KEY) || ""
  ).trim();

  if (!url) {
    throw new Error(
      "Missing Script Property: " +
      MED_SUPABASE_CONFIG.SCRIPT_PROPERTY_URL
    );
  }

  if (!apiKey) {
    throw new Error(
      "Missing Script Property: " +
      MED_SUPABASE_CONFIG.SCRIPT_PROPERTY_KEY
    );
  }

  return {
    url: url.replace(/\/+$/, ""),
    apiKey: apiKey
  };
}

/**
 * Generic Supabase GET helper for this medication module.
 * filters is an object such as { id: "eq.134" }.
 */
function supabaseGetMedicationRows_(
  supabase,
  tableName,
  selectColumns,
  filters,
  limit
) {
  let query =
    "?select=" +
    encodeURIComponent(selectColumns.join(","));

  Object.keys(filters || {}).forEach(function(key) {
    query +=
      "&" +
      encodeURIComponent(key) +
      "=" +
      encodeURIComponent(String(filters[key]));
  });

  if (limit) {
    query += "&limit=" + encodeURIComponent(String(limit));
  }

  const url =
    supabase.url +
    "/rest/v1/" +
    encodeURIComponent(tableName) +
    query;

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      apikey: supabase.apiKey,
      Accept: "application/json"
    }
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      "Supabase GET failed for " +
      tableName +
      ". HTTP " +
      status +
      ": " +
      body
    );
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch (err) {
    throw new Error(
      "Supabase returned invalid JSON for " +
      tableName +
      ": " +
      err
    );
  }

  if (!Array.isArray(data)) {
    throw new Error(
      "Unexpected Supabase response for " +
      tableName +
      ". Expected an array."
    );
  }

  return data;
}

/**
 * Normalize dates for Postgres date columns.
 */
function normalizeMedicationDate_(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) return null;

    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone() || "Asia/Kuala_Lumpur",
      "yyyy-MM-dd"
    );
  }

  const text = String(value).trim();
  if (!text) return null;

  // If Google already supplies an ISO date, keep it unchanged.
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // The sheet stores Start Date/End Date as DD/MM/YYYY (e.g. 17/09/2026).
  // Parse this explicitly rather than via `new Date(text)` — JS Date
  // parsing of slash-separated dates is locale-dependent and would silently
  // misread DD/MM/YYYY as MM/DD/YYYY.
  const dmyMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmyMatch) return dmyMatch[3] + "-" + dmyMatch[2] + "-" + dmyMatch[1];

  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) {
    throw new Error("Invalid medication date: " + text);
  }

  return Utilities.formatDate(
    parsed,
    Session.getScriptTimeZone() || "Asia/Kuala_Lumpur",
    "yyyy-MM-dd"
  );
}

function cleanMedicationString_(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * Log sync errors without changing tbl_MedicationOrder itself.
 */
function logMedicationSyncError_(rowNumber, error) {
  try {
    const ss = SpreadsheetApp.openById(
      MED_SUPABASE_CONFIG.MEDICATION_SPREADSHEET_ID
    );

    let sheet = ss.getSheetByName(
      MED_SUPABASE_CONFIG.LOG_SHEET_NAME
    );

    if (!sheet) {
      sheet = ss.insertSheet(
        MED_SUPABASE_CONFIG.LOG_SHEET_NAME
      );

      sheet.appendRow([
        "Timestamp",
        "Row",
        "RxOrderID",
        "Error"
      ]);
    }

    let rxOrderID = "";

    try {
      const headers = sheet
        .getParent()
        .getSheetByName(MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME)
        .getRange(1, 1, 1, 20)
        .getValues()[0];

      const rxCol = headers.indexOf("RxOrderID");

      if (rxCol !== -1) {
        rxOrderID = String(
          sheet
            .getParent()
            .getSheetByName(MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME)
            .getRange(rowNumber, rxCol + 1)
            .getValue() || ""
        );
      }
    } catch (ignore) {}

    sheet.appendRow([
      new Date(),
      rowNumber,
      rxOrderID,
      error && error.message
        ? error.message
        : String(error)
    ]);
  } catch (logError) {
    console.error(
      "Unable to write medication sync log: " +
      logError
    );
  }
}

function testMedicationResidentLookupByID() {
  const supabase = getMedicationSupabaseConfig_();

  const resident145 = getMedicationResidentByGoogleID_(
    supabase,
    "BMN-0145"
  );

  const resident148 = getMedicationResidentByGoogleID_(
    supabase,
    "BMN-0148"
  );

  Logger.log(
    JSON.stringify(
      {
        BMN_0145: resident145,
        BMN_0148: resident148
      },
      null,
      2
    )
  );

  return {
    BMN_0145: resident145,
    BMN_0148: resident148
  };
}
