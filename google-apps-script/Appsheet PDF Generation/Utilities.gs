function getConfigValue(key) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.CONFIG_SHEET);

  const values = sheet.getDataRange().getValues();

  for (let i = 0; i < values.length; i++) {

    if (values[i][0] == key) {

      return values[i][1];

    }

  }

  return null;

}

function getTemplateCell(name){

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.TEMPLATE_MAP_SHEET);

  const values = sheet.getDataRange().getValues();

  for(let i=0;i<values.length;i++){

    if(values[i][0]==name){

      return values[i][1];

    }

  }

  return null;

}

function columnToNumber(column) {

  let number = 0;

  for (let i = 0; i < column.length; i++) {

    number = number * 26 + (column.charCodeAt(i) - 64);

  }

  return number;

}

function getDayColumn(day){

  const firstColumn =
      columnToNumber(
          getTemplateCell("FIRST_DAY_COLUMN")
      );

  return firstColumn + day - 1;

}

//function deleteSheetIfExists(sheetName){

//  const ss = SpreadsheetApp.getActiveSpreadsheet();

//  const sheet = ss.getSheetByName(sheetName);

//  if(sheet){

//    ss.deleteSheet(sheet);

//  }

//}

//function deleteResidentReportSheets(residentName){

//    const ss = SpreadsheetApp.getActiveSpreadsheet();

//    ss.getSheets().forEach(function(sheet){

//        const name = sheet.getName();

//        if(
//            name.startsWith(
//                residentName + " - "
//            )
//        ){

//            ss.deleteSheet(sheet);

//        }

//    });

//}

function safeFileName(text){

  return text
    .trim()
    .replace(/@/g, "")
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");

}

function getBranches(){

    loadBranchCache();

    return BRANCH_CACHE;

}

function generateReportSheetName(prefix){

    const timestamp =
        Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "yyyyMMdd_HHmmss_SSS"
        );

    const random =
        Utilities.getUuid()
            .substring(0,8);

    return (
        prefix +
        "_" +
        timestamp +
        "_" +
        random
    );

}

function generateExecutionId(){

    return Utilities
        .getUuid()
        .substring(0,8);

}

function getResidentFamilyConsumableReminderFilename(
    resident
){

    const generatedAt =
        Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "yyyyMMdd_HHmmss"
        );

    return (
        "FamilyConsumableReminder_" +

        safeFileName(
            resident.Residents
        ) +

        "_" +

        generatedAt +

        ".pdf"
    );

}

function getResidentCompleteMedicationList(residentID){

    //------------------------------------------------
    // Get all active medication orders
    //------------------------------------------------

    const medications =
        getResidentMedication(
            residentID
        );

    //------------------------------------------------
    // Get latest medication stock records
    //------------------------------------------------

    const latestStockRecords =
        getLatestMedicationStock();

    //------------------------------------------------
    // Build RxOrderID -> Stock lookup
    //------------------------------------------------

    const stockByRxOrderID = {};

    Object.values(
        latestStockRecords
    ).forEach(function(stock){

        const rxOrderID =
            stock["RxOrderID"];

        if(!rxOrderID){

            return;

        }

        stockByRxOrderID[
            rxOrderID
        ] = stock;

    });

    //------------------------------------------------
    // Get Stock Unit tracking methods
    //------------------------------------------------

    const trackingMethods =
        getStockUnitTrackingMethods();

    //------------------------------------------------
    // Build complete medication list
    //------------------------------------------------

    return medications.map(function(med){

        const rxOrderID =
            med["RxOrderID"];

        //------------------------------------------------
        // Find latest stock
        //------------------------------------------------

        const stock =
            stockByRxOrderID[
                rxOrderID
            ] || null;

        //------------------------------------------------
        // Determine unit
        //------------------------------------------------

        const unit =
            stock
                ? stock["Unit"]
                : (med["Unit"] || "");

        //------------------------------------------------
        // Determine tracking method
        //------------------------------------------------

        const trackingMethod =
            trackingMethods[unit] || "";

        //------------------------------------------------
        // Calculate days remaining
        //------------------------------------------------

        let daysRemaining = "";

        if(stock){

            if(
                trackingMethod == "Estimate"
            ){

                daysRemaining =
                    "Uncountable";

            }else{

                const rawDays =
                    Number(
                        stock["Days Remaining"]
                    );

                if(
                    stock["Days Remaining"] !== "" &&
                    !isNaN(rawDays)
                ){

                    // Already rounded down to the nearest 0.5 (Stock.gs).
                    daysRemaining =
                        rawDays;

                }

            }

        }

        //------------------------------------------------
        // Return complete medication object
        //------------------------------------------------

        return {

            medication:
                med,

            stock:
                stock,

            description:
                buildMedicineDescription(
                    med
                ),

            balance:
                stock
                    ? stock["Balance"]
                    : "",

            unit:
                unit,

            daysRemaining:
                daysRemaining

        };

    });

}

function getStockUnitTrackingMethods(){

    const medicationID =
        getConfigValue(
            "MedicationModuleID"
        );

    const ss =
        SpreadsheetApp.openById(
            medicationID
        );

    const sheet =
        ss.getSheetByName(
            CONFIG.STOCK_UNIT_SHEET
        );

    if(!sheet){

        throw new Error(
            "Stock Unit sheet not found."
        );

    }

    const data =
        sheet
            .getDataRange()
            .getValues();

    const header =
        data.shift();

    const result = {};

    data.forEach(function(row){

        const item = {};

        header.forEach(function(name,index){

            item[name] =
                row[index];

        });

        result[
            item["Unit"]
        ] = item["Tracking Method"];

    });

    return result;

}

function getResidentFamilyConsumableReminderList(residentID){

    return getResidentFamilyConsumables(
        residentID
    );

}

function buildConsumableRemark(item){

    const master =
        item.Master;

    const current =
        Number(item["CurrentStock"]);

    const unit =
        master["Unit"];

    //------------------------------------------------
    // Restock-controlled
    //------------------------------------------------

    if(
        master["RestockRequired"] == "Yes"
    ){

        const maxStock =
            Number(master["MaxStock"]);

        const suggested =
            Math.max(
                0,
                maxStock - current
            );

        if(suggested > 0){

            return (
                "To restock " +
                suggested +
                " " +
                unit
            );

        }

        return "Stock sufficient";

    }

    //------------------------------------------------
    // Non-restock-controlled
    //------------------------------------------------

    return (
        current +
        " " +
        unit +
        " in stock"
    );

}

function getReportTitle(action){

    const titles = {

        purchase:
            "Medication Purchase List",

        family:
            "Family Medication Reminder",

        familyrequest:
            "Family Medication Reminder",

        chart:
            "Medication Preparation Chart",

        branchchart:
            "Branch Medication Preparation Chart",

        familyconsumable:
            "Family Consumable Reminder",

        medsummary:
            "Resident Medication Stock Summary List"

    };


    return (
        titles[action] ||
        "Report"
    );

}