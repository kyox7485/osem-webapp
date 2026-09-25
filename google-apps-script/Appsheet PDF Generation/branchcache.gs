let BRANCH_CACHE = null;

function loadBranchCache(){

    if(BRANCH_CACHE){

        return;

    }

    Logger.log("Loading branch cache...");

    const settingsID =
        getConfigValue("SystemSettingsID");

    const ss =
        SpreadsheetApp.openById(settingsID);

    const sheet =
        ss.getSheetByName(
            CONFIG.BRANCH_SHEET
        );

    const data =
        sheet.getDataRange().getValues();

    const header =
        data.shift();

    const branchCol =
        header.indexOf("BranchLocale");

    BRANCH_CACHE = {};

    data.forEach(function(row){

        let branch = {};

        header.forEach(function(name,index){

            branch[name] = row[index];

        });

        BRANCH_CACHE[
            row[branchCol]
        ] = branch;

    });

}
