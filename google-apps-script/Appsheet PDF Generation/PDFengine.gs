function getMedicationChartFilename(metadata){

  const chartMonth =
      metadata.year +
      ("0" + metadata.month).slice(-2);

  const generatedAt =
      Utilities.formatDate(
          new Date(),
          Session.getScriptTimeZone(),
          "yyyyMMdd_HHmmss"
      );

  return (
      "MedChart_" +
      safeFileName(
          metadata.resident.Residents
      ) +
      "_" +
      chartMonth +
      "_" +
      generatedAt +
      ".pdf"
  );

}

function getReportSourceSpreadsheet(report){

    // Preferred path: generated report sheets belong to the exact
    // spreadsheet that must be copied. This avoids Web App failures where
    // SpreadsheetApp.getActiveSpreadsheet() becomes undefined/null after
    // a long-running generation job.
    if (
        report &&
        report.sheets &&
        report.sheets.length > 0
    ){
        const firstSheet = report.sheets[0];

        if (
            firstSheet &&
            typeof firstSheet.getParent === "function"
        ){
            const sourceSpreadsheet =
                firstSheet.getParent();

            if (sourceSpreadsheet){
                return sourceSpreadsheet;
            }
        }
    }

    // Existing non-chart report generators return a single Sheet object.
    if (
        report &&
        typeof report.getParent === "function"
    ){
        const sourceSpreadsheet =
            report.getParent();

        if (sourceSpreadsheet){
            return sourceSpreadsheet;
        }
    }

    // Final compatibility fallback for any legacy report object.
    const activeSpreadsheet =
        SpreadsheetApp.getActiveSpreadsheet();

    if (activeSpreadsheet){
        return activeSpreadsheet;
    }

    throw new Error(
        "Unable to resolve the source spreadsheet for the temporary workbook."
    );

}

function createTemporaryWorkbook(report){

    SpreadsheetApp.flush();

    Utilities.sleep(2000);

    const sourceSpreadsheet =
        getReportSourceSpreadsheet(report);

    const sourceFile =
        DriveApp.getFileById(
            sourceSpreadsheet.getId()
        );

    const tempFile =
        sourceFile.makeCopy(

            "TEMP_" +

            (report.executionId || Utilities.getUuid()) +

            "_" +

            safeFileName(
                report.resident.Residents
            )

        );

    return tempFile;

}

function removeNonReportSheets(tempFile, report){

  const ss =
      SpreadsheetApp.openById(
          tempFile.getId()
      );

  const keepNames =
      report.sheets.map(function(sheet){

          return sheet.getName();

      });

  ss.getSheets().forEach(function(sheet){

      if(
          keepNames.indexOf(
              sheet.getName()
          ) == -1
      ){

          ss.deleteSheet(sheet);

      }

  });

}

function exportWorkbookToPdf(
    tempFile,
    filename,
    portrait
){

    const url =
        "https://docs.google.com/spreadsheets/d/" +
        tempFile.getId() +
        "/export" +

        "?format=pdf" +

        "&size=A4" +

        "&portrait=" +
        portrait +

        // Fit entire sheet to one page
        "&scale=4" +

        // Center the printed sheet horizontally
        "&horizontal_alignment=CENTER" +

        "&gridlines=false" +
        "&printtitle=false" +
        "&sheetnames=false" +
        "&pagenumbers=false" +
        "&fzr=false";

    const token =
        ScriptApp.getOAuthToken();

    const response =
        UrlFetchApp.fetch(
            url,
            {
                headers:{
                    Authorization:
                        "Bearer " + token
                }
            }
        );

    const blob =
        response
            .getBlob()
            .setName(filename);

    return blob;

}

function deleteTemporaryWorkbook(tempFile){

  tempFile.setTrashed(true);

}

function deleteGeneratedSheets(report){

    if (!report || !report.sheets || report.sheets.length === 0){
        return;
    }

    // Do not depend on getActiveSpreadsheet() here. After the long-running
    // branch generation, the Web App execution may no longer have an
    // active spreadsheet context. Every generated sheet knows its parent.
    const ss =
        getReportSourceSpreadsheet(report);

    report.sheets.forEach(function(sheet){
        ss.deleteSheet(sheet);
    });

}

function generateMedicationChartPdf(
    residentID,
    year,
    month,
    executionId
){

    const totalStart =
        new Date().getTime();


    //------------------------------------------------
    // Generate resident charts
    //------------------------------------------------

    setGenerationProgress(

        executionId,

        15,

        "Generating medication charts..."

    );


    const report =
        generateResidentMedicationCharts(

            residentID,

            year,

            month,

            executionId

        );


    //------------------------------------------------
    // 50%
    //------------------------------------------------

    setGenerationProgress(

        executionId,

        50,

        "Creating temporary workbook..."

    );


    //------------------------------------------------
    // IMPORTANT:
    //
    // createTemporaryWorkbook returns FILE directly.
    //------------------------------------------------

    const temp =
        createTemporaryWorkbook(
            report
        );


    //------------------------------------------------
    // 70%
    //------------------------------------------------

    setGenerationProgress(

        executionId,

        70,

        "Preparing report pages..."

    );


    removeNonReportSheets(

        temp,

        report

    );


    //------------------------------------------------
    // 78%
    //------------------------------------------------

    setGenerationProgress(

        executionId,

        78,

        "Finalising chart layout..."

    );


    SpreadsheetApp.flush();

    Utilities.sleep(
        2000
    );


    //------------------------------------------------
    // 82%
    //------------------------------------------------

    setGenerationProgress(

        executionId,

        82,

        "Generating PDF..."

    );


    const filename =
        getMedicationChartFilename({

            resident:
                report.resident,

            year:
                report.year,

            month:
                report.month

        });


    const pdf =
        exportWorkbookToPdf(

            temp,

            filename,

            false

        );


    //------------------------------------------------
    // 95%
    //------------------------------------------------

    setGenerationProgress(

        executionId,

        95,

        "Cleaning up..."

    );


    deleteTemporaryWorkbook(
        temp
    );


    deleteGeneratedSheets(
        report
    );


    //------------------------------------------------
    // Return
    //------------------------------------------------

    logElapsed(
        "TOTAL",
        totalStart
    );


    return {

        filename:
            filename,

        pdf:
            pdf

    };

}

function cleanupTemporaryPdfs(){

    const folder =
        DriveApp.getFolderById(
            getConfigValue("TemporaryPdfFolderID")
        );

    const files = folder.getFiles();

    const cutoff =
        Date.now() - 24 * 60 * 60 * 1000;

    Logger.log("Current : " + new Date());
    Logger.log("Cutoff  : " + new Date(cutoff));

    while(files.hasNext()){

        const file = files.next();

        Logger.log("----------------");

        Logger.log(file.getName());

        Logger.log("Modified : " + file.getLastUpdated());

        Logger.log(
            "Age(ms): " +
            (cutoff - file.getLastUpdated().getTime())
        );

        if(file.getLastUpdated().getTime() < cutoff){

            Logger.log("DELETE");

            file.setTrashed(true);

        }else{

            Logger.log("KEEP");

        }

    }

}

function saveTemporaryPdf(result){

    const folder =
        DriveApp.getFolderById(
            getConfigValue("TemporaryPdfFolderID")
        );

    const file =
        folder.createFile(result.pdf);

    file.setName(result.filename);

    file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW
    );

    return file;

}

function getPurchaseReportFilename(){

  const generatedAt =
      Utilities.formatDate(
          new Date(),
          Session.getScriptTimeZone(),
          "yyyyMMdd_HHmmss"
      );

  return (
      "Medication Purchase List_" +
      generatedAt +
      ".pdf"
  );

}

function keepOnlySheets(tempFile, sheetNames){

    const ss =
        SpreadsheetApp.openById(
            tempFile.getId()
        );

    ss.getSheets().forEach(function(sheet){

        if(
            sheetNames.indexOf(
                sheet.getName()
            ) == -1
        ){

            ss.deleteSheet(sheet);

        }

    });

}

function generatePurchaseReportPdf(
    branch,
    executionId
){

    //------------------------------------------------
    // Load data
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        15,
        "Loading medication purchase data..."
    );


    const report =
        generatePurchaseReport(
            branch,
            executionId
        );


    //------------------------------------------------
    // Report complete
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        57,
        "Purchase list prepared. Creating PDF workbook..."
    );


    //------------------------------------------------
    // Create temporary workbook
    //------------------------------------------------

    const temp =
        createTemporaryWorkbook({

            resident:{
                Residents:
                    "Purchase Report"
            }

        });


    updateDetailedReportProgress(
        executionId,
        65,
        "Preparing purchase report workbook..."
    );


    //------------------------------------------------
    // Keep only report sheet
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
        "Finalising purchase report..."
    );


    //------------------------------------------------
    // Filename
    //------------------------------------------------

    const filename =
        getPurchaseReportFilename();


    //------------------------------------------------
    // Export PDF
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        82,
        "Exporting purchase list to PDF..."
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
        "Purchase PDF generated. Cleaning up..."
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
        "Purchase report completed."
    );


    //------------------------------------------------
    // Return
    //------------------------------------------------

    return{

        filename:
            filename,

        pdf:
            pdf

    };

}


/**
 * OSEM - REPLACEMENT FUNCTION FOR PDFengine.gs
 *
 * Branch-chart performance version.
 *
 * Replace the existing generateBranchMedicationChartPdf(...)
 * function with this function.
 *
 * Requires:
 *   BranchChartPerformanceOptimized.gs
 *
 * No changes are made to the resident chart layout or PRN layout.
 */

function generateBranchMedicationChartPdf(
  branch,
  year,
  month,
  executionId
) {

  var totalStart =
    new Date().getTime();

  var report = null;

  try {

    /*
     * -------------------------------------------------------------
     * 1. GENERATE BRANCH CHARTS
     *
     * The optimized generator now creates the blank PDF workbook
     * itself at the beginning and copies each completed resident
     * chart directly into it.
     *
     * This eliminates the old second "copy entire master workbook"
     * stage completely.
     * -------------------------------------------------------------
     */

    setGenerationProgress(
      executionId,
      15,
      "Generating branch medication charts..."
    );

    report =
      generateBranchMedicationChartsOptimized(
        branch,
        year,
        month,
        executionId
      );

    if (
      !report ||
      !report.file ||
      !report.spreadsheet ||
      report.spreadsheet.getSheets().length === 0
    ) {

      throw new Error(
        "Branch medication chart generation returned no PDF workbook."
      );

    }

    /*
     * -------------------------------------------------------------
     * 2. PDF WORKBOOK ALREADY READY
     * -------------------------------------------------------------
     */

    setGenerationProgress(
      executionId,
      55,
      "Branch chart pages prepared. Finalising PDF workbook...",
      {
        residentNumber:
          report.totalResidents || "",
        totalResidents:
          report.totalResidents || ""
      }
    );

    /*
     * -------------------------------------------------------------
     * 3. FINAL SAFETY FLUSH + WAIT
     *
     * KEEP THE 2-SECOND WAIT.
     *
     * This is the intentional propagation buffer requested by OSEM.
     * There is now only ONE such wait in the branch pipeline.
     * -------------------------------------------------------------
     */

    setGenerationProgress(
      executionId,
      78,
      "Finalising branch chart layout..."
    );

    SpreadsheetApp.flush();

    Utilities.sleep(2000);

    /*
     * -------------------------------------------------------------
     * 4. EXPORT PDF
     * -------------------------------------------------------------
     */

    setGenerationProgress(
      executionId,
      82,
      "Generating branch medication PDF..."
    );

    var filename =
      getBranchMedicationChartFilename(
        branch,
        year,
        month
      );

    var pdf =
      exportWorkbookToPdf(
        report.file,
        filename,
        false
      );

    /*
     * -------------------------------------------------------------
     * 5. CLEANUP
     * -------------------------------------------------------------
     */

    setGenerationProgress(
      executionId,
      95,
      "Branch PDF generated. Cleaning up..."
    );

    deleteTemporaryWorkbook(
      report.file
    );

    report = null;

    logElapsed(
      "OPTIMIZED BRANCH MEDICATION CHART TOTAL",
      totalStart
    );

    setGenerationProgress(
      executionId,
      98,
      "Preparing PDF for viewing..."
    );

    return {

      filename: filename,

      pdf: pdf

    };

  } catch (err) {

    Logger.log(
      "Optimized branch medication PDF failed: " +
      err
    );

    /*
     * Temporary workbook cleanup.
     */
    try {

      if (
        report &&
        report.file
      ) {

        deleteTemporaryWorkbook(
          report.file
        );

      }

    } catch (cleanupTempError) {

      Logger.log(
        "Temporary workbook cleanup failed: " +
        cleanupTempError
      );

    }

    /*
     * IMPORTANT:
     *
     * The optimized branch generator normally deletes source chart
     * sheets immediately after successfully copying them.
     * Therefore there should be no large source-sheet cleanup here.
     */

    throw err;

  }

}

function createEmptyTemporaryWorkbook(executionId){

    SpreadsheetApp.flush();

    Utilities.sleep(2000);

    const sourceFile =
        DriveApp.getFileById(
            SpreadsheetApp
                .getActiveSpreadsheet()
                .getId()
        );

    const tempFile =
        sourceFile.makeCopy(
            "TEMP_BRANCH_" +
            executionId
        );

    const tempSS =
        SpreadsheetApp.openById(
            tempFile.getId()
        );

    const sheets =
        tempSS.getSheets();

    // Keep the first sheet only
    for(
        let i = sheets.length - 1;
        i >= 1;
        i--
    ){

        tempSS.deleteSheet(
            sheets[i]
        );

    }

    return{

        file: tempFile,

        spreadsheet: tempSS,

        templateSheet:
            tempSS.getSheets()[0]

    };

}

function getBranchMedicationChartFilename(
    branch,
    year,
    month
){

    const chartMonth =
        year +
        ("0" + month).slice(-2);

    const generatedAt =
        Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "yyyyMMdd_HHmmss"
        );

    return (

        "MedicationPreparationChart_"

        + branch

        + "_"

        + chartMonth

        + "_"

        + generatedAt

        + ".pdf"

    );

}

function generateResidentCompleteMedicationReminderPdf(
    residentID,
    executionId
){

    //------------------------------------------------
    // Generate report
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        15,
        "Preparing resident medication stock summary..."
    );


    const report =
        generateResidentCompleteMedicationReminderReport(
            residentID,
            executionId
        );


    updateDetailedReportProgress(
        executionId,
        57,
        "Medication summary prepared. Creating PDF workbook..."
    );


    //------------------------------------------------
    // Temporary workbook
    //------------------------------------------------

    const temp =
        createEmptyTemporaryWorkbook(
            generateExecutionId()
        );


    updateDetailedReportProgress(
        executionId,
        65,
        "Preparing medication summary workbook..."
    );


    //------------------------------------------------
    // Temporary spreadsheet
    //------------------------------------------------

    const tempSS =
        temp.spreadsheet;


    //------------------------------------------------
    // Copy report
    //------------------------------------------------

    const copiedReport =
        report.copyTo(
            tempSS
        );


    updateDetailedReportProgress(
        executionId,
        68,
        "Copying medication summary into PDF workbook..."
    );


    //------------------------------------------------
    // Remove other sheets
    //------------------------------------------------

    tempSS
        .getSheets()
        .forEach(function(sheet){

            if(
                sheet.getSheetId() !==
                copiedReport.getSheetId()
            ){

                tempSS.deleteSheet(
                    sheet
                );

            }

        });


    //------------------------------------------------
    // Rename
    //------------------------------------------------

    copiedReport.setName(
        "Medication Reminder"
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
        "Finalising medication summary..."
    );


    //------------------------------------------------
    // Resident
    //------------------------------------------------

    const resident =
        getResident(
            residentID
        );


    //------------------------------------------------
    // Filename
    //------------------------------------------------

    const filename =
        "CompleteMedicationReminder_" +
        resident.Residents
            .replace(
                /[^a-zA-Z0-9]+/g,
                "_"
            ) +
        "_" +
        Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "yyyyMMdd_HHmmss"
        ) +
        ".pdf";


    //------------------------------------------------
    // Export
    //------------------------------------------------

    updateDetailedReportProgress(
        executionId,
        82,
        "Exporting medication summary to PDF..."
    );


    const pdf =
        exportWorkbookToPdf(
            temp.file,
            filename,
            true
        );


    updateDetailedReportProgress(
        executionId,
        94,
        "PDF generated. Cleaning up..."
    );


    //------------------------------------------------
    // Cleanup temporary workbook
    //------------------------------------------------

    deleteTemporaryWorkbook(
        temp.file
    );


    //------------------------------------------------
    // Delete report
    //------------------------------------------------

    SpreadsheetApp
        .getActiveSpreadsheet()
        .deleteSheet(
            report
        );


    updateDetailedReportProgress(
        executionId,
        95,
        "Medication stock summary completed."
    );


    return{

        pdf:
            pdf,

        filename:
            filename

    };

}

function generateReportForWeb(
    action,
    residentID,
    branch,
    year,
    month,
    executionId
){

    try{

        let result;


        //------------------------------------------------
        // Start
        //------------------------------------------------

        setGenerationProgress(
            executionId,
            8,
            "Preparing " +
            getReportTitle(action) +
            "..."
        );


        //------------------------------------------------
        // Generate report
        //------------------------------------------------

        switch(action){

            case "purchase":

                result =
                    generatePurchaseReportPdf(
                        branch,
                        executionId
                    );

                break;


            case "family":

                result =
                    generateFamilyReminderPdf(
                        branch,
                        executionId
                    );

                break;


            case "familyrequest":

                result =
                    generateResidentFamilyReminderPdf(
                        residentID,
                        executionId
                    );

                break;


            case "chart":

                result =
                    generateMedicationChartPdf(
                        residentID,
                        Number(year),
                        Number(month),
                        executionId
                    );

                break;


            case "branchchart":

                result =
                    generateBranchMedicationChartPdf(
                        branch,
                        Number(year),
                        Number(month),
                        executionId
                    );

                break;


            case "familyconsumable":

                result =
                    generateResidentFamilyConsumableReminderPdf(
                        residentID,
                        executionId
                    );

                break;


            case "medsummary":

                result =
                    generateResidentCompleteMedicationReminderPdf(
                        residentID,
                        executionId
                    );

                break;


            default:

                throw new Error(
                    "Unsupported report action: " +
                    action
                );

        }


        //------------------------------------------------
        // Save PDF
        //------------------------------------------------

        setGenerationProgress(
            executionId,
            99,
            "Saving PDF..."
        );


        const file =
            saveTemporaryPdf(
                result
            );


        //------------------------------------------------
        // Preview URL
        //------------------------------------------------

        const previewUrl =
            "https://drive.google.com/file/d/" +
            file.getId() +
            "/preview";


        //------------------------------------------------
        // Completed
        //------------------------------------------------

        setGenerationProgress(
            executionId,
            100,
            "PDF ready!",
            {

                status:
                    "completed",

                pdfUrl:
                    previewUrl

            }
        );


        return {

            success:
                true,

            pdfUrl:
                previewUrl,

            executionId:
                executionId

        };

    }
    catch(err){

        //------------------------------------------------
        // Error
        //------------------------------------------------

        setGenerationProgress(
            executionId,
            0,
            err.toString(),
            {

                status:
                    "error"

            }
        );


        Logger.log(
            "REPORT GENERATION ERROR"
        );


        Logger.log(
            err.stack ||
            err.toString()
        );


        throw err;

    }

}
