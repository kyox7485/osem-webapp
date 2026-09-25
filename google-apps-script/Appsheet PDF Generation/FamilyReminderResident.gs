function getResidentFamilyReminder(residentID){

  const latestStock =
      getLatestMedicationStock();

  const medicationOrders =
      getMedicationOrders();

  const residents =
      getResidents();

  let reminderList = [];

  latestStock.forEach(function(stock){

      const medication =
          medicationOrders[
              stock.RxOrderID
          ];

      if(!medication)
          return;

      if(
          medication["Status"] != "Active"
      )
          return;

      if(
          medication["ResidentID"] == ""
      )
          return;

      const resident =
          residents[
              medication["ResidentID"]
          ];

      if(!resident)
          return;

      if(
          medication["ResidentID"] != residentID
      )
          return;

      // Only medicines supplied by family
      if(
          medication["Supplied By"] != "Family"
      )
          return;

      const trackingMethod =
          getTrackingMethod(
              stock.Unit
          );

      let requireReminder = false;

      if(
          trackingMethod == "Count" &&
          stock["Days Remaining"] !== "" &&
          Number(stock["Days Remaining"]) <= 14
      ){

          requireReminder = true;

      }

      if(
          trackingMethod == "Estimate" &&
          Number(stock.Balance) <= 1
      ){

          requireReminder = true;

      }

      if(!requireReminder)
          return;

      reminderList.push({

          resident: resident,

          medication: medication,

          stock: stock

      });

  });

  reminderList.sort(function(a,b){

      const residentCompare =
          a.resident.Residents.localeCompare(
              b.resident.Residents
          );

      if(residentCompare !== 0)
          return residentCompare;

      return buildPurchaseDescription(
          a.medication
      ).localeCompare(
          buildPurchaseDescription(
              b.medication
          )
      );

  });

  return reminderList;

}

function testFamilyReminderList(){

    const list =
      getResidentFamilyReminder("AMN-14");

    Logger.log(
        "Total Reminder Items : "
        + list.length
    );

    list.forEach(function(item){

        Logger.log(

            item.resident["Residents"]

            + " | "

            + item.medication["Active Ingredient"]

            + " | "

            + item.stock["Days Remaining"]

        );

    });

}

function writeFamilyReminderRows(sheet, reminderList){

  const startRow =
      Number(getConfigValue("PurchaseFirstRow"));

  let row = startRow;

  let previousResident = "";

  reminderList.forEach(function(item){

      const residentName =
          item.resident["Residents"];

      if(residentName != previousResident){

          if(previousResident != ""){

              row++;

          }

          sheet
              .getRange(row,1)
              .setValue(residentName)
              .setFontWeight("bold")
              .setFontSize(12);

          previousResident = residentName;

          row++;

      }

      sheet
          .getRange(row,2)
          .setValue(
              buildPurchaseDescription(
                  item.medication
              )
          )
          .setWrap(true);

      sheet
          .getRange(row,3)
          .setValue(
            buildStockStatus(item.stock)
          );

      row++;

  });

}

function generateResidentFamilyReminderReport(
    residentID,
    executionId
){

    //------------------------------------------------
    // Get reminder list
    //------------------------------------------------

    const reminderList =
        getResidentFamilyReminder(
            residentID
        );

    if(reminderList.length == 0){

        throw new Error(
            "This resident has no family medication requiring reminder."
        );

    }

    //------------------------------------------------
    // Get resident
    //------------------------------------------------

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
    // Spreadsheet
    //------------------------------------------------

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    //------------------------------------------------
    // Get template
    //------------------------------------------------

    const template =
        ss.getSheetByName(
            getConfigValue(
                "ResidentReminderTemplate"
            )
        );

    if(!template){

        throw new Error(
            "Resident Reminder Template not found."
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
            "ResidentReminder"
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
        Object.values(branches)
        .find(function(b){

            return (
                b.BranchLocale ==
                resident.Branch
            );

        });

    if(branch){

        report
            .getRange("E3")
            .setValue(
                branch.BranchLocale
            );

    }else{

        report
            .getRange("E3")
            .setValue(
                resident.Branch
            );

    }

    //------------------------------------------------
    // Medicine list
    //------------------------------------------------

    writeResidentFamilyReminderRows(
        report,
        reminderList,
        executionId
    );

    //------------------------------------------------
    // Remove unused rows
    //
    // Medication list starts at row 11.
    // Keep 2 blank rows after the final item.
    //------------------------------------------------

    const firstRow = 11;

    const extraRows = 2;

    const lastRequiredRow =
        firstRow +
        reminderList.length -
        1 +
        extraRows;

    const maxRows =
        report.getMaxRows();

    if(lastRequiredRow < maxRows){

        report.deleteRows(
            lastRequiredRow + 1,
            maxRows - lastRequiredRow
        );

    }

    //------------------------------------------------
    // Return report
    //------------------------------------------------

    return report;

}

function testFamilyReminderReport(){

    generateFamilyReminderReport("AMN-138");

}

function getResidentFamilyReminderFilename(residentID){

    const resident =
        getResident(residentID);

    const generatedAt =
        Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "yyyyMMdd_HHmmss"
        );

    return (

        "FamilyMedicationReminder_"

        + safeFileName(
            resident.Residents
        )

        + "_"

        + generatedAt

        + ".pdf"

    );

}

function generateResidentFamilyReminderPdf(
    residentID,
    executionId
){

    //------------------------------------------------
    // Get resident
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        15,
        "Preparing resident family medication reminder..."
    );


    //------------------------------------------------
    // Generate report
    //------------------------------------------------

    const report =
        generateResidentFamilyReminderReport(
            residentID,
            executionId
        );


    updateDetailedReportProgress(
        executionId,
        57,
        "Reminder prepared. Creating PDF workbook..."
    );


    //------------------------------------------------
    // Temporary workbook
    //------------------------------------------------

    const temp =
        createTemporaryWorkbook({

            resident:{
                Residents:
                    "Family Reminder Report"
            }

        });


    updateDetailedReportProgress(
        executionId,
        65,
        "Preparing family reminder workbook..."
    );


    //------------------------------------------------
    // Keep report
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
        "Finalising resident reminder..."
    );


    //------------------------------------------------
    // Filename
    //------------------------------------------------

    const filename =
        getResidentFamilyReminderFilename(
            residentID
        );


    //------------------------------------------------
    // Export
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        82,
        "Exporting resident reminder to PDF..."
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
        "Resident family reminder completed."
    );


    return{

        filename:
            filename,

        pdf:
            pdf

    };

}

function testResidentFamilyReminder(){

    const list =
        getResidentFamilyReminder("AMN-138");

    Logger.log(
        "Total Items: " + list.length
    );

    list.forEach(function(item){

        Logger.log(

            item.resident.Residents +

            " | " +

            item.medication["Active Ingredient"]

        );

    });

}

function writeResidentFamilyReminderRows(
    sheet,
    reminderList,
    executionId
){

    const startRow =
        Number(
            getConfigValue(
                "ResidentReminderFirstRow"
            )
        );

    let row = startRow;

    const totalItems =
        reminderList.length;


    reminderList.forEach(function(
        item,
        index
    ){

        //------------------------------------------------
        // Real progress
        //------------------------------------------------

        const progress =
            totalItems > 0
                ? 20 +
                  (
                      (index + 1) /
                      totalItems
                  ) * 35
                : 55;


        updateDetailedReportProgress(
            executionId,
            progress,
            "Preparing family reminder " +
            (index + 1) +
            " of " +
            totalItems +
            "..."
        );


        //------------------------------------------------
        // Medicine
        //------------------------------------------------

        sheet
            .getRange(row,1)
            .setValue(
                buildPurchaseDescription(
                    item.medication
                )
            )
            .setWrap(true);


        //------------------------------------------------
        // Stock
        //------------------------------------------------

        sheet
            .getRange(row,3)
            .setValue(
                buildStockStatus(
                    item.stock
                )
            );


        row++;

    });

}

function generateResidentCompleteMedicationReminderReport(
    residentID,
    executionId
){

    //------------------------------------------------
    // Get medication list
    //------------------------------------------------

    const medicationList =
        getResidentCompleteMedicationList(
            residentID
        );

    if(medicationList.length == 0){

        throw new Error(
            "This resident has no active medication."
        );

    }

    //------------------------------------------------
    // Get resident
    //------------------------------------------------

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
    // Spreadsheet
    //------------------------------------------------

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    //------------------------------------------------
    // Get complete reminder template
    //------------------------------------------------

    const template =
        ss.getSheetByName(
            "Resident Reminder Template (Complete)"
        );

    if(!template){

        throw new Error(
            "Resident Reminder Template (Complete) not found."
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
            "ResidentCompleteReminder"
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
        Object.values(branches)
        .find(function(b){

            return (
                b.BranchLocale ==
                resident.Branch
            );

        });

    if(branch){

        report
            .getRange("E3")
            .setValue(
                branch.BranchLocale
            );

    }else{

        report
            .getRange("E3")
            .setValue(
                resident.Branch
            );

    }

    //------------------------------------------------
    // Write medication rows
    //------------------------------------------------

    const firstRow = 11;

    medicationList.forEach(function(item, index){

        const row =
            firstRow + index;

    //------------------------------------------------
    // Real progress
    //------------------------------------------------

    const totalItems =
        medicationList.length;

    const progress =
        totalItems > 0
            ? 20 +
              (
                  (index + 1) /
                  totalItems
              ) * 35
            : 55;

    updateDetailedReportProgress(
        executionId,
        progress,
        "Preparing medication stock item " +
        (index + 1) +
        " of " +
        totalItems +
        "..."
    );

        //------------------------------------------------
        // A = Medicine
        //------------------------------------------------

        report
            .getRange(row, 1)
            .setValue(
                item.description
            );

        //------------------------------------------------
        // B = Latest Count
        //------------------------------------------------

        if(item.stock){

            report
                .getRange(row, 2)
                .setValue(
                    item.balance +
                    " " +
                    item.unit
                );

        }else{

            report
                .getRange(row, 2)
                .setValue(
                    "Not counted"
                );

        }

        //------------------------------------------------
        // C = How long it can last
        //------------------------------------------------

        if(
            item.daysRemaining !== "" &&
            item.daysRemaining !== null &&
            item.daysRemaining !== undefined
        ){

            report
                .getRange(row, 3)
                .setValue(
                    item.daysRemaining +
                    " days"
                );

        }else{

            report
                .getRange(row, 3)
                .setValue(
                    "Not available"
                );

        }

    });

    //------------------------------------------------
    // Remove unused rows
    //
    // Keep 2 blank rows after the medication list.
    //------------------------------------------------

    const extraRows = 2;

    const lastRequiredRow =
        firstRow +
        medicationList.length -
        1 +
        extraRows;

    const maxRows =
        report.getMaxRows();

    if(lastRequiredRow < maxRows){

        report.deleteRows(
            lastRequiredRow + 1,
            maxRows - lastRequiredRow
        );

    }

    //------------------------------------------------
    // Return report
    //------------------------------------------------

    return report;

}