function buildPurchaseDescription(medication) {

  const dosageForm = medication["Dosage Form"] || "";
  const brandName = medication["Brand Name"] || "";
  const activeIngredient = medication["Active Ingredient"] || "";
  const dose = medication["Dose"] || "";
  const unit = medication["Unit"] || "";
  const frequency = medication["Frequency"] || "";

  let medicineName = "";

  if (brandName != "") {

    medicineName =
      dosageForm +
      " " +
      brandName +
      " (" +
      activeIngredient +
      ")";

  } else {

    medicineName =
      dosageForm +
      " " +
      activeIngredient;

  }

  return (
      medicineName +
      "\n" +
      dose +
      " " +
      unit +
      " " +
      frequency
  );

}

function getPurchaseList(branch){

  const latestStock =
      getLatestMedicationStock();

  const medicationOrders =
      getMedicationOrders();

  const residents =
      getResidents();

  let purchaseList = [];

  latestStock.forEach(function(stock){

      const medication =
          medicationOrders[
              stock.RxOrderID
          ];

      // Medication not found
      if(!medication)
          return;

      // Only active medicines
      if(medication["Status"] != "Active")
          return;

      // Only OSEM supplied
      if(medication["Supplied By"] != "OSEM")
          return;

      // Resident not found
      const resident =
          residents[
              medication["ResidentID"]
          ];

      if(!resident)
          return;

      // Branch filter
      if(resident["Branch"] != branch)
          return;

      // Determine tracking method
      const trackingMethod =
          getTrackingMethod(
              stock.Unit
          );

      let requirePurchase = false;

      if(
          trackingMethod == "Count" &&
          stock["Days Remaining"] !== "" &&
          Number(stock["Days Remaining"]) <= 14
      ){

          requirePurchase = true;

      }

      if(
          trackingMethod == "Estimate" &&
          Number(stock.Balance) <= 1
      ){

          requirePurchase = true;

      }

      if(!requirePurchase)
          return;

      purchaseList.push({

          resident: resident,

          medication: medication,

          stock: stock

      });

  });

  purchaseList.sort(function(a, b){

      const residentCompare =
          a.resident.Residents.localeCompare(
              b.resident.Residents
          );

      if(residentCompare !== 0)
          return residentCompare;

      return buildPurchaseDescription(a.medication)
          .localeCompare(
              buildPurchaseDescription(b.medication)
          );

  });

  return purchaseList;

}

function testPurchaseList(){

    const list =
        getPurchaseList("ALMA");

    Logger.log(
        "Total Purchase Items : " +
        list.length
    );

    list.forEach(function(item){

        Logger.log(

            item.resident.Residents +

            " | " +

            item.medication["Active Ingredient"] +

            " | " +

            item.stock["Days Remaining"]

        );

    });

}

function writePurchaseRows(
    sheet,
    purchaseList,
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
        purchaseList.length;


    purchaseList.forEach(function(
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
            "Preparing purchase item " +
            (index + 1) +
            " of " +
            totalItems +
            "..."
        );


        //------------------------------------------------
        // Resident
        //------------------------------------------------

        const residentName =
            item.resident["Residents"];


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
        // Medicine
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

function generatePurchaseReport(
    branch,
    executionId
){

  const purchaseList =
      getPurchaseList(branch);

  if(purchaseList.length == 0){

      throw new Error(
          "No medication requires purchase."
      );

  }

  const branches =
      getBranches();

  const ss =
      SpreadsheetApp.getActiveSpreadsheet();

  const template =
      ss.getSheetByName(
          getConfigValue("PurchaseTemplate")
      );

  const report =
      template.copyTo(ss);

  report.setName(

      generateReportSheetName(
          "Purchase"
      )

  );

  report.getRange("D2")
      .setValue(new Date());

  const branchInfo =
      branches[
          purchaseList[0].resident.Branch
      ];

  if(branchInfo){

      report.getRange("D3")
          .setValue(
              branchInfo.BranchLocale
          );

  }

  writePurchaseRows(
      report,
      purchaseList,
      executionId
  );

  return report;

}

function testPurchaseReport(){

    generatePurchaseReport();

}

function exportPurchaseReportPdf(){

  // Generate latest report
  const report =
      generatePurchaseReport();

  // Export using existing PDF engine
  return exportSingleSheetPdf(report);

}