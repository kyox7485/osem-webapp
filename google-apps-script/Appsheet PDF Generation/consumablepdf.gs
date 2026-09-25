function generateResidentFamilyConsumableReminderPdf(
    residentID,
    executionId
){

    //------------------------------------------------
    // Normalize
    //------------------------------------------------

    residentID =
        String(
            residentID || ""
        ).trim();


    if(!residentID){

        throw new Error(
            "Missing ResidentID."
        );

    }


    //------------------------------------------------
    // Get resident
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        15,
        "Preparing family consumable reminder..."
    );


    const resident =
        getResident(
            residentID
        );


    if(!resident){

        throw new Error(
            "Resident not found: " +
            residentID
        );

    }


    //------------------------------------------------
    // Generate report
    //------------------------------------------------

    const report =
        generateResidentFamilyConsumableReminderReport(
            residentID,
            executionId
        );


    updateDetailedReportProgress(
        executionId,
        57,
        "Consumable reminder prepared. Creating PDF workbook..."
    );


    //------------------------------------------------
    // Temporary workbook
    //------------------------------------------------

    const temp =
        createTemporaryWorkbook({

            resident:{
                Residents:
                    "Family Consumable Reminder"
            }

        });


    updateDetailedReportProgress(
        executionId,
        65,
        "Preparing consumable reminder workbook..."
    );


    //------------------------------------------------
    // Keep report only
    //------------------------------------------------

    keepOnlySheets(
        temp,
        [
            report.getName()
        ]
    );


    updateDetailedReportProgress(
        executionId,
        72,
        "Preparing report layout..."
    );


    //------------------------------------------------
    // Flush
    //------------------------------------------------

    SpreadsheetApp.flush();

    Utilities.sleep(
        2000
    );


    updateDetailedReportProgress(
        executionId,
        78,
        "Finalising consumable reminder..."
    );


    //------------------------------------------------
    // Filename
    //------------------------------------------------

    const generatedAt =
        Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "yyyyMMdd_HHmmss"
        );


    const residentName =
        safeFileName(
            resident.Residents
        );


    const filename =
        "FamilyConsumableReminder_" +
        residentName +
        "_" +
        generatedAt +
        ".pdf";


    //------------------------------------------------
    // Export
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        82,
        "Exporting consumable reminder to PDF..."
    );


    const pdf =
        exportWorkbookToPdf(
            temp,
            filename,
            true
        );


    updateDetailedReportProgress(
        executionId,
        94,
        "PDF generated. Cleaning up..."
    );


    //------------------------------------------------
    // Cleanup
    //------------------------------------------------

    deleteTemporaryWorkbook(
        temp
    );


    SpreadsheetApp
        .getActiveSpreadsheet()
        .deleteSheet(
            report
        );


    updateDetailedReportProgress(
        executionId,
        95,
        "Family consumable reminder completed."
    );


    return{

        filename:
            filename,

        pdf:
            pdf

    };

}

function generateResidentFamilyConsumableReminderReport(
    residentID,
    executionId
){

    Logger.log("================================");
    Logger.log("FAMILY CONSUMABLE REPORT");
    Logger.log("ResidentID received = [" + residentID + "]");

    //------------------------------------------------
    // Get resident
    //------------------------------------------------

    const resident =
        getResident(
            residentID
        );

    Logger.log(
        "Resident found = " +
        (resident ? "YES" : "NO")
    );

    if(!resident){

        throw new Error(
            "Resident not found: [" +
            residentID +
            "]"
        );

    }

    //------------------------------------------------
    // Get consumables
    //------------------------------------------------

    const reminderList =
        getResidentFamilyConsumableReminderList(
            residentID
        );

    Logger.log(
        "Family consumable count = " +
        reminderList.length
    );

    //------------------------------------------------
    // Log every item
    //------------------------------------------------

    reminderList.forEach(function(item, index){

        Logger.log(
            "Item " +
            (index + 1) +
            " : " +
            item.Master["Consumable"] +
            " | Supplier=[" +
            item["Supplier"] +
            "]"
        );

    });

    //------------------------------------------------
    // Stop if empty
    //------------------------------------------------

    if(
        reminderList.length == 0
    ){

        throw new Error(
            "DEBUG: Web App received zero family consumables for [" +
            residentID +
            "]"
        );

    }

    //------------------------------------------------
    // Spreadsheet
    //------------------------------------------------

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    //------------------------------------------------
    // Template
    //------------------------------------------------

    const template =
        ss.getSheetByName(
            "Resident Consumable Reminder Template"
        );

    if(!template){

        throw new Error(
            "Resident Consumable Reminder Template not found."
        );

    }

    //------------------------------------------------
    // Copy template
    //------------------------------------------------

    const report =
        template.copyTo(
            ss
        );

    report.setName(
        generateReportSheetName(
            "ResidentConsumableReminder"
        )
    );

    //------------------------------------------------
    // Generated On
    //------------------------------------------------

    report
        .getRange("E2")
        .setValue(
            new Date()
        )
        .setNumberFormat(
            "dd/MM/yyyy"
        );

    //------------------------------------------------
    // Resident
    //------------------------------------------------

    report
        .getRange("B5")
        .setValue(
            resident.Residents
        );

    //------------------------------------------------
    // Branch
    //------------------------------------------------

    const branches =
        getBranches();

    const branch =
        Object.values(
            branches
        ).find(function(b){

            return (
                b.BranchLocale ==
                resident.Branch
            );

        });

    report
        .getRange("E3")
        .setValue(
            branch
                ? branch.BranchLocale
                : resident.Branch
        );

    //------------------------------------------------
    // Write rows
    //------------------------------------------------

    writeResidentFamilyConsumableReminderRows(
        report,
        reminderList,
        executionId
    );

    //------------------------------------------------
    // Remove unused rows
    //------------------------------------------------

    const firstRow = 11;

    const lastRequiredRow =
        firstRow +
        reminderList.length -
        1;

    const maxRows =
        report.getMaxRows();

    if(
        lastRequiredRow < maxRows
    ){

        report.deleteRows(
            lastRequiredRow + 1,
            maxRows - lastRequiredRow
        );

    }

    Logger.log(
        "Report generated successfully."
    );

    return report;

}