let MEDICATION_CACHE = null;
let RESIDENT_MEDICATION_CACHE = null;
let MEDICATION_ORDER_CACHE = null;

function loadMedicationCache(){
 
    if(MEDICATION_CACHE){

        return;

    }

    Logger.log("Loading medication cache...");

    const medicationID =
        getConfigValue("MedicationModuleID");

    const ss =
        SpreadsheetApp.openById(
            medicationID
        );

    const sheet =
        ss.getSheetByName(
            CONFIG.MEDICATION_ORDER_SHEET
        );

    const data =
        sheet.getDataRange().getValues();

    const header =
        data.shift();

    MEDICATION_CACHE = [];

    RESIDENT_MEDICATION_CACHE = {};

    MEDICATION_ORDER_CACHE = {};

    data.forEach(function(row){

        let medication = {};

        header.forEach(function(name,index){

            medication[name] = row[index];

        });

        MEDICATION_CACHE.push(
            medication
        );

        MEDICATION_ORDER_CACHE[
            medication["RxOrderID"]
        ] = medication;

        const residentID =
          medication["ResidentID"];

      if(
          !RESIDENT_MEDICATION_CACHE[
              residentID
          ]
      ){

          RESIDENT_MEDICATION_CACHE[
              residentID
          ] = [];

      }

      if(
          medication["Status"] == "Active"
      ){

          RESIDENT_MEDICATION_CACHE[
              residentID
          ].push(
              medication
          );

      }

    });

}