let RESIDENT_CACHE = null;

function loadResidentCache(){

    if(RESIDENT_CACHE){

        return;

    }

    Logger.log("Loading resident cache...");

    const settingsID =
        getConfigValue("SystemSettingsID");

    const ss =
        SpreadsheetApp.openById(settingsID);

    const sheet =
        ss.getSheetByName(
            CONFIG.RESIDENT_SHEET
        );

    const data =
        sheet.getDataRange().getValues();

    const header =
        data.shift();

    const idCol =
        header.indexOf("ResidentID");

    RESIDENT_CACHE = {};

    data.forEach(function(row){

        let resident = {};

        header.forEach(function(name,index){

            resident[name] = row[index];

        });

        RESIDENT_CACHE[
            row[idCol]
        ] = resident;

    });

}