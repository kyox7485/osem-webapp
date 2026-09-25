let STAFF_CACHE = null;

function getStaffName(staffID){

    if(!STAFF_CACHE){

        Logger.log("Loading staff cache...");

        STAFF_CACHE = {};

        const settingsID =
            getConfigValue("SystemSettingsID");

        const ss =
            SpreadsheetApp.openById(settingsID);

        const sheet =
            ss.getSheetByName(
                CONFIG.STAFF_SHEET
            );

        const data =
            sheet.getDataRange().getValues();

        const header =
            data.shift();

        const idCol =
            header.indexOf("StaffID");

        const nameCol =
            header.indexOf("StaffName");

        data.forEach(function(row){

            STAFF_CACHE[
                row[idCol]
            ] = row[nameCol];

        });

    }

    return STAFF_CACHE[
        staffID
    ] || "";

}