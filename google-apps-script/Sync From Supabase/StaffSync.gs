/* ==========================================================
   STAFF SYNC
   Supabase tbl_staff
        ->
   Google tbl_StaffList

   PRIMARY:
   Supabase Database Webhook
   INSERT / UPDATE / DELETE
   -> immediate sync

   BACKUP:
   6-hour full mirror reconciliation

   MANUAL:
   syncStaffNow()
   ========================================================== */


/* ==========================================================
   LEGACY SINGLE-RECORD SYNC
   ========================================================== */

function syncStaff(data) {

  if (!data || typeof data !== "object") {
    throw new Error("Staff data is missing.");
  }

  const incomingStaffID =
    String(data.StaffID || "").trim();

  const branch =
    String(data.Branch || "").trim();

  if (!incomingStaffID) {
    throw new Error("StaffID is required.");
  }

  if (!branch) {
    throw new Error("Branch is required.");
  }

  /*
   * Legacy Access behaviour:
   *
   * Numeric StaffID:
   *   999
   *
   * Branch:
   *   ALMA
   *
   * becomes:
   *   AMN-999
   *
   * If StaffID already contains "-", leave it unchanged.
   */

  if (!incomingStaffID.includes("-")) {

    data.StaffID =
      getBranchCode(branch) +
      "-" +
      incomingStaffID;

  }

  data.Role =
    getGoogleRole(data.Role);

  if (!data.Department && data.Position) {

    data.Department =
      getDepartment(data.Position);

  }

  const sheet =
    getSheet(CONFIG.SHEETS.STAFF);

  let row =
    findRow(
      sheet,
      "StaffID",
      data.StaffID
    );

  let action;

  if (row === -1) {

    row =
      sheet.getLastRow() + 1;

    action =
      "Inserted";

  }
  else {

    action =
      "Updated";

  }

  writeRecord(
    sheet,
    row,
    data
  );

  return {

    success: true,

    table:
      CONFIG.SHEETS.STAFF,

    action:
      action,

    recordID:
      data.StaffID

  };

}


/* ==========================================================
   LEGACY WRITE HELPER
   ========================================================== */

function writeRecord(
  sheet,
  row,
  data
) {

  const headers =
    getHeaders(sheet);

  const values = [];

  headers.forEach(function(col) {

    if (
      col ===
      "CloudLastUpdated"
    ) {

      values.push(
        new Date()
      );

    }
    else {

      values.push(
        data[col] ?? ""
      );

    }

  });

  sheet
    .getRange(
      row,
      1,
      1,
      values.length
    )
    .setValues([
      values
    ]);

}


/* ==========================================================
   FIND ROW
   ========================================================== */

function findRow(
  sheet,
  columnName,
  value
) {

  const values =
    sheet
      .getDataRange()
      .getValues();

  if (
    values.length === 0
  ) {

    return -1;

  }

  const headers =
    values[0];

  const col =
    headers.indexOf(
      columnName
    );

  if (
    col === -1
  ) {

    throw new Error(
      'Column "' +
      columnName +
      '" not found in ' +
      sheet.getName()
    );

  }

  const target =
    String(
      value ?? ""
    ).trim();

  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    if (
      String(
        values[i][col] ?? ""
      ).trim() === target
    ) {

      return i + 1;

    }

  }

  return -1;

}


/* ==========================================================
   IMMEDIATE SUPABASE WEBHOOK SYNC
   ========================================================== */

/**
 * Handles one Supabase tbl_staff webhook event.
 *
 * Supported:
 *
 * INSERT
 * UPDATE
 * DELETE
 *
 * Supabase is the master.
 * Google tbl_StaffList is the mirror.
 */
function syncStaffFromSupabaseWebhook(
  payload
) {

  if (
    !payload ||
    typeof payload !== "object"
  ) {

    throw new Error(
      "Supabase staff webhook payload is missing."
    );

  }

  if (
    String(
      payload.table || ""
    ).trim() !==
    CONFIG.SUPABASE.STAFF_TABLE
  ) {

    throw new Error(
      "Unsupported Supabase table: " +
      payload.table
    );

  }

  const eventType =
    String(
      payload.type || ""
    )
      .trim()
      .toUpperCase();

  if (
    eventType !== "INSERT" &&
    eventType !== "UPDATE" &&
    eventType !== "DELETE"
  ) {

    throw new Error(
      "Unsupported staff webhook event: " +
      eventType
    );

  }

  //----------------------------------------------------
  // DELETE
  //----------------------------------------------------

  if (
    eventType === "DELETE"
  ) {

    const oldRecord =
      payload.old_record ||
      payload.oldRecord ||
      payload.record ||
      null;

    if (
      !oldRecord ||
      typeof oldRecord !== "object"
    ) {

      throw new Error(
        "Supabase DELETE webhook does not contain old_record."
      );

    }

    return deleteStaffFromGoogle_(
      oldRecord
    );

  }

  //----------------------------------------------------
  // INSERT / UPDATE
  //----------------------------------------------------

  const record =
    payload.record;

  if (
    !record ||
    typeof record !== "object"
  ) {

    throw new Error(
      "Supabase staff webhook record is missing."
    );

  }

  return upsertStaffFromSupabaseRecord_(
    record,
    eventType
  );

}


/* ==========================================================
   IMMEDIATE STAFF UPSERT
   ========================================================== */

function upsertStaffFromSupabaseRecord_(
  record,
  eventType
) {

  const lock =
    LockService.getScriptLock();

  if (
    !lock.tryLock(30000)
  ) {

    throw new Error(
      "Staff sync is already running. Please retry."
    );

  }

  try {

    const sheet =
      getSheet(
        CONFIG.SHEETS.STAFF
      );

    if (!sheet) {

      throw new Error(
        'Staff sheet "' +
        CONFIG.SHEETS.STAFF +
        '" not found.'
      );

    }

    const headers =
      getHeaders(sheet);

    validateStaffSheetHeaders_(
      headers
    );

    const normalized =
      normalizeSupabaseStaffRecord_(
        record
      );

    validateStaffMirrorRows_([
      normalized
    ]);

    const existingRow =
      findRow(
        sheet,
        "StaffID",
        normalized.StaffID
      );

    let targetRow;
    let action;

    if (
      existingRow === -1
    ) {

      targetRow =
        sheet.getLastRow() + 1;

      action =
        "Inserted";

    }
    else {

      targetRow =
        existingRow;

      action =
        "Updated";

    }

    /*
     * Preserve extra Google-only columns.
     *
     * Only columns explicitly managed by Supabase
     * are overwritten.
     */

    const managedHeaders =
      getManagedStaffHeaders_();

    let existingValues =
      null;

    if (
      existingRow !== -1
    ) {

      existingValues =
        sheet
          .getRange(
            existingRow,
            1,
            1,
            headers.length
          )
          .getValues()[0];

    }

    const outputRow =
      headers.map(
        function(header, index) {

          if (
            Object.prototype
              .hasOwnProperty
              .call(
                normalized,
                header
              )
          ) {

            return (
              normalized[header] ??
              ""
            );

          }

          /*
           * Google-only column.
           *
           * Preserve existing value on update.
           * Blank on insert.
           */

          if (
            existingValues &&
            !managedHeaders[header]
          ) {

            return existingValues[index];

          }

          return "";

        }
      );

    sheet
      .getRange(
        targetRow,
        1,
        1,
        outputRow.length
      )
      .setValues([
        outputRow
      ]);

    SpreadsheetApp.flush();

    const result = {

      success: true,

      action:
        action,

      event:
        eventType,

      source:
        "SupabaseWebhook",

      destination:
        CONFIG.SHEETS.STAFF,

      recordID:
        normalized.StaffID,

      staffID:
        normalized.StaffID,

      timestamp:
        new Date().toISOString()

    };

    Logger.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    return result;

  }
  finally {

    lock.releaseLock();

  }

}


/* ==========================================================
   NORMALIZE ONE SUPABASE STAFF RECORD
   ========================================================== */

function normalizeSupabaseStaffRecord_(
  staff
) {

  const staffID =
    cleanText_(
      staff.StaffID
    );

  if (!staffID) {

    throw new Error(
      "Supabase staff record has a blank StaffID."
    );

  }

  //----------------------------------------------------
  // Branch
  //----------------------------------------------------

  const branchID =
    normalizeKey_(
      staff.branch_id
    );

  if (!branchID) {

    throw new Error(
      "Staff " +
      staffID +
      " has no branch_id."
    );

  }

  const supabase =
    getSupabaseConfig_();

  const branchRows =
    supabaseGetById_(
      supabase,
      CONFIG.SUPABASE.BRANCH_TABLE,
      "BranchID",
      branchID,
      [
        "BranchID",
        "BranchLocale",
        "BranchCode"
      ]
    );

  if (
    branchRows.length === 0
  ) {

    throw new Error(
      "Branch not found for staff " +
      staffID +
      ": " +
      branchID
    );

  }

  const branch =
    branchRows[0];

  const branchLocale =
    cleanText_(
      branch.BranchLocale
    );

  if (!branchLocale) {

    throw new Error(
      "Branch " +
      branchID +
      " has blank BranchLocale."
    );

  }

  //----------------------------------------------------
  // Position
  //----------------------------------------------------

  const positionID =
    normalizeKey_(
      staff.position_id
    );

  if (!positionID) {

    throw new Error(
      "Staff " +
      staffID +
      " has no position_id."
    );

  }

  const positionRows =
    supabaseGetById_(
      supabase,
      CONFIG.SUPABASE.POSITION_TABLE,
      "id",
      positionID,
      [
        "id",
        "name"
      ]
    );

  if (
    positionRows.length === 0
  ) {

    throw new Error(
      "Position not found for staff " +
      staffID +
      ": " +
      positionID
    );

  }

  const position =
    positionRows[0];

  const positionName =
    cleanText_(
      position.name
    );

  if (!positionName) {

    throw new Error(
      "Position " +
      positionID +
      " has blank name."
    );

  }

  //----------------------------------------------------
  // Build Google record
  //----------------------------------------------------

  return {

    StaffID:
      staffID,

    StaffName:
      cleanText_(
        staff.staff_name
      ),

    Branch:
      branchLocale,

    Department:
      cleanText_(
        staff.department
      ),

    Position:
      positionName,

    Role:
      cleanText_(
        staff.role
      ).toUpperCase(),

    Status:
      cleanText_(
        staff.status
      ).toUpperCase(),

    BranchID:
      branch.BranchID,

    PositionID:
      position.id,

    SupabaseUpdatedAt:
      staff.updated_at || "",

    CloudLastUpdated:
      new Date()

  };

}


/* ==========================================================
   DELETE STAFF FROM GOOGLE
   ========================================================== */

function deleteStaffFromGoogle_(
  oldRecord
) {

  const lock =
    LockService.getScriptLock();

  if (
    !lock.tryLock(30000)
  ) {

    throw new Error(
      "Staff sync is already running. Please retry."
    );

  }

  try {

    const staffID =
      cleanText_(
        oldRecord.StaffID
      );

    if (!staffID) {

      throw new Error(
        "DELETE webhook has no StaffID."
      );

    }

    const sheet =
      getSheet(
        CONFIG.SHEETS.STAFF
      );

    if (!sheet) {

      throw new Error(
        'Staff sheet "' +
        CONFIG.SHEETS.STAFF +
        '" not found.'
      );

    }

    const row =
      findRow(
        sheet,
        "StaffID",
        staffID
      );

    /*
     * Staff no longer exists in Supabase.
     * Remove the mirror row from Google.
     */

    if (
      row === -1
    ) {

      const result = {

        success: true,

        action:
          "DeleteNoOp",

        event:
          "DELETE",

        source:
          "SupabaseWebhook",

        destination:
          CONFIG.SHEETS.STAFF,

        recordID:
          staffID,

        message:
          "Staff did not exist in Google Sheet.",

        timestamp:
          new Date().toISOString()

      };

      Logger.log(
        JSON.stringify(
          result,
          null,
          2
        )
      );

      return result;

    }

    sheet.deleteRow(
      row
    );

    SpreadsheetApp.flush();

    const result = {

      success: true,

      action:
        "Deleted",

      event:
        "DELETE",

      source:
        "SupabaseWebhook",

      destination:
        CONFIG.SHEETS.STAFF,

      recordID:
        staffID,

      timestamp:
        new Date().toISOString()

    };

    Logger.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    return result;

  }
  finally {

    lock.releaseLock();

  }

}


/* ==========================================================
   FULL STAFF MIRROR
   ========================================================== */

/**
 * Full reconciliation.
 *
 * Supabase tbl_staff
 *      ->
 * Google tbl_StaffList
 *
 * This is used by:
 *
 * 1. 6-hour safety trigger
 * 2. syncStaffNow()
 * 3. testStaffListSupabaseSync()
 *
 * It is NOT the primary real-time sync.
 */
function syncStaffListFromSupabase() {

  const lock =
    LockService.getScriptLock();

  if (
    !lock.tryLock(30000)
  ) {

    throw new Error(
      "Staff sync is already running. Skipping this run."
    );

  }

  const startedAt =
    new Date();

  try {

    const sheet =
      getSheet(
        CONFIG.SHEETS.STAFF
      );

    if (!sheet) {

      throw new Error(
        'Staff sheet "' +
        CONFIG.SHEETS.STAFF +
        '" not found.'
      );

    }

    const headers =
      getHeaders(sheet);

    validateStaffSheetHeaders_(
      headers
    );

    const supabase =
      getSupabaseConfig_();

    //----------------------------------------------------
    // Fetch master data
    //----------------------------------------------------

    const staffRows =
      supabaseGetAll_(
        supabase,
        CONFIG.SUPABASE.STAFF_TABLE,
        [
          "StaffID",
          "staff_name",
          "branch_id",
          "department",
          "position_id",
          "role",
          "status",
          "updated_at"
        ]
      );

    const branchRows =
      supabaseGetAll_(
        supabase,
        CONFIG.SUPABASE.BRANCH_TABLE,
        [
          "BranchID",
          "BranchLocale",
          "BranchCode"
        ]
      );

    const positionRows =
      supabaseGetAll_(
        supabase,
        CONFIG.SUPABASE.POSITION_TABLE,
        [
          "id",
          "name"
        ]
      );

    //----------------------------------------------------
    // Safety protection
    //----------------------------------------------------

    if (
      staffRows.length === 0
    ) {

      throw new Error(
        "Supabase returned 0 staff records. " +
        "Google Sheet was NOT cleared to prevent accidental data loss."
      );

    }

    //----------------------------------------------------
    // Lookup maps
    //----------------------------------------------------

    const branchMap =
      buildSupabaseLookup_(
        branchRows,
        "BranchID"
      );

    const positionMap =
      buildSupabaseLookup_(
        positionRows,
        "id"
      );

    //----------------------------------------------------
    // Normalize all staff
    //----------------------------------------------------

    const outputRows =
      staffRows.map(
        function(staff) {

          const staffID =
            cleanText_(
              staff.StaffID
            );

          if (!staffID) {

            throw new Error(
              "A Supabase staff record has a blank StaffID."
            );

          }

          const branchID =
            normalizeKey_(
              staff.branch_id
            );

          const branch =
            branchMap[
              branchID
            ];

          if (!branch) {

            throw new Error(
              "Staff " +
              staffID +
              " references missing branch_id " +
              branchID +
              "."
            );

          }

          const positionID =
            normalizeKey_(
              staff.position_id
            );

          const position =
            positionMap[
              positionID
            ];

          if (!position) {

            throw new Error(
              "Staff " +
              staffID +
              " references missing position_id " +
              positionID +
              "."
            );

          }

          return {

            StaffID:
              staffID,

            StaffName:
              cleanText_(
                staff.staff_name
              ),

            Branch:
              cleanText_(
                branch.BranchLocale
              ),

            Department:
              cleanText_(
                staff.department
              ),

            Position:
              cleanText_(
                position.name
              ),

            Role:
              cleanText_(
                staff.role
              ).toUpperCase(),

            Status:
              cleanText_(
                staff.status
              ).toUpperCase(),

            BranchID:
              branch.BranchID,

            PositionID:
              position.id,

            SupabaseUpdatedAt:
              staff.updated_at || "",

            CloudLastUpdated:
              new Date()

          };

        }
      );

    //----------------------------------------------------
    // Validate
    //----------------------------------------------------

    validateStaffMirrorRows_(
      outputRows
    );

    //----------------------------------------------------
    // Duplicate StaffID protection
    //----------------------------------------------------

    const staffIDSet = {};

    outputRows.forEach(
      function(row) {

        if (
          staffIDSet[row.StaffID]
        ) {

          throw new Error(
            "Duplicate StaffID returned by Supabase: " +
            row.StaffID
          );

        }

        staffIDSet[
          row.StaffID
        ] = true;

      }
    );

    //----------------------------------------------------
    // Natural sorting
    //----------------------------------------------------

    outputRows.sort(
      compareStaffIDNatural_
    );

    //----------------------------------------------------
    // Existing Google rows
    //----------------------------------------------------

    const oldLastRow =
      sheet.getLastRow();

    const oldStaffCount =
      Math.max(
        0,
        oldLastRow - 1
      );

    //----------------------------------------------------
    // Safety check
    //----------------------------------------------------

    if (
      oldStaffCount > 0 &&
      outputRows.length <
        oldStaffCount &&
      !CONFIG.STAFF_SYNC
        .ALLOW_STAFF_COUNT_REDUCTION
    ) {

      throw new Error(
        "Safety stop: Supabase returned " +
        outputRows.length +
        " staff records, but Google Sheet currently contains " +
        oldStaffCount +
        " staff rows. " +
        "The sheet was NOT changed. " +
        "Populate all staff in Supabase first, or explicitly set " +
        "CONFIG.STAFF_SYNC.ALLOW_STAFF_COUNT_REDUCTION = true."
      );

    }

    //----------------------------------------------------
    // Preserve Google-only columns
    //----------------------------------------------------

    const staffIDColumnIndex =
      headers.indexOf(
        "StaffID"
      );

    const managedHeaders =
      getManagedStaffHeaders_();

    const preservedColumns = {};

    if (
      oldLastRow >= 2 &&
      staffIDColumnIndex !== -1
    ) {

      const existingRows =
        sheet
          .getRange(
            2,
            1,
            oldLastRow - 1,
            headers.length
          )
          .getValues();

      existingRows.forEach(
        function(existingRow) {

          const existingStaffID =
            cleanText_(
              existingRow[
                staffIDColumnIndex
              ]
            );

          if (!existingStaffID) {
            return;
          }

          const extras = {};

          headers.forEach(
            function(
              header,
              index
            ) {

              if (
                !managedHeaders[
                  header
                ]
              ) {

                extras[
                  header
                ] =
                  existingRow[
                    index
                  ];

              }

            }
          );

          preservedColumns[
            existingStaffID
          ] =
            extras;

        }
      );

    }

    //----------------------------------------------------
    // Build final Google rows
    //----------------------------------------------------

    const finalSheetRows =
      outputRows.map(
        function(data) {

          const preserved =
            preservedColumns[
              data.StaffID
            ] || {};

          return headers.map(
            function(header) {

              if (
                Object.prototype
                  .hasOwnProperty
                  .call(
                    data,
                    header
                  )
              ) {

                return (
                  data[header] ??
                  ""
                );

              }

              if (
                Object.prototype
                  .hasOwnProperty
                  .call(
                    preserved,
                    header
                  )
              ) {

                return preserved[
                  header
                ];

              }

              return "";

            }
          );

        }
      );

    //----------------------------------------------------
    // Clear existing rows
    //----------------------------------------------------

    const newLastRow =
      1 +
      finalSheetRows.length;

    const rowsToClear =
      Math.max(
        oldLastRow,
        newLastRow
      ) - 1;

    if (
      rowsToClear > 0
    ) {

      sheet
        .getRange(
          2,
          1,
          rowsToClear,
          headers.length
        )
        .clearContent();

    }

    //----------------------------------------------------
    // Write full mirror
    //----------------------------------------------------

    if (
      finalSheetRows.length > 0
    ) {

      sheet
        .getRange(
          2,
          1,
          finalSheetRows.length,
          headers.length
        )
        .setValues(
          finalSheetRows
        );

    }

    SpreadsheetApp.flush();

    //----------------------------------------------------
    // Result
    //----------------------------------------------------

    const finishedAt =
      new Date();

    const result = {

      success:
        true,

      action:
        "FullMirrorSync",

      source:
        "Supabase",

      destination:
        CONFIG.SHEETS.STAFF,

      records:
        outputRows.length,

      startedAt:
        startedAt.toISOString(),

      finishedAt:
        finishedAt.toISOString(),

      durationMs:
        finishedAt.getTime() -
        startedAt.getTime()

    };

    Logger.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    return result;

  }
  catch (err) {

    const errorMessage =
      err &&
      err.stack
        ? err.stack
        : String(err);

    Logger.log(
      "STAFF SYNC ERROR:\n" +
      errorMessage
    );

    throw err;

  }
  finally {

    lock.releaseLock();

  }

}


/* ==========================================================
   STAFF SHEET VALIDATION
   ========================================================== */

function validateStaffSheetHeaders_(
  headers
) {

  const requiredHeaders = [

    "StaffID",

    "StaffName",

    "Branch",

    "Department",

    "Position",

    "Role",

    "Status"

  ];

  requiredHeaders.forEach(
    function(header) {

      if (
        headers.indexOf(
          header
        ) === -1
      ) {

        throw new Error(
          'Required column "' +
          header +
          '" is missing from ' +
          CONFIG.SHEETS.STAFF +
          "."
        );

      }

    }
  );

}


/* ==========================================================
   MANAGED STAFF HEADERS
   ========================================================== */

function getManagedStaffHeaders_() {

  return {

    StaffID:
      true,

    StaffName:
      true,

    Branch:
      true,

    Department:
      true,

    Position:
      true,

    Role:
      true,

    Status:
      true,

    BranchID:
      true,

    PositionID:
      true,

    SupabaseUpdatedAt:
      true,

    CloudLastUpdated:
      true

  };

}


/* ==========================================================
   SUPABASE CONFIG
   ========================================================== */

function getSupabaseConfig_() {

  const properties =
    PropertiesService
      .getScriptProperties();

  const url =
    String(
      properties.getProperty(
        CONFIG.SUPABASE
          .URL_PROPERTY
      ) || ""
    ).trim();

  const apiKey =
    String(
      properties.getProperty(
        CONFIG.SUPABASE
          .API_KEY_PROPERTY
      ) || ""
    ).trim();

  if (!url) {

    throw new Error(
      "Missing Script Property: " +
      CONFIG.SUPABASE.URL_PROPERTY
    );

  }

  if (!apiKey) {

    throw new Error(
      "Missing Script Property: " +
      CONFIG.SUPABASE.API_KEY_PROPERTY
    );

  }

  return {

    url:
      url.replace(
        /\/+$/,
        ""
      ),

    apiKey:
      apiKey

  };

}


/* ==========================================================
   SUPABASE GET ALL
   ========================================================== */

function supabaseGetAll_(
  supabase,
  tableName,
  selectColumns
) {

  const pageSize =
    Number(
      CONFIG.SUPABASE
        .PAGE_SIZE ||
      1000
    );

  const results = [];

  let offset = 0;

  while (true) {

    const select =
      selectColumns.join(",");

    const endpoint =
      supabase.url +
      "/rest/v1/" +
      encodeURIComponent(
        tableName
      ) +
      "?select=" +
      encodeURIComponent(
        select
      ) +
      "&limit=" +
      pageSize +
      "&offset=" +
      offset;

    const response =
      UrlFetchApp.fetch(
        endpoint,
        {

          method:
            "get",

          muteHttpExceptions:
            true,

          headers: {

            apikey:
              supabase.apiKey,

            Accept:
              "application/json"

          }

        }
      );

    const statusCode =
      response
        .getResponseCode();

    const body =
      response
        .getContentText();

    if (
      statusCode < 200 ||
      statusCode >= 300
    ) {

      throw new Error(
        "Supabase GET failed for " +
        tableName +
        " (" +
        statusCode +
        "): " +
        body
      );

    }

    let page;

    try {

      page =
        JSON.parse(
          body
        );

    }
    catch (parseError) {

      throw new Error(
        "Supabase returned invalid JSON for " +
        tableName +
        ": " +
        parseError
      );

    }

    if (
      !Array.isArray(page)
    ) {

      throw new Error(
        "Unexpected Supabase response for " +
        tableName +
        ". Expected an array."
      );

    }

    results.push.apply(
      results,
      page
    );

    if (
      page.length <
      pageSize
    ) {

      break;

    }

    offset +=
      pageSize;

  }

  return results;

}


/* ==========================================================
   SUPABASE GET BY ID
   ========================================================== */

function supabaseGetById_(
  supabase,
  tableName,
  keyField,
  keyValue,
  selectColumns
) {

  const select =
    selectColumns.join(",");

  const endpoint =
    supabase.url +
    "/rest/v1/" +
    encodeURIComponent(
      tableName
    ) +
    "?" +
    encodeURIComponent(
      keyField
    ) +
    "=eq." +
    encodeURIComponent(
      String(
        keyValue
      )
    ) +
    "&select=" +
    encodeURIComponent(
      select
    ) +
    "&limit=1";

  const response =
    UrlFetchApp.fetch(
      endpoint,
      {

        method:
          "get",

        muteHttpExceptions:
          true,

        headers: {

          apikey:
            supabase.apiKey,

          Accept:
            "application/json"

        }

      }
    );

  const statusCode =
    response
      .getResponseCode();

  const body =
    response
      .getContentText();

  if (
    statusCode < 200 ||
    statusCode >= 300
  ) {

    throw new Error(
      "Supabase GET failed for " +
      tableName +
      " by " +
      keyField +
      " (" +
      statusCode +
      "): " +
      body
    );

  }

  let result;

  try {

    result =
      JSON.parse(
        body
      );

  }
  catch (err) {

    throw new Error(
      "Supabase returned invalid JSON for " +
      tableName +
      ": " +
      err
    );

  }

  if (
    !Array.isArray(result)
  ) {

    throw new Error(
      "Unexpected Supabase response for " +
      tableName
    );

  }

  return result;

}


/* ==========================================================
   LOOKUP MAP
   ========================================================== */

function buildSupabaseLookup_(
  rows,
  keyField
) {

  const map = {};

  rows.forEach(
    function(row) {

      const key =
        normalizeKey_(
          row[keyField]
        );

      if (!key) {
        return;
      }

      if (
        Object.prototype
          .hasOwnProperty
          .call(
            map,
            key
          )
      ) {

        throw new Error(
          "Duplicate key " +
          key +
          " found in Supabase lookup for " +
          keyField
        );

      }

      map[key] =
        row;

    }
  );

  return map;

}


/* ==========================================================
   NORMALIZE / CLEAN
   ========================================================== */

function normalizeKey_(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }

  return String(
    value
  ).trim();

}


function cleanText_(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }

  return String(
    value
  ).trim();

}


/* ==========================================================
   VALIDATE STAFF MIRROR
   ========================================================== */

function validateStaffMirrorRows_(
  rows
) {

  const validRoles = [

    "ADMIN",

    "MODERATOR",

    "STAFF"

  ];

  const validStatuses = [

    "ACTIVE",

    "INACTIVE"

  ];

  rows.forEach(
    function(row) {

      if (
        !row.StaffName
      ) {

        throw new Error(
          "Staff " +
          row.StaffID +
          " has blank StaffName."
        );

      }

      if (
        !row.Branch
      ) {

        throw new Error(
          "Staff " +
          row.StaffID +
          " has blank Branch."
        );

      }

      if (
        !row.Department
      ) {

        throw new Error(
          "Staff " +
          row.StaffID +
          " has blank Department."
        );

      }

      if (
        !row.Position
      ) {

        throw new Error(
          "Staff " +
          row.StaffID +
          " has blank Position."
        );

      }

      if (
        validRoles.indexOf(
          row.Role
        ) === -1
      ) {

        throw new Error(
          "Invalid Role for " +
          row.StaffID +
          ": " +
          row.Role
        );

      }

      if (
        validStatuses.indexOf(
          row.Status
        ) === -1
      ) {

        throw new Error(
          "Invalid Status for " +
          row.StaffID +
          ": " +
          row.Status
        );

      }

    }
  );

}


/* ==========================================================
   NATURAL STAFF ID SORT
   ========================================================== */

function compareStaffIDNatural_(
  a,
  b
) {

  const aID =
    String(
      a.StaffID || ""
    );

  const bID =
    String(
      b.StaffID || ""
    );

  const aParts =
    aID.match(
      /^([A-Za-z]+)-(\d+)$/
    );

  const bParts =
    bID.match(
      /^([A-Za-z]+)-(\d+)$/
    );

  if (
    aParts &&
    bParts
  ) {

    const prefixCompare =
      aParts[1]
        .toUpperCase()
        .localeCompare(
          bParts[1]
            .toUpperCase()
        );

    if (
      prefixCompare !== 0
    ) {

      return prefixCompare;

    }

    return (
      Number(aParts[2]) -
      Number(bParts[2])
    );

  }

  return aID.localeCompare(
    bID
  );

}


/* ==========================================================
   6-HOUR BACKUP TRIGGER
   ========================================================== */

/**
 * Creates/recreates the 6-hour staff reconciliation trigger.
 *
 * Run this ONCE manually.
 *
 * This is NOT the immediate synchronization mechanism.
 *
 * Immediate:
 *   Supabase Webhook
 *
 * Backup:
 *   This trigger
 */
function setupStaffSyncTrigger() {

  const functionName =
    CONFIG.STAFF_SYNC
      .FUNCTION_NAME;

  const triggers =
    ScriptApp
      .getProjectTriggers();

  triggers.forEach(
    function(trigger) {

      if (
        trigger
          .getHandlerFunction() ===
        functionName
      ) {

        ScriptApp
          .deleteTrigger(
            trigger
          );

      }

    }
  );

  ScriptApp
    .newTrigger(
      functionName
    )
    .timeBased()
    .everyHours(
      CONFIG.STAFF_SYNC
        .INTERVAL_HOURS
    )
    .create();

  Logger.log(
    "Created " +
    functionName +
    " trigger: every " +
    CONFIG.STAFF_SYNC
      .INTERVAL_HOURS +
    " hours."
  );

}


/* ==========================================================
   MANUAL TEST
   ========================================================== */

function testStaffListSupabaseSync() {

  const result =
    syncStaffListFromSupabase();

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

}


/* ==========================================================
   MANUAL IMMEDIATE FULL SYNC
   ========================================================== */

function syncStaffNow() {

  return syncStaffListFromSupabase();

}


/* ==========================================================
   WEBHOOK TEST HELPERS
   ========================================================== */

/**
 * Test INSERT/UPDATE processing using
 * an existing Supabase StaffID.
 *
 * Replace AMN-999 with a real StaffID.
 */
function testStaffWebhookSync() {

  const supabase =
    getSupabaseConfig_();

  const rows =
    supabaseGetById_(
      supabase,
      CONFIG.SUPABASE.STAFF_TABLE,
      "StaffID",
      "DEMO-0001",
      [
        "StaffID",
        "staff_name",
        "branch_id",
        "department",
        "position_id",
        "role",
        "status",
        "updated_at"
      ]
    );

  if (
    rows.length === 0
  ) {

    throw new Error(
      "Test StaffID not found."
    );

  }

  return upsertStaffFromSupabaseRecord_(
    rows[0],
    "UPDATE"
  );

}


/**
 * Test DELETE processing.
 *
 * WARNING:
 * This deletes the specified StaffID
 * from Google tbl_StaffList only.
 *
 * It does NOT delete anything from Supabase.
 */
function testStaffWebhookDelete() {

  return deleteStaffFromGoogle_({

    StaffID:
      "DEMO-0001"

  });

}