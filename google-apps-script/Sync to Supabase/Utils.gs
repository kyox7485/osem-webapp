function getSystemSheet(sheetName){

  return SpreadsheetApp
    .openById(CONFIG.SYSTEM_SPREADSHEET_ID)
    .getSheetByName(sheetName);

}

function getMedicationSheet(sheetName){

  return SpreadsheetApp
    .openById(CONFIG.MEDICATION_SPREADSHEET_ID)
    .getSheetByName(sheetName);

}

function getHeaders(sheet){

  return sheet
      .getRange(1,1,1,sheet.getLastColumn())
      .getValues()[0];

}


function testMedicationWebhook() {

  const url =
    "https://script.google.com/macros/s/AKfycbx7o8az8IZok4H-C1fVQaT727ihgmQFeqimL0eic_ADKrjW_1jZfeM2CVtwqg5zDDkc/exec";

  const token =
    PropertiesService
      .getScriptProperties()
      .getProperty("MEDICATION_WEBHOOK_TOKEN");

  const payload = {
    action: "SyncMedicationOrder",
    token: token
  };

  const response = UrlFetchApp.fetch(
    url,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  Logger.log(
    response.getResponseCode()
  );

  Logger.log(
    response.getContentText()
  );

}
