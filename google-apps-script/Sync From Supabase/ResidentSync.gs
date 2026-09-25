function syncResident(data){

  //------------------------------------------------
  // Get resident sheet
  //------------------------------------------------

  const residentSheet =
    getSheet(
      CONFIG.SHEETS.RESIDENT
    );

  const headers =
    getHeaders(
      residentSheet
    );

  const values =
    residentSheet
      .getDataRange()
      .getValues();


  //------------------------------------------------
  // Get branch code
  //------------------------------------------------

  const branchCode =
    getBranchCode(
      data.Branch
    );


  //------------------------------------------------
  // Convert Access ResidentID
  // Example:
  // Access 138
  // ALMA -> AMN
  // Google = AMN-138
  //------------------------------------------------

  const cloudResidentID =
    branchCode +
    "-" +
    data.ResidentID;

  data.ResidentID =
    cloudResidentID;


  //------------------------------------------------
  // Find existing resident
  //------------------------------------------------

  const residentIDColumn =
    headers.indexOf(
      "ResidentID"
    );

  let targetRow = -1;

  for(
    let i = 1;
    i < values.length;
    i++
  ){

    if(
      values[i][residentIDColumn] ==
      cloudResidentID
    ){

      targetRow =
        i + 1;

      break;

    }

  }


  //------------------------------------------------
  // Access -> Google field mapping
  //------------------------------------------------

  const fieldMap = {

    //------------------------------------------------
    // Google field : Access field
    //------------------------------------------------

    AssessmentSummary:
      "AssessmentAndSummary",

    PastMedicalCondition:
      "PastMedicalCondition",

    AdmitFrom:
      "TransferFrom",

    NextTCA:
      "TCA",

    RegisteredBy:
      "ReviewBy",

    CurrentMedList:
      "CurrentMedList"

  };


  //------------------------------------------------
  // Build Google row
  //------------------------------------------------

  const row = [];

  headers.forEach(function(header){

    //------------------------------------------------
    // Google-managed field
    //------------------------------------------------

    if(
      header ==
      "CloudLastUpdated"
    ){

      row.push(
        new Date()
      );

      return;

    }


    //------------------------------------------------
    // Find corresponding Access field
    //------------------------------------------------

    const accessField =
      fieldMap[header] ||
      header;


    //------------------------------------------------
    // Write value
    //------------------------------------------------

    if(
      Object.prototype.hasOwnProperty.call(
        data,
        accessField
      )
    ){

      row.push(
        data[accessField] ?? ""
      );

    }
    else{

      row.push("");

    }

  });


  //------------------------------------------------
  // Insert / Update
  //------------------------------------------------

  let action = "";

  if(
    targetRow == -1
  ){

    residentSheet
      .appendRow(
        row
      );

    action =
      "Inserted";

  }
  else{

    residentSheet
      .getRange(
        targetRow,
        1,
        1,
        row.length
      )
      .setValues([
        row
      ]);

    action =
      "Updated";

  }


  //------------------------------------------------
  // Return result
  //------------------------------------------------

  return {

    success: true,

    table:
      CONFIG.SHEETS.RESIDENT,

    action:
      action,

    recordID:
      cloudResidentID

  };

}

function syncResidentField(
  residentID,
  branch,
  field,
  value
){

  return syncResidentFields(
    residentID,
    branch,
    [
      {
        field: field,
        value: value
      }
    ]
  );

}


function syncResidentFields(
  residentID,
  branch,
  updates
){

  //------------------------------------------------
  // Allowed fields
  //------------------------------------------------

  const allowedFields = [
    "Diet",
    "Feeding"
  ];


  //------------------------------------------------
  // Validate updates
  //------------------------------------------------

  updates.forEach(function(update){

    if(
      allowedFields.indexOf(
        update.field
      ) === -1
    ){

      throw new Error(
        "Field sync not allowed: " +
        update.field
      );

    }

  });


  //------------------------------------------------
  // Get spreadsheet and sheet ONCE
  //------------------------------------------------

  const ss =
    SpreadsheetApp.openById(
      CONFIG.SPREADSHEET_ID
    );

  const sheet =
    ss.getSheetByName(
      CONFIG.SHEETS.RESIDENT
    );

  if(!sheet){

    throw new Error(
      "Resident sheet not found."
    );

  }


  //------------------------------------------------
  // Get headers ONCE
  //------------------------------------------------

  const headers =
    sheet
      .getRange(
        1,
        1,
        1,
        sheet.getLastColumn()
      )
      .getValues()[0];


  //------------------------------------------------
  // Find ResidentID column
  //------------------------------------------------

  const residentIDColumn =
    headers.indexOf(
      "ResidentID"
    );

  if(
    residentIDColumn === -1
  ){

    throw new Error(
      "ResidentID column not found."
    );

  }


  //------------------------------------------------
  // Convert Access ID to Cloud ID
  //
  // Example:
  // 138 + ALMA
  //       ↓
  // AMN-138
  //------------------------------------------------

  const branchCode =
    getBranchCode(
      branch
    );

  const cloudResidentID =
    branchCode +
    "-" +
    residentID;


  //------------------------------------------------
  // Find resident directly
  //------------------------------------------------

  const lastRow =
    sheet.getLastRow();

  if(lastRow < 2){

    throw new Error(
      "Resident sheet contains no data."
    );

  }


  const match =
    sheet
      .getRange(
        2,
        residentIDColumn + 1,
        lastRow - 1,
        1
      )
      .createTextFinder(
        String(cloudResidentID)
      )
      .matchEntireCell(
        true
      )
      .findNext();


  //------------------------------------------------
  // Resident not found
  //------------------------------------------------

  if(!match){

    throw new Error(
      "Resident not found: " +
      cloudResidentID
    );

  }


  const targetRow =
    match.getRow();


  //------------------------------------------------
  // Update requested fields
  //------------------------------------------------

  updates.forEach(function(update){

    const fieldColumn =
      headers.indexOf(
        update.field
      );

    if(
      fieldColumn === -1
    ){

      throw new Error(
        "Field not found: " +
        update.field
      );

    }


    sheet
      .getRange(
        targetRow,
        fieldColumn + 1
      )
      .setValue(
        update.value == null
          ? ""
          : update.value
      );

  });


  //------------------------------------------------
  // Return
  //------------------------------------------------

  return {

    success: true,

    action:
      "FieldsUpdated",

    ResidentID:
      cloudResidentID,

    fields:
      updates.map(function(update){
        return update.field;
      })

  };

}


/* ==========================================================
   SUPABASE RESIDENT MASTER -> GOOGLE NEW-ENTRY SYNC
   ========================================================== */

/**
 * LEGACY/CATCH-UP SYNC:
 * Checks Supabase tbl_residents against Google tbl_ResidentList
 * and inserts ONLY residents that do not already exist in Google.
 *
 * ResidentID is copied directly from Supabase.
 * Existing residents are NOT updated by this function.
 *
 * Required shared helper functions are supplied by StaffSync.gs:
 *   getSupabaseConfig_()
 *   supabaseGetAll_()
 *   buildSupabaseLookup_()
 *   normalizeKey_()
 *   cleanText_()
 */
function syncNewResidentsFromSupabase() {

  const lock =
    LockService.getScriptLock();

  if(!lock.tryLock(30000)){

    throw new Error(
      "Resident sync is already running. Skipping this run."
    );

  }

  const startedAt = new Date();

  try{

    //------------------------------------------------
    // Get Google resident sheet
    //------------------------------------------------

    const sheet =
      getSheet(
        CONFIG.SHEETS.RESIDENT
      );

    if(!sheet){

      throw new Error(
        'Resident sheet "' +
        CONFIG.SHEETS.RESIDENT +
        '" not found.'
      );

    }

    const headers =
      getHeaders(sheet);


    //------------------------------------------------
    // Required Google columns
    //------------------------------------------------

    const requiredHeaders = [
      "ResidentID",
      "Residents",
      "Branch",
      "IC",
      "Age",
      "Nationality",
      "Gender",
      "MaritalStatus",
      "Status",
      "AdmissionDate",
      "DischargeDate",
      "CareType",
      "Category",
      "EmergencyContact",
      "Allergy",
      "AssessmentSummary",
      "PastMedicalCondition",
      "AdmitFrom",
      "AccompaniedBy",
      "CareGoal",
      "Mobility",
      "Feeding",
      "Hygiene",
      "Diet",
      "NextTCA",
      "RegisteredBy",
      "CloudLastUpdated",
      "CurrentMedList"
    ];

    requiredHeaders.forEach(function(header){

      if(headers.indexOf(header) === -1){

        throw new Error(
          'Required column "' +
          header +
          '" is missing from ' +
          CONFIG.SHEETS.RESIDENT +
          "."
        );

      }

    });


    //------------------------------------------------
    // Supabase configuration
    //------------------------------------------------

    const supabase =
      getSupabaseConfig_();


    //------------------------------------------------
    // Fetch master + lookup tables
    //------------------------------------------------

    const residentRows =
      supabaseGetAll_(
        supabase,
        "tbl_residents",
        [
          "id",
          "ResidentID",
          "branch_id",
          "resident_name",
          "ic_number",
          "age",
          "nationality_id",
          "gender",
          "marital_status",
          "status",
          "category",
          "care_type",
          "admission_date",
          "discharge_date",
          "transfer_from",
          "accompanied_by",
          "emergency_contact",
          "allergy",
          "past_medical_condition",
          "current_medication_list",
          "mobility",
          "feeding_type_id",
          "hygiene",
          "diet_type_id",
          "languages",
          "care_goal",
          "tca_notes",
          "assessment_and_summary",
          "created_at",
          "updated_at",
          "reviewed_by"
        ]
      );

    const branchRows =
      supabaseGetAll_(
        supabase,
        "tbl_branches",
        [
          "BranchID",
          "BranchLocale",
          "BranchCode"
        ]
      );

    const nationalityRows =
      supabaseGetAll_(
        supabase,
        "tbl_nationalities",
        [
          "id",
          "country_name",
          "nationality_label"
        ]
      );

    const feedingRows =
      supabaseGetAll_(
        supabase,
        "tbl_feeding_types",
        [
          "id",
          "name"
        ]
      );

    const dietRows =
      supabaseGetAll_(
        supabase,
        "tbl_diet_types",
        [
          "id",
          "name"
        ]
      );

    //------------------------------------------------
    // Staff lookup for reviewed_by / RegisteredBy
    // reviewed_by in Supabase currently stores StaffID.
    //------------------------------------------------

    const staffRows =
      supabaseGetAll_(
        supabase,
        "tbl_staff",
        [
          "StaffID",
          "staff_name"
        ]
      );


    if(residentRows.length === 0){

      Logger.log(
        "Supabase returned 0 resident records. No changes made."
      );

      return {
        success: true,
        action: "NoChange",
        source: "Supabase",
        destination: CONFIG.SHEETS.RESIDENT,
        newRecords: 0,
        existingRecords: 0
      };

    }


    //------------------------------------------------
    // Build lookup maps
    //------------------------------------------------

    const branchMap =
      buildSupabaseLookup_(
        branchRows,
        "BranchID"
      );

    const nationalityMap =
      buildSupabaseLookup_(
        nationalityRows,
        "id"
      );

    const feedingMap =
      buildSupabaseLookup_(
        feedingRows,
        "id"
      );

    const dietMap =
      buildSupabaseLookup_(
        dietRows,
        "id"
      );

    const staffMap =
      buildSupabaseLookup_(
        staffRows,
        "StaffID"
      );


    //------------------------------------------------
    // Read existing Google ResidentIDs ONCE
    //------------------------------------------------

    const residentIDColumn =
      headers.indexOf("ResidentID");

    const existingIDs = {};

    const lastRow =
      sheet.getLastRow();

    if(lastRow >= 2){

      const existingValues =
        sheet
          .getRange(
            2,
            residentIDColumn + 1,
            lastRow - 1,
            1
          )
          .getValues();

      existingValues.forEach(function(row){

        const id =
          cleanText_(row[0]);

        if(id){
          existingIDs[id] = true;
        }

      });

    }


    //------------------------------------------------
    // Build ONLY new resident rows
    //------------------------------------------------

    const newResidents = [];

    residentRows.forEach(function(resident){

      //------------------------------------------------
      // Supabase ResidentID
      //
      // IMPORTANT:
      // ResidentID is now generated and owned by Supabase.
      // Google must copy it exactly and must NOT rebuild it
      // from branch code + numeric database id.
      //
      // Example:
      //   Supabase ResidentID = AMN-0001
      //   Google ResidentID   = AMN-0001
      //------------------------------------------------

      const cloudResidentID =
        cleanText_(resident.ResidentID);

      if(!cloudResidentID){

        throw new Error(
          "Supabase resident id " +
          cleanText_(resident.id) +
          " has a blank ResidentID."
        );

      }


      //------------------------------------------------
      // Branch lookup
      //------------------------------------------------

      const branchID =
        normalizeKey_(resident.branch_id);

      const branch =
        branchMap[branchID];

      if(!branch){

        throw new Error(
          "Resident " +
          numericID +
          " references missing branch_id " +
          branchID +
          "."
        );

      }

      const branchLocale =
        cleanText_(branch.BranchLocale);

      const branchCode =
        cleanText_(branch.BranchCode);

      if(!branchLocale){

        throw new Error(
          "Branch " +
          branchID +
          " has blank BranchLocale."
        );

      }

      if(!branchCode){

        throw new Error(
          "Branch " +
          branchID +
          " has blank BranchCode."
        );

      }


      //------------------------------------------------
      // ResidentID comes directly from Supabase.
      // Do not generate it from branchCode + id.
      //------------------------------------------------


      //------------------------------------------------
      // Already exists -> skip
      //------------------------------------------------

      if(existingIDs[cloudResidentID]){
        return;
      }


      //------------------------------------------------
      // Nationality lookup
      //------------------------------------------------

      let nationality = "";

      if(
        resident.nationality_id !== null &&
        resident.nationality_id !== undefined &&
        cleanText_(resident.nationality_id) !== ""
      ){

        const nationalityID =
          normalizeKey_(resident.nationality_id);

        const nationalityRow =
          nationalityMap[nationalityID];

        if(!nationalityRow){

          throw new Error(
            "Resident " +
            cloudResidentID +
            " references missing nationality_id " +
            nationalityID +
            "."
          );

        }

        // Google currently displays "Malaysia", not "Malaysian".
        nationality =
          cleanText_(
            nationalityRow.country_name ||
            nationalityRow.nationality_label
          );

      }


      //------------------------------------------------
      // Feeding lookup
      //------------------------------------------------

      let feeding = "";

      if(
        resident.feeding_type_id !== null &&
        resident.feeding_type_id !== undefined &&
        cleanText_(resident.feeding_type_id) !== ""
      ){

        const feedingID =
          normalizeKey_(resident.feeding_type_id);

        const feedingRow =
          feedingMap[feedingID];

        if(!feedingRow){

          throw new Error(
            "Resident " +
            cloudResidentID +
            " references missing feeding_type_id " +
            feedingID +
            "."
          );

        }

        feeding =
          cleanText_(feedingRow.name);

      }


      //------------------------------------------------
      // Diet lookup
      //------------------------------------------------

      let diet = "";

      if(
        resident.diet_type_id !== null &&
        resident.diet_type_id !== undefined &&
        cleanText_(resident.diet_type_id) !== ""
      ){

        const dietID =
          normalizeKey_(resident.diet_type_id);

        const dietRow =
          dietMap[dietID];

        if(!dietRow){

          throw new Error(
            "Resident " +
            cloudResidentID +
            " references missing diet_type_id " +
            dietID +
            "."
          );

        }

        diet =
          cleanText_(dietRow.name);

      }


      //------------------------------------------------
      // RegisteredBy lookup
      //------------------------------------------------

      let registeredBy =
        cleanText_(resident.reviewed_by);

      if(registeredBy){

        const reviewer =
          staffMap[normalizeKey_(registeredBy)];

        if(reviewer){

          registeredBy =
            cleanText_(reviewer.staff_name) ||
            registeredBy;

        }

      }


      //------------------------------------------------
      // Build normalized resident object
      //------------------------------------------------

      const normalized = {

        ResidentID:
          cloudResidentID,

        Residents:
          cleanText_(resident.resident_name),

        Branch:
          branchLocale,

        IC:
          cleanText_(resident.ic_number),

        Age:
          resident.age ?? "",

        Nationality:
          nationality,

        Gender:
          cleanText_(resident.gender),

        MaritalStatus:
          cleanText_(resident.marital_status),

        Status:
          cleanText_(resident.status),

        AdmissionDate:
          resident.admission_date || "",

        DischargeDate:
          resident.discharge_date || "",

        CareType:
          cleanText_(resident.care_type),

        Category:
          resident.category ?? "",

        EmergencyContact:
          cleanText_(resident.emergency_contact),

        Allergy:
          cleanText_(resident.allergy),

        AssessmentSummary:
          cleanText_(resident.assessment_and_summary),

        PastMedicalCondition:
          cleanText_(resident.past_medical_condition),

        AdmitFrom:
          cleanText_(resident.transfer_from),

        AccompaniedBy:
          cleanText_(resident.accompanied_by),

        CareGoal:
          cleanText_(resident.care_goal),

        Mobility:
          cleanText_(resident.mobility),

        Feeding:
          feeding,

        Hygiene:
          cleanText_(resident.hygiene),

        Diet:
          diet,

        NextTCA:
          cleanText_(resident.tca_notes),

        RegisteredBy:
          registeredBy,

        CloudLastUpdated:
          new Date(),

        CurrentMedList:
          cleanText_(resident.current_medication_list)

      };


      //------------------------------------------------
      // Basic validation
      //------------------------------------------------

      if(!normalized.Residents){

        throw new Error(
          "Resident " +
          cloudResidentID +
          " has blank resident_name."
        );

      }

      if(!normalized.Branch){

        throw new Error(
          "Resident " +
          cloudResidentID +
          " has blank Branch."
        );

      }


      newResidents.push(normalized);
      existingIDs[cloudResidentID] = true;

    });


    //------------------------------------------------
    // Nothing new
    //------------------------------------------------

    if(newResidents.length === 0){

      const result = {
        success: true,
        action: "NoChange",
        source: "Supabase",
        destination: CONFIG.SHEETS.RESIDENT,
        newRecords: 0,
        existingRecords: residentRows.length,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString()
      };

      Logger.log(
        JSON.stringify(result, null, 2)
      );

      return result;

    }


    //------------------------------------------------
    // Natural sort by ResidentID
    // Example: AMN-2 before AMN-10
    //------------------------------------------------

    newResidents.sort(function(a, b){

      const aMatch =
        String(a.ResidentID).match(
          /^([A-Za-z]+)-(\d+)$/
        );

      const bMatch =
        String(b.ResidentID).match(
          /^([A-Za-z]+)-(\d+)$/
        );

      if(aMatch && bMatch){

        const prefixCompare =
          aMatch[1]
            .toUpperCase()
            .localeCompare(
              bMatch[1].toUpperCase()
            );

        if(prefixCompare !== 0){
          return prefixCompare;
        }

        return Number(aMatch[2]) - Number(bMatch[2]);

      }

      return String(a.ResidentID)
        .localeCompare(String(b.ResidentID));

    });


    //------------------------------------------------
    // Convert objects to the EXISTING Google columns
    //------------------------------------------------

    const rowsToAppend =
      newResidents.map(function(data){

        return headers.map(function(header){

          if(
            Object.prototype.hasOwnProperty.call(
              data,
              header
            )
          ){

            return data[header] ?? "";

          }

          // Unknown extra Google columns remain blank
          // for a newly inserted resident.
          return "";

        });

      });


    //------------------------------------------------
    // Append new residents in one batch
    //------------------------------------------------

    const appendStartRow =
      Math.max(2, sheet.getLastRow() + 1);

    sheet
      .getRange(
        appendStartRow,
        1,
        rowsToAppend.length,
        headers.length
      )
      .setValues(
        rowsToAppend
      );

    SpreadsheetApp.flush();


    //------------------------------------------------
    // Return result
    //------------------------------------------------

    const finishedAt =
      new Date();

    const result = {

      success: true,

      action:
        "InsertedNewResidents",

      source:
        "Supabase",

      destination:
        CONFIG.SHEETS.RESIDENT,

      newRecords:
        newResidents.length,

      existingRecords:
        residentRows.length - newResidents.length,

      residentIDs:
        newResidents.map(function(row){
          return row.ResidentID;
        }),

      startedAt:
        startedAt.toISOString(),

      finishedAt:
        finishedAt.toISOString(),

      durationMs:
        finishedAt.getTime() - startedAt.getTime()

    };

    Logger.log(
      JSON.stringify(result, null, 2)
    );

    return result;

  }
  catch(err){

    const errorMessage =
      err && err.stack
        ? err.stack
        : String(err);

    Logger.log(
      "RESIDENT SYNC ERROR:\n" +
      errorMessage
    );

    throw err;

  }
  finally{

    lock.releaseLock();

  }

}


/**
 * Manual immediate resident sync.
 * Checks Supabase for residents that are not yet in Google.
 */
function syncResidentsNow(){

  return syncNewResidentsFromSupabase();

}


/**
 * LEGACY: Creates/recreates the automatic resident new-entry sync trigger.
 *
 * Resident INSERT/UPDATE should now be handled by the Supabase webhook.
 * Keep this function only if you still want the old manual/6-hour
 * catch-up mechanism for existing/new records.
 */
function setupResidentSyncTrigger(){

  const functionName =
    "syncNewResidentsFromSupabase";

  const triggers =
    ScriptApp.getProjectTriggers();

  triggers.forEach(function(trigger){

    if(
      trigger.getHandlerFunction() ===
      functionName
    ){

      ScriptApp.deleteTrigger(
        trigger
      );

    }

  });

  ScriptApp
    .newTrigger(
      functionName
    )
    .timeBased()
    .everyHours(6)
    .create();

  Logger.log(
    "Created " +
    functionName +
    " trigger: every 6 hours."
  );

}


/**
 * Manual test function.
 */
function testNewResidentsFromSupabase(){

  const result =
    syncNewResidentsFromSupabase();

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

}

/**
 * ==========================================================
 * SUPABASE RESIDENT WEBHOOK
 * ==========================================================
 *
 * Receives a Supabase Database Webhook event and synchronizes
 * the affected resident to Google tbl_ResidentList.
 *
 * Supported:
 *   INSERT
 *   UPDATE
 *
 * DELETE is intentionally not handled automatically.
 */

function syncResidentFromSupabaseWebhook(payload) {

  //------------------------------------------------
  // Validate webhook payload
  //------------------------------------------------

  if (!payload || typeof payload !== "object") {

    throw new Error(
      "Supabase webhook payload is missing."
    );

  }


  if (
    payload.table !== "tbl_residents"
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
    eventType !== "UPDATE"
  ) {

    throw new Error(
      "Unsupported resident webhook event: " +
      eventType
    );

  }


  const record =
    payload.record;


  if (
    !record ||
    typeof record !== "object"
  ) {

    throw new Error(
      "Supabase resident record is missing."
    );

  }


  //------------------------------------------------
  // Get Supabase configuration
  //------------------------------------------------

  const supabase =
    getSupabaseConfig_();


  //------------------------------------------------
  // Resolve branch
  //------------------------------------------------

  const branchID =
    normalizeKey_(
      record.branch_id
    );


  if (!branchID) {

    throw new Error(
      "Resident " +
      record.id +
      " has no branch_id."
    );

  }


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
      "Branch not found for branch_id: " +
      branchID
    );

  }


  const branch =
    branchRows[0];


  //------------------------------------------------
  // Resolve nationality
  //------------------------------------------------

  let nationalityName = "";


  if (
    record.nationality_id !== null &&
    record.nationality_id !== undefined &&
    record.nationality_id !== ""
  ) {

    const nationalityRows =
      supabaseGetById_(
        supabase,
        "tbl_nationalities",
        "id",
        normalizeKey_(
          record.nationality_id
        ),
        [
          "id",
          "country_name",
          "nationality_label"
        ]
      );


    if (
      nationalityRows.length === 0
    ) {

      throw new Error(
        "Nationality not found: " +
        record.nationality_id
      );

    }


    nationalityName =
      nationalityRows[0].nationality_label ||
      nationalityRows[0].country_name ||
      "";

  }


  //------------------------------------------------
  // Resolve feeding type
  //------------------------------------------------

  let feedingName = "";


  if (
    record.feeding_type_id !== null &&
    record.feeding_type_id !== undefined &&
    record.feeding_type_id !== ""
  ) {

    const feedingRows =
      supabaseGetById_(
        supabase,
        "tbl_feeding_types",
        "id",
        normalizeKey_(
          record.feeding_type_id
        ),
        [
          "id",
          "name"
        ]
      );


    if (
      feedingRows.length === 0
    ) {

      throw new Error(
        "Feeding type not found: " +
        record.feeding_type_id
      );

    }


    feedingName =
      feedingRows[0].name ||
      "";

  }


  //------------------------------------------------
  // Resolve diet type
  //------------------------------------------------

  let dietName = "";


  if (
    record.diet_type_id !== null &&
    record.diet_type_id !== undefined &&
    record.diet_type_id !== ""
  ) {

    const dietRows =
      supabaseGetById_(
        supabase,
        "tbl_diet_types",
        "id",
        normalizeKey_(
          record.diet_type_id
        ),
        [
          "id",
          "name"
        ]
      );


    if (
      dietRows.length === 0
    ) {

      throw new Error(
        "Diet type not found: " +
        record.diet_type_id
      );

    }


    dietName =
      dietRows[0].name ||
      "";

  }


  //------------------------------------------------
  // Resolve reviewer / staff
  //------------------------------------------------

  let registeredBy = "";


  if (
    record.reviewed_by
  ) {

    const staffRows =
      supabaseGetById_(
        supabase,
        CONFIG.SUPABASE.STAFF_TABLE,
        "StaffID",
        normalizeKey_(
          record.reviewed_by
        ),
        [
          "StaffID",
          "staff_name"
        ]
      );


    if (
      staffRows.length > 0
    ) {

      registeredBy =
        staffRows[0].staff_name ||
        record.reviewed_by;

    }
    else {

      registeredBy =
        record.reviewed_by;

    }

  }


  //------------------------------------------------
  // Supabase ResidentID → Google ResidentID
  //
  // IMPORTANT:
  // Supabase is the master for ResidentID.
  // Google copies the value exactly.
  //
  // Example:
  //
  // Supabase:
  //   ResidentID = AMN-0001
  //
  // Google:
  //   ResidentID = AMN-0001
  //------------------------------------------------

  const residentID =
    String(
      record.ResidentID || ""
    ).trim();

  if (!residentID) {

    throw new Error(
      "Supabase resident " +
      String(record.id || "") +
      " has a blank ResidentID."
    );

  }


  //------------------------------------------------
  // Build Google record
  //------------------------------------------------

  const data = {

    ResidentID:
      residentID,

    Residents:
      record.resident_name || "",

    Branch:
      branch.BranchLocale || "",

    IC:
      record.ic_number || "",

    Age:
      record.age ?? "",

    Nationality:
      nationalityName,

    Gender:
      record.gender || "",

    MaritalStatus:
      record.marital_status || "",

    Status:
      record.status || "",

    Category:
      record.category || "",

    CareType:
      record.care_type || "",

    AdmissionDate:
      record.admission_date || "",

    DischargeDate:
      record.discharge_date || "",

    AdmitFrom:
      record.transfer_from || "",

    AccompaniedBy:
      record.accompanied_by || "",

    EmergencyContact:
      record.emergency_contact || "",

    Allergy:
      record.allergy || "",

    PastMedicalCondition:
      record.past_medical_condition || "",

    CurrentMedList:
      record.current_medication_list || "",

    Mobility:
      record.mobility || "",

    Feeding:
      feedingName,

    Hygiene:
      record.hygiene || "",

    Diet:
      dietName,

    Languages:
      record.languages || "",

    CareGoal:
      record.care_goal || "",

    NextTCA:
      record.tca_notes || "",

    AssessmentSummary:
      record.assessment_and_summary || "",

    RegisteredBy:
      registeredBy,

    CloudLastUpdated:
      new Date(),

    SupabaseUpdatedAt:
      record.updated_at || ""

  };


  //------------------------------------------------
  // Write to Google
  //------------------------------------------------

  return upsertResidentFromSupabase_(
    data,
    eventType
  );

}

/**
 * Get a single Supabase record by ID.
 */
function supabaseGetById_(
  supabase,
  tableName,
  idColumn,
  idValue,
  selectColumns
) {

  const endpoint =
    supabase.url +
    "/rest/v1/" +
    encodeURIComponent(
      tableName
    ) +
    "?" +
    encodeURIComponent(
      idColumn
    ) +
    "=eq." +
    encodeURIComponent(
      idValue
    ) +
    "&select=" +
    encodeURIComponent(
      selectColumns.join(",")
    ) +
    "&limit=1";


  const response =
    UrlFetchApp.fetch(
      endpoint,
      {
        method: "get",

        muteHttpExceptions: true,

        headers: {
          apikey:
            supabase.apiKey,

          Accept:
            "application/json"
        }
      }
    );


  const statusCode =
    response.getResponseCode();


  const body =
    response.getContentText();


  if (
    statusCode < 200 ||
    statusCode >= 300
  ) {

    throw new Error(
      "Supabase lookup failed for " +
      tableName +
      " (" +
      statusCode +
      "): " +
      body
    );

  }


  const rows =
    JSON.parse(
      body
    );


  if (
    !Array.isArray(rows)
  ) {

    throw new Error(
      "Unexpected Supabase lookup response for " +
      tableName
    );

  }


  return rows;

}

/**
 * Insert or update one resident in Google.
 */
function upsertResidentFromSupabase_(
  data,
  eventType
) {

  const sheet =
    getSheet(
      CONFIG.SHEETS.RESIDENT
    );


  if (!sheet) {

    throw new Error(
      "Resident sheet not found: " +
      CONFIG.SHEETS.RESIDENT
    );

  }


  const headers =
    getHeaders(
      sheet
    );


  const residentIDColumn =
    headers.indexOf(
      "ResidentID"
    );


  if (
    residentIDColumn === -1
  ) {

    throw new Error(
      "ResidentID column not found."
    );

  }


  //------------------------------------------------
  // Find existing resident
  //------------------------------------------------

  let targetRow = -1;


  const lastRow =
    sheet.getLastRow();


  if (
    lastRow >= 2
  ) {

    const match =
      sheet
        .getRange(
          2,
          residentIDColumn + 1,
          lastRow - 1,
          1
        )
        .createTextFinder(
          String(
            data.ResidentID
          )
        )
        .matchEntireCell(
          true
        )
        .findNext();


    if (match) {

      targetRow =
        match.getRow();

    }

  }


  //------------------------------------------------
  // Build Google row
  //------------------------------------------------

  const row =
    headers.map(
      function(header) {

        if (
          header ===
          "CloudLastUpdated"
        ) {

          return new Date();

        }


        if (
          Object.prototype.hasOwnProperty.call(
            data,
            header
          )
        ) {

          return data[header] ?? "";

        }


        // Existing Google-only fields remain untouched
        // when updating an existing resident.
        if (
          targetRow !== -1
        ) {

          return sheet
            .getRange(
              targetRow,
              headers.indexOf(header) + 1
            )
            .getValue();

        }


        return "";

      }
    );


  //------------------------------------------------
  // Insert
  //------------------------------------------------

  if (
    targetRow === -1
  ) {

    sheet.appendRow(
      row
    );


    return {

      success: true,

      action:
        "Inserted",

      event:
        eventType,

      ResidentID:
        data.ResidentID

    };

  }


  //------------------------------------------------
  // Update
  //------------------------------------------------

  sheet
    .getRange(
      targetRow,
      1,
      1,
      row.length
    )
    .setValues([
      row
    ]);


  return {

    success: true,

    action:
      "Updated",

    event:
      eventType,

    ResidentID:
      data.ResidentID

  };

}

function validateResidentWebhookToken_(e) {

  const expected =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        "OSEM_RESIDENT_WEBHOOK_TOKEN"
      );

  const received =
    e &&
    e.parameter &&
    e.parameter.token
      ? e.parameter.token
      : "";

  if (
    !expected ||
    received !== expected
  ) {
    throw new Error(
      "Invalid resident webhook token."
    );
  }
}
