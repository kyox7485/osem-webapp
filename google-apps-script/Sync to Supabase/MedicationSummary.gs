/**
 * ================================================================
 * OSEM MEDICATION SUMMARY - SUPABASE RESIDENT MASTER
 * ================================================================
 *
 * PURPOSE
 * -------
 * 1. Supabase tbl_residents is the resident MASTER.
 * 2. Supabase tbl_medication_orders is the medication-order source.
 * 3. Current medication summaries are compiled FROM SUPABASE, not from
 *    the Google resident list.
 * 4. The compiled summary is written back to:
 *      - Supabase tbl_residents.current_medication_list
 *      - Google tbl_ResidentList.CurrentMedList
 *      - Google tbl_ResidentList.MedicationLastUpdated
 *
 * MEDICATION ORDER SOURCE
 * -----------------------
 * Google tbl_MedicationOrder remains the medication-entry sheet.
 * svgMedicationSync.gs synchronizes its changes to Supabase.
 *
 * CHANGE HANDLING
 * ---------------
 * Manual Google edits:
 *   onMedicationSummaryEdit -> sync orders -> rebuild affected residents
 *
 * Google row structure changes:
 *   onMedicationSummaryChange -> sync orders -> rebuild summaries
 *
 * Bot / Apps Script / API writes:
 *   These do NOT fire Google onEdit/onChange triggers. A 1-minute heartbeat
 *   fingerprints tbl_MedicationOrder and automatically detects changes.
 *   It then runs the same Google -> Supabase sync and rebuilds summaries.
 *
 * For a bot/script that requires immediate completion without waiting for the
 * heartbeat, call:
 *   syncMedicationOrderAndSummaryNow()
 * after the bot/script finishes writing tbl_MedicationOrder.
 *
 * IMPORTANT DEPENDENCIES
 * ----------------------
 * This file intentionally reuses existing functions from the other OSEM
 * Apps Script files:
 *   CONFIG
 *   getSystemSheet()
 *   getMedicationSheet()
 *   getMedicationPriority()
 *   getMedicationSupabaseConfig_()
 *   supabaseGetMedicationRows_()
 *   syncMedicationChangesToSupabase()
 *
 * Do NOT duplicate those functions in this file.
 * ================================================================
 */

const MED_SUMMARY_CONFIG = {
  RESIDENT_SHEET_NAME: "tbl_ResidentList",
  MEDICATION_SHEET_NAME: "tbl_MedicationOrder",
  SUPABASE_RESIDENT_TABLE: "tbl_residents",
  SUPABASE_MEDICATION_TABLE: "tbl_medication_orders",
  GOOGLE_RESIDENT_ID_HEADER: "ResidentID",
  GOOGLE_CURRENT_MED_HEADER: "CurrentMedList",
  GOOGLE_MED_UPDATED_HEADER: "MedicationLastUpdated",
  SUPABASE_RESIDENT_ID_COLUMN: "id",
  SUPABASE_RESIDENT_CODE_COLUMN: "ResidentID",
  SUPABASE_CURRENT_MED_COLUMN: "current_medication_list",
  HEARTBEAT_PROPERTY: "OSEM_MEDICATION_SUMMARY_FINGERPRINT"
};


/**
 * Rebuild the current medication summary for ONE resident.
 *
 * residentID may be the Google-facing ResidentID, e.g. AMN-138 / BMN-0134.
 * The resident is resolved against Supabase tbl_residents.
 */
function rebuildCurrentMedication(residentID) {
  const targetResidentID = String(residentID || "").trim();

  if (!targetResidentID) {
    throw new Error("ResidentID is required.");
  }

  const supabase = getMedicationSupabaseConfig_();
  const residents = medSummaryGetSupabaseRows_(
    supabase,
    MED_SUMMARY_CONFIG.SUPABASE_RESIDENT_TABLE,
    [
      "id",
      "ResidentID",
      "current_medication_list"
    ],
    {
      ResidentID: "eq." + targetResidentID
    },
    1
  );

  if (!residents.length) {
    throw new Error(
      "Resident not found in Supabase tbl_residents: " + targetResidentID
    );
  }

  const resident = residents[0];
  const summary = buildMedicationSummaryFromSupabase_(supabase, resident.id);

  // Supabase is the resident master, so update the master first.
  medSummaryUpdateSupabaseResidentSummary_(
    supabase,
    resident.id,
    summary
  );

  // Google ResidentList is only the mirror/display layer.
  medSummaryUpdateGoogleResidentSummary_(
    targetResidentID,
    summary
  );

  Logger.log(
    "Medication summary rebuilt: " +
    targetResidentID +
    " | medications=" +
    summary.medicationCount
  );

  return {
    success: true,
    ResidentID: targetResidentID,
    medicationCount: summary.medicationCount,
    CurrentMedList: summary.text,
    MedicationLastUpdated: summary.updatedAt
  };
}


/**
 * Rebuild ALL resident medication summaries from Supabase.
 *
 * This is the main reconciliation/repair function.
 */
function rebuildAllCurrentMedications() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const supabase = getMedicationSupabaseConfig_();

    const residents = medSummaryGetSupabaseRows_(
      supabase,
      MED_SUMMARY_CONFIG.SUPABASE_RESIDENT_TABLE,
      [
        "id",
        "ResidentID",
        "current_medication_list"
      ],
      {},
      null
    );

    if (!residents.length) {
      Logger.log("No residents found in Supabase.");
      return {
        success: true,
        residentsProcessed: 0,
        summariesChanged: 0
      };
    }

    const allOrders = medSummaryGetSupabaseRows_(
      supabase,
      MED_SUMMARY_CONFIG.SUPABASE_MEDICATION_TABLE,
      [
        "id",
        "external_ref_id",
        "resident_id",
        "dosage_form",
        "brand_name",
        "active_ingredient",
        "dose",
        "unit",
        "frequency",
        "instruction",
        "status",
        "previous_order_id"
      ],
      {},
      null
    );

    const result = medSummaryBuildAllSummaries_(residents, allOrders);
    const updatedAt = new Date();

    let summariesChanged = 0;

    result.residents.forEach(function(resident) {
      const oldText = String(
        resident.current_medication_list || ""
      ).trim();
      const newText = String(resident.summary || "").trim();

      if (oldText !== newText) {
        medSummaryUpdateSupabaseResidentSummary_(
          supabase,
          resident.id,
          {
            text: newText,
            updatedAt: updatedAt,
            medicationCount: resident.medicationCount
          }
        );
        summariesChanged++;
      }
    });

    medSummaryWriteAllGoogleSummaries_(result.residents, updatedAt);

    Logger.log(
      "All medication summaries rebuilt. Residents=" +
      result.residents.length +
      ", changed=" +
      summariesChanged
    );

    return {
      success: true,
      residentsProcessed: result.residents.length,
      summariesChanged: summariesChanged
    };
  } finally {
    lock.releaseLock();
  }
}


/**
 * Immediate entry point for bots / Apps Script / API workflows.
 *
 * Use this after a bot/script writes tbl_MedicationOrder.
 * It does not rely on an edit trigger.
 */
function syncMedicationOrderAndSummaryNow(rxOrderID, residentID) {
  const rx = String(rxOrderID || "").trim();
  const currentResidentID = String(residentID || "").trim();

  if (!rx) {
    throw new Error("RxOrderID is required for targeted medication sync.");
  }

  const sheet = getMedicationSheet(
    MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME
  );

  if (!sheet) {
    throw new Error(
      "Medication sheet not found: " +
      MED_SUPABASE_CONFIG.MEDICATION_SHEET_NAME
    );
  }

  const supabase = getMedicationSupabaseConfig_();

  /*
   * First find the existing Supabase order.
   *
   * This lets us detect a ResidentID change without requiring AppSheet
   * to send [_THISROW_BEFORE].[ResidentID].
   */
  const existingRows = supabaseGetMedicationRows_(
    supabase,
    MED_SUPABASE_CONFIG.SUPABASE_TABLE,
    [
      "id",
      "external_ref_id",
      "resident_id"
    ],
    {
      external_ref_id: "eq." + rx
    },
    1
  );

  let oldResidentID = "";

  if (existingRows.length) {
    oldResidentID = getMedicationGoogleResidentIDBySupabaseID_(
      supabase,
      existingRows[0].resident_id
    );
  }

  const rowNumber = findMedicationRowByRxOrderID_(rx);

  let syncResult;

  if (rowNumber > 0) {
    /*
     * Existing/new order is present in Google.
     * Sync only this one row.
     */
    syncResult = syncMedicationSheetRowToSupabase_(
      sheet,
      rowNumber
    );
  } else {
    /*
     * The order was deleted from Google/AppSheet.
     * Mirror the deletion to Supabase.
     */
    if (existingRows.length) {
      const deleteResult = supabaseMedicationDeleteByExternalRef_(
        rx
      );

      syncResult = {
        success: true,
        deleted: true,
        rxOrderID: rx,
        status: deleteResult.status
      };
    } else {
      syncResult = {
        success: true,
        deleted: false,
        rxOrderID: rx,
        reason: "already_absent"
      };
    }
  }

  /*
   * Rebuild only residents actually affected.
   *
   * For a normal add/edit, this is the current resident.
   * If an order moved resident, rebuild both old and new residents.
   * For deletion, oldResidentID is the affected resident.
   */
  const residentsToRebuild = {};

  if (currentResidentID) {
    residentsToRebuild[currentResidentID] = true;
  }

  if (oldResidentID) {
    residentsToRebuild[oldResidentID] = true;
  }

  /*
   * If the webhook did not provide ResidentID (for example a delete),
   * use the old resident discovered from Supabase.
   */
  if (!currentResidentID && oldResidentID) {
    residentsToRebuild[oldResidentID] = true;
  }

  const summaries = [];

  Object.keys(residentsToRebuild).forEach(function(targetResidentID) {
    summaries.push(
      rebuildCurrentMedication(targetResidentID)
    );
  });

  /*
   * Keep the heartbeat fingerprint current so the same AppSheet change
   * is not unnecessarily processed again by the 1-minute detector.
   */
  try {
    medSummarySaveCurrentFingerprint_();
  } catch (fingerprintErr) {
    console.error(
      "Could not update medication heartbeat fingerprint: " +
      fingerprintErr
    );
  }

  return {
    success: true,
    targeted: true,
    RxOrderID: rx,
    ResidentID: currentResidentID || oldResidentID || "",
    previousResidentID: oldResidentID || "",
    medicationSync: syncResult,
    summaries: summaries
  };
}


/**
 * Convert Supabase numeric resident ID back to the Google-facing
 * ResidentID, e.g. 134 -> BMN-0134.
 *
 * This is used only when an existing medication order is found in
 * Supabase before an edit/delete.
 */
function getMedicationGoogleResidentIDBySupabaseID_(
  supabase,
  residentNumericID
) {
  if (
    residentNumericID === null ||
    residentNumericID === undefined ||
    String(residentNumericID).trim() === ""
  ) {
    return "";
  }

  const residents = supabaseGetMedicationRows_(
    supabase,
    "tbl_residents",
    [
      "id",
      "ResidentID"
    ],
    {
      id: "eq." + String(residentNumericID)
    },
    1
  );

  if (!residents.length) {
    return "";
  }

  return String(
    residents[0].ResidentID || ""
  ).trim();
}


/**
 * Delete one medication order from Supabase by its Google RxOrderID.
 *
 * This is intentionally separate from the full reconciliation delete
 * logic. The 24-hour reconciliation remains responsible for detecting
 * unexpected/missed deletions.
 */
function supabaseMedicationDeleteByExternalRef_(rxOrderID) {
  const config = getMedicationSupabaseConfig_();

  const url =
    config.url +
    "/rest/v1/" +
    encodeURIComponent(
      MED_SUPABASE_CONFIG.SUPABASE_TABLE
    ) +
    "?external_ref_id=eq." +
    encodeURIComponent(String(rxOrderID).trim());

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
      "Supabase medication DELETE failed. HTTP " +
      status +
      ": " +
      body
    );
  }

  Logger.log(
    "Medication deleted from Supabase: RxOrderID=" +
    String(rxOrderID).trim() +
    ", HTTP=" +
    status
  );

  return {
    success: true,
    status: status,
    body: body
  };
}




/**
 * Install all summary triggers.
 * Run this ONCE after replacing MedicationSummary.gs.
 *
 * Creates:
 *   1. onMedicationSummaryEdit - manual edits
 *   2. onMedicationSummaryChange - row insert/delete/structural changes
 *   3. medicationSummaryHeartbeat - every 1 minute for bot/script changes
 */
function setupMedicationSummaryTrigger() {
  const handlers = [
    "onMedicationSummaryEdit",
    "onMedicationSummaryChange",
    "medicationSummaryHeartbeat"
  ];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const spreadsheetId = CONFIG.MEDICATION_SPREADSHEET_ID;

  ScriptApp.newTrigger("onMedicationSummaryEdit")
    .forSpreadsheet(spreadsheetId)
    .onEdit()
    .create();

  ScriptApp.newTrigger("onMedicationSummaryChange")
    .forSpreadsheet(spreadsheetId)
    .onChange()
    .create();

  ScriptApp.newTrigger("medicationSummaryHeartbeat")
    .timeBased()
    .everyMinutes(1)
    .create();

  medSummarySaveCurrentFingerprint_();

  Logger.log(
    "Medication summary triggers created: edit + change + 1-minute heartbeat."
  );
}


/**
 * Manual spreadsheet edit trigger.
 *
 * The existing svgMedicationSync trigger also sees the edit. The shared
 * script lock prevents the two sync operations from corrupting each other.
 */
function onMedicationSummaryEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (
    sheet.getName() !==
    MED_SUMMARY_CONFIG.MEDICATION_SHEET_NAME
  ) {
    return;
  }

  if (e.range.getRow() < 2) return;

  try {
    // Sync the order first, then compile FROM SUPABASE.
    syncMedicationChangesToSupabase();

    // Rebuild all summaries because an edit to PreviousRxOrderID or RxOrderID
    // can change the effective current medication for more than one order.
    rebuildAllCurrentMedications();
    medSummarySaveCurrentFingerprint_();
  } catch (err) {
    console.error(err);
    throw err;
  }
}


/**
 * Spreadsheet structural-change trigger.
 *
 * Particularly important for REMOVE_ROW because an edit event cannot provide
 * the deleted row's values. svgMedicationSync handles the order deletion;
 * this handler then rebuilds the summaries from the resulting Supabase data.
 */
function onMedicationSummaryChange(e) {
  if (!e || !e.changeType) return;

  const changeType = String(e.changeType).toUpperCase();
  const relevant = [
    "REMOVE_ROW",
    "INSERT_ROW",
    "INSERT_GRID",
    "REMOVE_GRID"
  ];

  if (relevant.indexOf(changeType) === -1) return;

  try {
    syncMedicationChangesToSupabase();
    rebuildAllCurrentMedications();
    medSummarySaveCurrentFingerprint_();
  } catch (err) {
    console.error(err);
    throw err;
  }
}


/**
 * One-minute automatic detector for programmatic changes.
 *
 * Google Apps Script does not fire onEdit/onChange when another script,
 * AppSheet, API, or bot writes to the spreadsheet. This heartbeat detects
 * those changes by comparing a fingerprint of tbl_MedicationOrder.
 */
function medicationSummaryHeartbeat() {
  try {
    const currentFingerprint = medSummaryGetMedicationSheetFingerprint_();
    const properties = PropertiesService.getScriptProperties();
    const previousFingerprint = properties.getProperty(
      MED_SUMMARY_CONFIG.HEARTBEAT_PROPERTY
    );

    if (!previousFingerprint) {
      properties.setProperty(
        MED_SUMMARY_CONFIG.HEARTBEAT_PROPERTY,
        currentFingerprint
      );
      return;
    }

    if (currentFingerprint === previousFingerprint) {
      return;
    }

    Logger.log(
      "Medication heartbeat detected a programmatic sheet change."
    );

    // syncMedicationChangesToSupabase() owns the script lock.
    syncMedicationChangesToSupabase();
    rebuildAllCurrentMedications();

    properties.setProperty(
      MED_SUMMARY_CONFIG.HEARTBEAT_PROPERTY,
      medSummaryGetMedicationSheetFingerprint_()
    );
  } catch (err) {
    // Do NOT advance the fingerprint when synchronization fails. The next
    // heartbeat will retry the same change.
    console.error(err);
  }
}


/**
 * Internal unlocked version. Caller must already own the script lock.
 */
function rebuildAllCurrentMedicationsUnlocked_() {
  const supabase = getMedicationSupabaseConfig_();

  const residents = medSummaryGetSupabaseRows_(
    supabase,
    MED_SUMMARY_CONFIG.SUPABASE_RESIDENT_TABLE,
    [
      "id",
      "ResidentID",
      "current_medication_list"
    ],
    {},
    null
  );

  const allOrders = medSummaryGetSupabaseRows_(
    supabase,
    MED_SUMMARY_CONFIG.SUPABASE_MEDICATION_TABLE,
    [
      "id",
      "external_ref_id",
      "resident_id",
      "dosage_form",
      "brand_name",
      "active_ingredient",
      "dose",
      "unit",
      "frequency",
      "instruction",
      "status",
      "previous_order_id"
    ],
    {},
    null
  );

  const result = medSummaryBuildAllSummaries_(residents, allOrders);
  const updatedAt = new Date();

  result.residents.forEach(function(resident) {
    const oldText = String(
      resident.current_medication_list || ""
    ).trim();
    const newText = String(resident.summary || "").trim();

    if (oldText !== newText) {
      medSummaryUpdateSupabaseResidentSummary_(
        supabase,
        resident.id,
        {
          text: newText,
          updatedAt: updatedAt,
          medicationCount: resident.medicationCount
        }
      );
    }
  });

  medSummaryWriteAllGoogleSummaries_(result.residents, updatedAt);

  return {
    success: true,
    residentsProcessed: result.residents.length
  };
}


/**
 * Build one resident's summary directly from Supabase medication orders.
 */
function medSummaryFilterActiveOrders_(orders) {
  const supersededOrders = {};

  orders.forEach(function(order) {
    if (
      order.previous_order_id !== null &&
      order.previous_order_id !== undefined &&
      String(order.previous_order_id).trim() !== ""
    ) {
      const previousOrder = orders.find(function(candidate) {
        return String(candidate.id) === String(order.previous_order_id);
      });

      if (previousOrder && previousOrder.external_ref_id) {
        supersededOrders[
          String(previousOrder.external_ref_id).trim()
        ] = true;
      }
    }
  });

  return orders.filter(function(order) {
    if (
      String(order.status || "")
        .trim()
        .toUpperCase() !== "ACTIVE"
    ) {
      return false;
    }

    const rxOrderID = String(order.external_ref_id || "").trim();
    if (!rxOrderID) return false;

    if (supersededOrders[rxOrderID]) return false;

    return true;
  });
}

function buildMedicationSummaryFromSupabase_(supabase, residentNumericID) {
  const orders = medSummaryGetSupabaseRows_(
    supabase,
    MED_SUMMARY_CONFIG.SUPABASE_MEDICATION_TABLE,
    [
      "id",
      "external_ref_id",
      "resident_id",
      "dosage_form",
      "brand_name",
      "active_ingredient",
      "dose",
      "unit",
      "frequency",
      "instruction",
      "status",
      "previous_order_id"
    ],
    {
      resident_id: "eq." + String(residentNumericID)
    },
    null
  );

  return medSummaryBuildSummaryFromOrders_(
    medSummaryFilterActiveOrders_(orders)
  );
}
function medSummaryBuildAllSummaries_(residents, orders) {
  const byResident = {};

  // Superseded order IDs are derived from the revision chain.
  // We keep this global set to preserve the behavior of the existing summary
  // logic, while only applying orders to their own resident.
  const supersededOrders = {};

  orders.forEach(function(order) {
    if (
      order.previous_order_id !== null &&
      order.previous_order_id !== undefined &&
      String(order.previous_order_id).trim() !== ""
    ) {
      const previousOrder = orders.find(function(candidate) {
        return String(candidate.id) === String(order.previous_order_id);
      });

      if (previousOrder && previousOrder.external_ref_id) {
        supersededOrders[
          String(previousOrder.external_ref_id).trim()
        ] = true;
      }
    }
  });

  residents.forEach(function(resident) {
    byResident[String(resident.id)] = [];
  });

  orders.forEach(function(order) {
    const residentKey = String(order.resident_id);

    if (!byResident[residentKey]) return;

    if (
      String(order.status || "")
        .trim()
        .toUpperCase() !== "ACTIVE"
    ) {
      return;
    }

    const rxOrderID = String(
      order.external_ref_id || ""
    ).trim();

    if (!rxOrderID) return;

    if (supersededOrders[rxOrderID]) return;

    byResident[residentKey].push(order);
  });

  const output = residents.map(function(resident) {
    const summary = medSummaryBuildSummaryFromOrders_(
      byResident[String(resident.id)] || []
    );

    return {
      id: resident.id,
      ResidentID: resident.ResidentID,
      current_medication_list: resident.current_medication_list,
      summary: summary.text,
      medicationCount: summary.medicationCount
    };
  });

  return {
    residents: output
  };
}


/**
 * Build the exact formatted medication summary used by OSEM.
 */
function medSummaryBuildSummaryFromOrders_(orders) {
  const medicationList = [];

  orders.forEach(function(order) {
    let line = "";

    if (order.dosage_form) {
      line += order.dosage_form + " ";
    }

    if (order.brand_name) {
      line += order.brand_name + " ";
    } else if (order.active_ingredient) {
      line += order.active_ingredient + " ";
    }

    if (order.dose) {
      line += order.dose + " ";
    }

    if (order.unit) {
      line += order.unit + " ";
    }

    if (order.frequency) {
      line += order.frequency;
    }

    if (order.instruction) {
      line += " (" + order.instruction + ")";
    }

    const priority = getMedicationPriority(
      order.dosage_form,
      order.frequency
    );

    medicationList.push({
      section: priority.section,
      priority: priority.priority,
      text: line.trim()
    });
  });

  medicationList.sort(function(a, b) {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    return String(a.text).localeCompare(String(b.text));
  });

  let summary = "";
  let currentSection = "";

  medicationList.forEach(function(medication) {
    if (medication.section !== currentSection) {
      if (summary !== "") {
        summary += "\n\n";
      }

      summary += "【 " + medication.section + " 】\n";
      currentSection = medication.section;
    }

    summary += "• " + medication.text + "\n";
  });

  return {
    text: summary.trim(),
    medicationCount: medicationList.length
  };
}


/**
 * Update Supabase tbl_residents.current_medication_list.
 *
 * No assumed Supabase timestamp column is used here because the existing
 * resident schema already has current_medication_list, while the Google
 * mirror retains MedicationLastUpdated for the existing API consumers.
 */
function medSummaryUpdateSupabaseResidentSummary_(
  supabase,
  residentNumericID,
  summary
) {
  const url =
    supabase.url +
    "/rest/v1/" +
    encodeURIComponent(
      MED_SUMMARY_CONFIG.SUPABASE_RESIDENT_TABLE
    ) +
    "?id=eq." +
    encodeURIComponent(String(residentNumericID));

  const payload = {
    current_medication_list: String(summary.text || "")
  };

  const response = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: {
      apikey: supabase.apiKey,
      Prefer: "return=minimal",
      Accept: "application/json"
    }
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      "Supabase resident medication summary UPDATE failed. HTTP " +
      status + ": " + body
    );
  }
}


/**
 * Write the Supabase-master summary to the Google resident mirror.
 */
function medSummaryUpdateGoogleResidentSummary_(residentID, summary) {
  const sheet = getSystemSheet(
    MED_SUMMARY_CONFIG.RESIDENT_SHEET_NAME
  );

  if (!sheet) {
    throw new Error(
      "Resident sheet not found: " +
      MED_SUMMARY_CONFIG.RESIDENT_SHEET_NAME
    );
  }

  const headers = getHeaders(sheet);
  const residentIDCol = headers.indexOf(
    MED_SUMMARY_CONFIG.GOOGLE_RESIDENT_ID_HEADER
  );
  const currentMedCol = headers.indexOf(
    MED_SUMMARY_CONFIG.GOOGLE_CURRENT_MED_HEADER
  );
  const updatedCol = headers.indexOf(
    MED_SUMMARY_CONFIG.GOOGLE_MED_UPDATED_HEADER
  );

  if (residentIDCol === -1) {
    throw new Error("Google ResidentID column not found.");
  }

  if (currentMedCol === -1) {
    throw new Error("Google CurrentMedList column not found.");
  }

  if (updatedCol === -1) {
    throw new Error(
      "Google MedicationLastUpdated column not found."
    );
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const values = sheet
    .getRange(2, residentIDCol + 1, lastRow - 1, 1)
    .getValues();

  for (let i = 0; i < values.length; i++) {
    if (
      String(values[i][0]).trim() ===
      String(residentID).trim()
    ) {
      const row = i + 2;
      const existing = String(
        sheet.getRange(row, currentMedCol + 1).getValue() || ""
      ).trim();
      const next = String(summary.text || "").trim();

      if (existing !== next) {
        sheet
          .getRange(row, currentMedCol + 1)
          .setValue(next);

        sheet
          .getRange(row, updatedCol + 1)
          .setValue(summary.updatedAt || new Date());
      }

      return;
    }
  }

  // A resident may exist in Supabase before the Google mirror has caught up.
  // Do not create a partial resident record here; the resident sync owns that.
  Logger.log(
    "Google resident mirror not found; summary remains in Supabase: " +
    residentID
  );
}


/**
 * Bulk Google mirror update.
 */
function medSummaryWriteAllGoogleSummaries_(residents, updatedAt) {
  const sheet = getSystemSheet(
    MED_SUMMARY_CONFIG.RESIDENT_SHEET_NAME
  );

  if (!sheet || sheet.getLastRow() < 2) return;

  const headers = getHeaders(sheet);
  const residentIDCol = headers.indexOf(
    MED_SUMMARY_CONFIG.GOOGLE_RESIDENT_ID_HEADER
  );
  const currentMedCol = headers.indexOf(
    MED_SUMMARY_CONFIG.GOOGLE_CURRENT_MED_HEADER
  );
  const updatedCol = headers.indexOf(
    MED_SUMMARY_CONFIG.GOOGLE_MED_UPDATED_HEADER
  );

  if (
    residentIDCol === -1 ||
    currentMedCol === -1 ||
    updatedCol === -1
  ) {
    throw new Error(
      "Google resident mirror is missing ResidentID, CurrentMedList or MedicationLastUpdated."
    );
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const data = sheet
    .getRange(2, 1, lastRow - 1, lastColumn)
    .getValues();

  const summaryByResident = {};
  residents.forEach(function(resident) {
    summaryByResident[
      String(resident.ResidentID).trim()
    ] = String(resident.summary || "").trim();
  });

  let changed = false;

  for (let i = 0; i < data.length; i++) {
    const residentID = String(
      data[i][residentIDCol] || ""
    ).trim();

    if (!Object.prototype.hasOwnProperty.call(
      summaryByResident,
      residentID
    )) {
      continue;
    }

    const next = summaryByResident[residentID];
    const current = String(
      data[i][currentMedCol] || ""
    ).trim();

    if (current !== next) {
      data[i][currentMedCol] = next;
      data[i][updatedCol] = updatedAt;
      changed = true;
    }
  }

  if (changed) {
    sheet
      .getRange(2, 1, data.length, lastColumn)
      .setValues(data);
  }
}


/**
 * Existing API-compatible getter.
 * It now reads the resident's medication summary from Supabase master.
 */
function getMedicationByResident(residentID) {
  const target = String(residentID || "").trim();

  if (!target) {
    return {
      success: false,
      error: "ResidentID is required."
    };
  }

  const supabase = getMedicationSupabaseConfig_();
  const rows = medSummaryGetSupabaseRows_(
    supabase,
    MED_SUMMARY_CONFIG.SUPABASE_RESIDENT_TABLE,
    [
      "id",
      "ResidentID",
      "current_medication_list"
    ],
    {
      ResidentID: "eq." + target
    },
    1
  );

  if (!rows.length) {
    return {
      success: false,
      error: "Resident not found: " + target
    };
  }

  return {
    success: true,
    ResidentID: rows[0].ResidentID,
    CurrentMedList: rows[0].current_medication_list || "",
    MedicationLastUpdated: ""
  };
}


/**
 * Existing API-compatible bulk getter.
 *
 * MedicationLastUpdated remains a Google-mirror timestamp because the current
 * Supabase resident schema used by this project has current_medication_list
 * but no verified medication_last_updated column.
 */
function getMedicationUpdates(lastSync) {
  const residentSheet = getSystemSheet(
    MED_SUMMARY_CONFIG.RESIDENT_SHEET_NAME
  );

  const data = residentSheet.getDataRange().getValues();
  if (!data.length) return [];

  const header = data[0];
  const residentIDCol = header.indexOf(
    MED_SUMMARY_CONFIG.GOOGLE_RESIDENT_ID_HEADER
  );
  const medCol = header.indexOf(
    MED_SUMMARY_CONFIG.GOOGLE_CURRENT_MED_HEADER
  );
  const updatedCol = header.indexOf(
    MED_SUMMARY_CONFIG.GOOGLE_MED_UPDATED_HEADER
  );

  if (
    residentIDCol === -1 ||
    medCol === -1 ||
    updatedCol === -1
  ) {
    throw new Error(
      "Google resident mirror is missing required medication columns."
    );
  }

  const lastSyncTime = new Date(lastSync).getTime();
  if (isNaN(lastSyncTime)) {
    throw new Error("Invalid lastSync value: " + lastSync);
  }

  const results = [];

  for (let i = 1; i < data.length; i++) {
    const updated = data[i][updatedCol];
    if (!updated) continue;

    const updatedTime = new Date(updated).getTime();
    if (isNaN(updatedTime)) continue;

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


/**
 * Test ONE resident summary.
 */
function testRebuildMedication() {
  return rebuildCurrentMedication("AMN-138");
}


/**
 * Test ALL summaries.
 */
function testRebuildAllMedications() {
  return rebuildAllCurrentMedications();
}


/**
 * Supabase GET helper used only by MedicationSummary.gs.
 */
function medSummaryGetSupabaseRows_(
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

  if (limit !== null && limit !== undefined) {
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
      status + ": " + body
    );
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch (err) {
    throw new Error(
      "Invalid JSON returned by Supabase for " +
      tableName + ": " + err
    );
  }

  if (!Array.isArray(data)) {
    throw new Error(
      "Unexpected Supabase response for " +
      tableName + ". Expected an array."
    );
  }

  return data;
}


/**
 * Fingerprint the complete medication-order sheet.
 * This catches edits made by scripts, AppSheet and bots that do not fire
 * spreadsheet edit/change triggers.
 */
function medSummaryGetMedicationSheetFingerprint_() {
  const sheet = getMedicationSheet(
    MED_SUMMARY_CONFIG.MEDICATION_SHEET_NAME
  );

  if (!sheet) {
    throw new Error(
      "Medication sheet not found: " +
      MED_SUMMARY_CONFIG.MEDICATION_SHEET_NAME
    );
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 1 || lastColumn < 1) {
    return "EMPTY";
  }

  const values = sheet
    .getRange(1, 1, lastRow, lastColumn)
    .getValues();

  const normalized = values.map(function(row) {
    return row.map(function(value) {
      if (Object.prototype.toString.call(value) === "[object Date]") {
        return isNaN(value.getTime())
          ? ""
          : value.toISOString();
      }

      return value === null || value === undefined
        ? ""
        : String(value);
    });
  });

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(normalized),
    Utilities.Charset.UTF_8
  );

  return digest
    .map(function(byte) {
      const value = byte < 0 ? byte + 256 : byte;
      return ("0" + value.toString(16)).slice(-2);
    })
    .join("");
}


function medSummarySaveCurrentFingerprint_() {
  PropertiesService.getScriptProperties().setProperty(
    MED_SUMMARY_CONFIG.HEARTBEAT_PROPERTY,
    medSummaryGetMedicationSheetFingerprint_()
  );
}


