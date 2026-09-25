function autoDiscontinueExpiredMedicationOrders(){

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
            CONFIG.MEDICATION_ORDER_SHEET
        );

    const data =
        sheet.getDataRange().getValues();

    const header =
        data.shift();

    const statusCol =
        header.indexOf("Status");

    const endDateCol =
        header.indexOf("End Date");

    const residentCol =
        header.indexOf("ResidentID");

    const ingredientCol =
        header.indexOf("Active Ingredient");

    const today = new Date();

    today.setHours(0,0,0,0);

    let updated = 0;

    data.forEach(function(row,index){

        const status =
            row[statusCol];

        const endDate =
            row[endDateCol];

        if(
            status != "Active"
        ){

            return;

        }

        if(
            endDate == "" ||
            endDate == null
        ){

            return;

        }

        const end =
            new Date(endDate);

        end.setHours(0,0,0,0);

        if(end < today){

            sheet
                .getRange(
                    index + 2,
                    statusCol + 1
                )
                .setValue(
                    "Discontinued"
                );

            updated++;

            Logger.log(

                row[residentCol] +

                " - " +

                row[ingredientCol] +

                " discontinued."

            );

        }

    });

    Logger.log(

        "Expired Orders Updated = " +

        updated

    );

}

function testAutoDiscontinue(){

    autoDiscontinueExpiredMedicationOrders();

}