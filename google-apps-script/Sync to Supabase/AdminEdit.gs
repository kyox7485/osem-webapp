// ─── HQ-ADMIN record correction (edit / delete) ──────────────────────────────
// Webapp HQ-ADMIN "Edit" / "Delete" buttons for the Sheet-first modules.
// The Google Sheet stays the source of truth: every change is made to the
// Sheet row FIRST, then mirrored to Supabase with the same targeted sync the
// create path uses. The webapp never writes these Supabase tables directly.
//
//   doPost action              → function here
//   "adminOrderDelete"         → adminDeleteMedicationOrder(rxOrderId)
//   "adminStockUpdate"         → adminUpdateStockEntry(stockId, fields)
//   "adminStockDelete"         → adminDeleteStockEntry(stockId)
//   "adminConsumableUpdate"    → adminUpdateConsumableCount(recordId, fields)
//   "adminConsumableDelete"    → adminDeleteConsumableCount(recordId)
//
// All are gated by SHARED_SECRET in Code.gs; the webapp additionally
// re-checks that the caller is an HQ ADMIN before calling.
//
// This file must NOT define doPost/doGet — Code.gs is the single entry point.
// Globals are prefixed admin/ADMIN_EDIT to avoid duplicate-name collisions.
//
// Reuses: getSheet / buildColumnMap / syncOrderAndSummary_
// (medication-orders.gs), getMedicationStockSheet_ / medStockFindRow_ /
// medStockSyncOneWithRetry_ / medStockDelete_ (MedicationStock.gs),
// consGetSheet_ / consHeaderMap_ / consSyncIdsWithRetry_ / consDelete_ /
// CONS_CONFIG / CONS_RECORD_COLUMNS / CONS_SUPPLIERS (Consumables.gs),
// getMedicationSupabaseConfig_ / cleanMedicationString_ (MedicationSync.gs).

const ADMIN_EDIT_DATE_RE = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}(:\d{2})?$/;

function adminEditLocked_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, error: "Sheet is busy, please try again" };
  try {
    return fn();
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  } finally {
    lock.releaseLock();
  }
}

function adminEditSheetDate_(text) {
  const full = String(text).length === 16 ? text + ":00" : text;
  return Utilities.parseDate(full, "Asia/Kuala_Lumpur", "dd/MM/yyyy HH:mm:ss");
}

// ─── Medication order ─────────────────────────────────────────────────────────
// Deletes the order row and every stock row pointing at that exact RxOrderID
// (otherwise the stock sync would fail forever on "order not found" and, by
// the zero-failure rule, block its own deletion mirroring). The webapp
// refuses to delete an order that a later revision chains to via
// PreviousRxOrderID, so no dangling PreviousRxOrderID is created here.
function adminDeleteMedicationOrder(rxOrderId) {
  const rx = cleanMedicationString_(rxOrderId);
  if (!rx) return { success: false, error: "RxOrderID is required" };

  const locked = adminEditLocked_(function() {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const colMap = buildColumnMap(data[0]);
    const rxCol = colMap["RxOrderID"];
    const prevCol = colMap["PreviousRxOrderID"];
    if (rxCol === undefined) return { success: false, error: "RxOrderID column not found" };

    let rowNum = -1;
    let residentId = "";
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][rxCol]).trim() === rx) {
        rowNum = i + 1;
        residentId = String(data[i][colMap["ResidentID"]] || "").trim();
      }
      if (prevCol !== undefined && String(data[i][prevCol]).trim() === rx) {
        return { success: false, error: "A later revision of this order exists — delete that revision first" };
      }
    }
    if (rowNum === -1) return { success: false, error: "Order not found in Sheet: " + rx };

    // Stock rows for this exact revision.
    const stockIds = [];
    const stockSheet = getMedicationStockSheet_();
    if (stockSheet && stockSheet.getLastRow() >= 2) {
      const sData = stockSheet.getDataRange().getValues();
      const sMap = buildColumnMap(sData[0]);
      for (let i = sData.length - 1; i >= 1; i--) {
        if (String(sData[i][sMap["RxOrderID"]]).trim() === rx) {
          stockIds.push(String(sData[i][sMap["StockID"]]).trim());
          stockSheet.deleteRow(i + 1);
        }
      }
    }

    sheet.deleteRow(rowNum);
    return { success: true, residentId: residentId, stockIds: stockIds };
  });
  if (!locked.success) return locked;

  let stockSync = { success: true };
  if (locked.stockIds.length) {
    try {
      medStockDelete_(getMedicationSupabaseConfig_(), locked.stockIds.filter(String));
    } catch (err) {
      // The 24h stock reconciliation mirrors the Sheet deletion later.
      stockSync = { success: false, error: err && err.message ? err.message : String(err) };
    }
  }

  // syncMedicationOrderAndSummaryNow mirrors a row that is gone from the
  // Sheet as a Supabase DELETE and rebuilds the resident's summary.
  return Object.assign(
    { success: true, deletedStock: locked.stockIds.length, stockSync: stockSync },
    syncOrderAndSummary_(rx, locked.residentId)
  );
}

// ─── Medication stock ─────────────────────────────────────────────────────────

function adminUpdateStockEntry(stockId, fields) {
  fields = fields || {};
  const id = cleanMedicationString_(stockId);
  if (!id) return { success: false, error: "StockID is required" };
  if (fields.EntryType !== undefined && MED_STOCK_ENTRY_TYPES.indexOf(fields.EntryType) === -1) {
    return { success: false, error: "Invalid EntryType: " + fields.EntryType };
  }
  if (fields.Unit !== undefined && MED_STOCK_UNITS.indexOf(fields.Unit) === -1) {
    return { success: false, error: "Invalid Unit: " + fields.Unit };
  }
  if (fields.Balance !== undefined &&
      (typeof fields.Balance !== "number" || !isFinite(fields.Balance) || fields.Balance < 0)) {
    return { success: false, error: "Balance must be a non-negative number" };
  }
  if (fields.StockDate !== undefined && !ADMIN_EDIT_DATE_RE.test(String(fields.StockDate))) {
    return { success: false, error: "StockDate must be DD/MM/YYYY HH:mm" };
  }

  const locked = adminEditLocked_(function() {
    const sheet = getMedicationStockSheet_();
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap = buildColumnMap(header);
    const rowNum = medStockFindRow_(sheet, colMap, id);
    if (rowNum === -1) return { success: false, error: "Stock entry not found in Sheet: " + id };

    ["EntryType", "Balance", "Unit", "RegisteredBy"].forEach(function(col) {
      if (fields[col] !== undefined && colMap[col] !== undefined) {
        sheet.getRange(rowNum, colMap[col] + 1).setValue(fields[col] === null ? "" : fields[col]);
      }
    });
    if (fields.StockDate !== undefined) {
      sheet.getRange(rowNum, colMap["StockDate"] + 1)
        .setValue(adminEditSheetDate_(fields.StockDate))
        .setNumberFormat("dd/MM/yyyy HH:mm:ss");
    }
    return { success: true };
  });
  if (!locked.success) return locked;

  return Object.assign({ success: true }, medStockSyncOneWithRetry_(id));
}

function adminDeleteStockEntry(stockId) {
  const id = cleanMedicationString_(stockId);
  if (!id) return { success: false, error: "StockID is required" };

  const locked = adminEditLocked_(function() {
    const sheet = getMedicationStockSheet_();
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowNum = medStockFindRow_(sheet, buildColumnMap(header), id);
    if (rowNum === -1) return { success: false, error: "Stock entry not found in Sheet: " + id };
    sheet.deleteRow(rowNum);
    return { success: true };
  });
  if (!locked.success) return locked;

  try {
    medStockDelete_(getMedicationSupabaseConfig_(), [id]);
    return { success: true, supabaseSync: { success: true } };
  } catch (err) {
    // Sheet row is gone; the 24h reconciliation mirrors the deletion.
    return {
      success: true,
      supabaseSync: { success: false, error: err && err.message ? err.message : String(err), willRetryAutomatically: true }
    };
  }
}

// ─── Consumable counts ────────────────────────────────────────────────────────

function adminFindConsumableRow_(sheet, colMap, recordId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, colMap["RecordID"] + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(recordId)) return i + 2;
  }
  return -1;
}

function adminUpdateConsumableCount(recordId, fields) {
  fields = fields || {};
  const id = cleanMedicationString_(recordId);
  if (!id) return { success: false, error: "RecordID is required" };
  if (fields.Supplier !== undefined && CONS_SUPPLIERS.indexOf(fields.Supplier) === -1) {
    return { success: false, error: "Invalid Supplier: " + fields.Supplier };
  }
  if (fields.CurrentStock !== undefined &&
      (typeof fields.CurrentStock !== "number" || !isFinite(fields.CurrentStock) || fields.CurrentStock < 0)) {
    return { success: false, error: "CurrentStock must be a non-negative number" };
  }
  if (fields.LastCount !== undefined && !ADMIN_EDIT_DATE_RE.test(String(fields.LastCount))) {
    return { success: false, error: "LastCount must be DD/MM/YYYY HH:mm" };
  }

  const locked = adminEditLocked_(function() {
    const sheet = consGetSheet_(CONS_CONFIG.RECORD_SHEET);
    const map = consHeaderMap_(sheet, CONS_RECORD_COLUMNS, CONS_CONFIG.RECORD_SHEET);
    const rowNum = adminFindConsumableRow_(sheet, map.colMap, id);
    if (rowNum === -1) return { success: false, error: "Count not found in Sheet: " + id };

    ["CurrentStock", "Supplier", "CountedBy"].forEach(function(col) {
      if (fields[col] !== undefined) {
        sheet.getRange(rowNum, map.colMap[col] + 1).setValue(fields[col] === null ? "" : fields[col]);
      }
    });
    if (fields.LastCount !== undefined) {
      sheet.getRange(rowNum, map.colMap["LastCount"] + 1)
        .setValue(adminEditSheetDate_(fields.LastCount))
        .setNumberFormat("dd/MM/yyyy HH:mm:ss");
    }
    return { success: true };
  });
  if (!locked.success) return locked;

  return Object.assign({ success: true }, consSyncIdsWithRetry_([id]));
}

function adminDeleteConsumableCount(recordId) {
  const id = cleanMedicationString_(recordId);
  if (!id) return { success: false, error: "RecordID is required" };

  const locked = adminEditLocked_(function() {
    const sheet = consGetSheet_(CONS_CONFIG.RECORD_SHEET);
    const map = consHeaderMap_(sheet, CONS_RECORD_COLUMNS, CONS_CONFIG.RECORD_SHEET);
    const rowNum = adminFindConsumableRow_(sheet, map.colMap, id);
    if (rowNum === -1) return { success: false, error: "Count not found in Sheet: " + id };
    sheet.deleteRow(rowNum);
    return { success: true };
  });
  if (!locked.success) return locked;

  try {
    consDelete_(getMedicationSupabaseConfig_(), [id]);
    return { success: true, supabaseSync: { success: true } };
  } catch (err) {
    return {
      success: true,
      supabaseSync: { success: false, error: err && err.message ? err.message : String(err), willRetryAutomatically: true }
    };
  }
}
