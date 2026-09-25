function getFamilyReminderList(branch){

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
          resident["Branch"] != branch
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
        getFamilyReminderList("ALMA");

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

function writeFamilyReminderRows(
    sheet,
    reminderList,
    executionId
){

    const startRow =
        Number(
            getConfigValue(
                "PurchaseFirstRow"
            )
        );

    let row = startRow;

    let previousResident = "";

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
            "Preparing family reminder item " +
            (index + 1) +
            " of " +
            totalItems +
            "..."
        );


        //------------------------------------------------
        // Resident
        //------------------------------------------------

        const residentName =
            item.resident[
                "Residents"
            ];


        if(
            residentName !=
            previousResident
        ){

            if(
                previousResident != ""
            ){

                row++;

            }


            sheet
                .getRange(row,1)
                .setValue(
                    residentName
                )
                .setFontWeight(
                    "bold"
                )
                .setFontSize(
                    12
                );


            previousResident =
                residentName;

            row++;

        }


        //------------------------------------------------
        // Medication
        //------------------------------------------------

        sheet
            .getRange(row,2)
            .setValue(
                buildPurchaseDescription(
                    item.medication
                )
            )
            .setWrap(true);


        //------------------------------------------------
        // Stock status
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

function generateFamilyReminderReport(
    branch,
    executionId
){

  const reminderList =
      getFamilyReminderList(branch);

  if(reminderList.length == 0){

    throw new Error(
        "No family medication requires reminder."
    );
  
  }

  const branches =
      getBranches();

  const ss =
      SpreadsheetApp.getActiveSpreadsheet();

  const template =
      ss.getSheetByName(
          getConfigValue("ReminderTemplate")
      );

  const report =
      template.copyTo(ss);

  report.setName(

      generateReportSheetName(
          "FamilyReminder"
      )

  );

  report.getRange("D2")
      .setValue(new Date());

  const branchInfo =
      Object.values(branches)
          .find(function(b){

              return b.BranchLocale == branch;

          });

  if(branchInfo){

      report.getRange("D3")
          .setValue(branchInfo.BranchLocale);

  }

  writeFamilyReminderRows(
      report,
      reminderList,
      executionId
  );

  return report;

}

function testFamilyReminderReport(){

    generateFamilyReminderReport("ALMA");

}

function getFamilyReminderFilename(branch){

    const generatedAt =
        Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "yyyyMMdd_HHmmss"
        );

    return (

        "FamilyMedicationReminder_"

        + branch

        + "_"

        + generatedAt

        + ".pdf"

    );

}

function generateFamilyReminderPdf(
    branch,
    executionId
){

    //------------------------------------------------
    // Load data
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        15,
        "Loading family medication reminder data..."
    );


    const report =
        generateFamilyReminderReport(
            branch,
            executionId
        );


    //------------------------------------------------
    // Create workbook
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        57,
        "Family reminder prepared. Creating PDF workbook..."
    );


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
        "Finalising family reminder..."
    );


    //------------------------------------------------
    // Filename
    //------------------------------------------------

    const filename =
        getFamilyReminderFilename(
            branch
        );


    //------------------------------------------------
    // Export
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        82,
        "Exporting family reminder to PDF..."
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
        "Family reminder PDF generated. Cleaning up..."
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
        "Family reminder completed."
    );


    return{

        filename:
            filename,

        pdf:
            pdf

    };

}

function testFamilyReminderPdf(){

    const result =
        generateFamilyReminderPdf("ALMA");

    const file =
        saveTemporaryPdf(result);

    Logger.log(file.getUrl());

}

function getResidentRestockConsumables(residentID){

    return getResidentFamilyConsumables(
        residentID
    ).filter(function(item){

        return (
            item.Master["RestockRequired"] == "Yes"
            &&
            item.SuggestedRestock > 0
        );

    });

}

function writeResidentFamilyConsumableReminderRows(
    sheet,
    reminderList,
    executionId
){

    const startRow = 11;

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
            "Preparing consumable item " +
            (index + 1) +
            " of " +
            totalItems +
            "..."
        );


        const row =
            startRow +
            index;


        //------------------------------------------------
        // Consumable
        //------------------------------------------------

        const consumableName =
            item.Master["Consumable"] == "Other"
                ? item["OtherConsumable"]
                : item.Master["Consumable"];


        sheet
            .getRange(row,1)
            .setValue(
                consumableName
            );


        //------------------------------------------------
        // Current stock
        //------------------------------------------------

        const currentStock =
            item["CurrentStock"];

        const unit =
            item.Master["Unit"];


        if(
            currentStock === "" ||
            currentStock === null ||
            currentStock === undefined
        ){

            sheet
                .getRange(row,2)
                .setValue(
                    "Not counted"
                );

        }else{

            sheet
                .getRange(row,2)
                .setValue(
                    currentStock +
                    " " +
                    unit
                );

        }


        //------------------------------------------------
        // Remark
        //------------------------------------------------

        sheet
            .getRange(row,3)
            .setValue(
                buildConsumableRemark(
                    item
                )
            );

    });

}