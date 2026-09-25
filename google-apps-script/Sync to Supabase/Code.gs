function handleSyncMedicationOrderWebhook_(request) {
  const result = syncMedicationOrderAndSummaryNow(
    request.RxOrderID,
    request.ResidentID
  );

  return {
    success: true,
    action: "SyncMedicationOrder",
    result: result
  };
}

function doPost(e) {
  try {
    const request =
      e && e.postData && e.postData.contents
        ? JSON.parse(e.postData.contents)
        : {};

    //------------------------------------------------------------
    // MEDICATION ORDER CREATE/UPDATE (Next.js webapp)
    //------------------------------------------------------------
    // This has its own auth (SHARED_SECRET, from medication-orders.gs) and
    // is handled before the MEDICATION_WEBHOOK_TOKEN gate below, which does
    // not apply to it. This branch used to live in a second, competing
    // doPost() defined in medication-orders.gs — Apps Script only allows one
    // global doPost per project, so whichever file loaded last silently
    // discarded the other's routes. Consolidated here as the single entry
    // point; medication-orders.gs now only exports createOrder/updateOrder.
    // stockCreate (MedicationStock.gs) and setOrderStatus
    // (medication-orders.gs) are webapp writes too, so they share the same
    // SHARED_SECRET gate.
    if (
      request.action === "create" ||
      request.action === "update" ||
      request.action === "setOrderStatus" ||
      request.action === "stockCreate"
    ) {
      if (request.secret !== SHARED_SECRET) {
        return ContentService
          .createTextOutput(
            JSON.stringify({ success: false, error: "Unauthorized" })
          )
          .setMimeType(ContentService.MimeType.JSON);
      }

      let result;
      if (request.action === "create") {
        result = createOrder(request.order);
      } else if (request.action === "update") {
        result = updateOrder(request.rxOrderId, request.order);
      } else if (request.action === "setOrderStatus") {
        result = setOrderStatus(request.rxOrderIds, request.status);
      } else {
        result = createStockEntry(request.entry);
      }

      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const expectedToken =
      PropertiesService
        .getScriptProperties()
        .getProperty("MEDICATION_WEBHOOK_TOKEN");

    const suppliedToken =
      request.token ||
      (e && e.parameter ? e.parameter.token : "");

    if (
      expectedToken &&
      suppliedToken !== expectedToken
    ) {
      return ContentService
        .createTextOutput(
          JSON.stringify({
            success: false,
            error: "Unauthorized"
          })
        )
        .setMimeType(
          ContentService.MimeType.JSON
        );
    }

    //------------------------------------------------------------
    // TARGETED MEDICATION SYNC
    //------------------------------------------------------------
    if (
      request.action ===
      "SyncMedicationOrder"
    ) {
      const result =
        handleSyncMedicationOrderWebhook_(
          request
        );

      return ContentService
        .createTextOutput(
          JSON.stringify(result)
        )
        .setMimeType(
          ContentService.MimeType.JSON
        );
    }

    //------------------------------------------------------------
    // EXISTING REBUILD MEDICATION ACTION
    //------------------------------------------------------------
    if (
      request.action ===
      "RebuildMedication"
    ) {
      rebuildCurrentMedication(
        request.ResidentID
      );

      return ContentService
        .createTextOutput(
          JSON.stringify({
            success: true,
            action: "RebuildMedication"
          })
        )
        .setMimeType(
          ContentService.MimeType.JSON
        );
    }

    //------------------------------------------------------------
    // UNKNOWN ACTION
    //------------------------------------------------------------
    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error:
            "Unknown action: " +
            (request.action || "")
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );

  } catch (err) {

    console.error(err);

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error: err.toString()
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );
  }
}

function doGet(e) {

  try {

    const action =
      e.parameter.action || "";

    //------------------------------------------------
    // Medication update for ONE resident
    //------------------------------------------------

    if (
      action ==
      "MedicationByResident"
    ) {

      return ContentService
        .createTextOutput(
          JSON.stringify(
            getMedicationByResident(
              e.parameter.residentID
            )
          )
        )
        .setMimeType(
          ContentService.MimeType.JSON
        );

    }

    //------------------------------------------------
    // Existing bulk medication update
    //------------------------------------------------

    if (
      action ==
      "MedicationUpdates"
    ) {

      return ContentService
        .createTextOutput(
          JSON.stringify(
            getMedicationUpdates(
              e.parameter.lastSync
            )
          )
        )
        .setMimeType(
          ContentService.MimeType.JSON
        );

    }

    if (
      e.parameter.action ==
      "VitalUpdates"
    ) {

      return ContentService
        .createTextOutput(
          JSON.stringify(
            getVitalUpdates(
              e.parameter.lastSync
            )
          )
        )
        .setMimeType(
          ContentService.MimeType.JSON
        );

    }

    //------------------------------------------------
    // Unknown action
    //------------------------------------------------

    return ContentService
      .createTextOutput(
        JSON.stringify({

          success: false,

          error:
            "Unknown action: " +
            action

        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );

  }

  catch(err){

    return ContentService
      .createTextOutput(
        JSON.stringify({

          success:false,

          error:
            err.toString()

        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );

  }

}

function testMedicationUpdates(){

  Logger.log(
    JSON.stringify(
      getMedicationUpdates("2000-01-01T00:00:00"),
      null,
      2
    )
  );

}

function getClinicalSheet(sheetName) {

  return SpreadsheetApp
    .openById(
      CONFIG.CLINICAL_SPREADSHEET_ID
    )
    .getSheetByName(
      sheetName
    );

}

function getVitalUpdates(lastSync) {

  const vitalSheet =
    getClinicalSheet(
      CONFIG.SHEETS.VITAL
    );

  const vitalData =
    vitalSheet
      .getDataRange()
      .getValues();

  if (
    vitalData.length < 2
  ) {

    return [];

  }

  const vitalHeader =
    vitalData[0];

  const vitalIDCol =
    vitalHeader.indexOf("VitalID");

  const residentIDCol =
    vitalHeader.indexOf("ResidentID");

  const timestampCol =
    vitalHeader.indexOf("Timestamp");

  const systolicCol =
    vitalHeader.indexOf("Systolic BP");

  const diastolicCol =
    vitalHeader.indexOf("Diastolic BP");

  const heartRateCol =
    vitalHeader.indexOf("Heart Rate");

  const temperatureCol =
    vitalHeader.indexOf("Temperature");

  const spo2Col =
    vitalHeader.indexOf("Spo2");

  const spo2ConCol =
    vitalHeader.indexOf("Spo2Con");

  const dxtCol =
    vitalHeader.indexOf("DXT");

  const dxtRemarkCol =
    vitalHeader.indexOf("DXTRemark");

  const insulinCol =
    vitalHeader.indexOf("Insulin Adjustment");

  const reviewByCol =
    vitalHeader.indexOf("Review by");


  //------------------------------------------------
  // Validate required columns
  //------------------------------------------------

  const requiredColumns = [

    ["VitalID", vitalIDCol],
    ["ResidentID", residentIDCol],
    ["Timestamp", timestampCol]

  ];

  requiredColumns.forEach(function(item) {

    if (
      item[1] === -1
    ) {

      throw new Error(
        "Vital column not found: " +
        item[0]
      );

    }

  });


  //------------------------------------------------
  // Resident lookup
  //------------------------------------------------

  const residentSheet =
    getSystemSheet(
      CONFIG.SHEETS.RESIDENT
    );

  const residentData =
    residentSheet
      .getDataRange()
      .getValues();

  const residentHeader =
    residentData[0];

  const residentIDLookupCol =
    residentHeader.indexOf(
      "ResidentID"
    );

  const residentNameCol =
    residentHeader.indexOf(
      "Residents"
    );


  const residentMap = {};

  for (
    let i = 1;
    i < residentData.length;
    i++
  ) {

    const id =
      String(
        residentData[i][residentIDLookupCol]
        || ""
      ).trim();

    if (!id)
      continue;

    residentMap[id] =
      residentData[i][residentNameCol];

  }


  //------------------------------------------------
  // Last sync time
  //------------------------------------------------

  const lastSyncTime =
    new Date(lastSync).getTime();

  if (
    isNaN(lastSyncTime)
  ) {

    throw new Error(
      "Invalid lastSync: " +
      lastSync
    );

  }


  //------------------------------------------------
  // Build results
  //------------------------------------------------

  const results = [];

  for (
    let i = 1;
    i < vitalData.length;
    i++
  ) {

    const timestamp =
      vitalData[i][timestampCol];

    if (!timestamp)
      continue;

    const vitalTime =
      new Date(timestamp).getTime();

    if (
      isNaN(vitalTime)
    )
      continue;

    if (
      vitalTime <= lastSyncTime
    )
      continue;


    const residentID =
      String(
        vitalData[i][residentIDCol]
        || ""
      ).trim();


    results.push({

      VitalID:
        vitalData[i][vitalIDCol],

      ResidentID:
        residentID,

      ResidentName:
        residentMap[residentID] || "",

      Timestamp:
        timestamp,

      SystolicBP:
        systolicCol === -1
          ? ""
          : vitalData[i][systolicCol],

      DiastolicBP:
        diastolicCol === -1
          ? ""
          : vitalData[i][diastolicCol],

      HeartRate:
        heartRateCol === -1
          ? ""
          : vitalData[i][heartRateCol],

      Temperature:
        temperatureCol === -1
          ? ""
          : vitalData[i][temperatureCol],

      Spo2:
        spo2Col === -1
          ? ""
          : vitalData[i][spo2Col],

      Spo2Con:
        spo2ConCol === -1
          ? ""
          : vitalData[i][spo2ConCol],

      DXT:
        dxtCol === -1
          ? ""
          : vitalData[i][dxtCol],

      DXTRemark:
        dxtRemarkCol === -1
          ? ""
          : vitalData[i][dxtRemarkCol],

      InsulinAdjustment:
        insulinCol === -1
          ? ""
          : vitalData[i][insulinCol],

      ReviewBy:
        reviewByCol === -1
          ? ""
          : vitalData[i][reviewByCol]

    });

  }


  //------------------------------------------------
  // Sort oldest → newest
  //------------------------------------------------

  results.sort(function(a, b) {

    return new Date(a.Timestamp) -
           new Date(b.Timestamp);

  });


  return results;

}

function testVitalUpdates() {

  Logger.log(
    JSON.stringify(
      getVitalUpdates(
        "2000-01-01T00:00:00"
      ),
      null,
      2
    )
  );

}


