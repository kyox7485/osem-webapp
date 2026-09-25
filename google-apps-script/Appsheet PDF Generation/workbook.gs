function copySheetsToWorkbook(sourceSheets, targetSpreadsheet){

    let copiedSheets = [];

    sourceSheets.forEach(function(sheet){

        const copied =
            sheet.copyTo(
                targetSpreadsheet
            );

        copied.setName(
            sheet.getName()
        );

        copiedSheets.push(copied);

    });

    return copiedSheets;

}

function deleteSheets(sheets){

    const ss =
        SpreadsheetApp
            .getActiveSpreadsheet();

    sheets.forEach(function(sheet){

        ss.deleteSheet(sheet);

    });

}