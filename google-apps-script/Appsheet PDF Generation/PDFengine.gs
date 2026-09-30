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
      safeFileName(metadata.resident.Residents) +
      "_" +
      chartMonth +
      "_" +
      generatedAt +
      ".pdf"
  );
}


function getReportSourceSpreadsheet(report){

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

            if(sourceSpreadsheet){
                return sourceSpreadsheet;
            }
        }
    }

    if (
        report &&
        typeof report.getParent === "function"
    ){
        const sourceSpreadsheet =
            report.getParent();

        if(sourceSpreadsheet){
            return sourceSpreadsheet;
        }
    }

    const activeSpreadsheet =
        SpreadsheetApp.getActiveSpreadsheet();

    if(activeSpreadsheet){
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
        "&scale=4" +
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

    return response
        .getBlob()
        .setName(filename);
}


function deleteTemporaryWorkbook(tempFile){

    if(tempFile){
        tempFile.setTrashed(true);
    }
}


function deleteGeneratedSheets(report){

    if(
        !report ||
        !report.sheets ||
        report.sheets.length === 0
    ){
        return;
    }

    const ss =
        getReportSourceSpreadsheet(report);

    report.sheets.forEach(function(sheet){

        try{
            ss.deleteSheet(sheet);
        }catch(err){
            Logger.log(
                "Unable to delete generated sheet: " +
                err
            );
        }

    });
}


// ============================================================
// SINGLE RESIDENT MEDICATION CHART
// ============================================================

function generateMedicationChartPdf(
    residentID,
    year,
    month,
    executionId
){

    const totalStart =
        new Date().getTime();

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

    setGenerationProgress(
        executionId,
        50,
        "Creating temporary workbook..."
    );

    const temp =
        createTemporaryWorkbook(report);

    setGenerationProgress(
        executionId,
        70,
        "Preparing report pages..."
    );

    removeNonReportSheets(
        temp,
        report
    );

    setGenerationProgress(
        executionId,
        78,
        "Finalising chart layout..."
    );

    SpreadsheetApp.flush();

    Utilities.sleep(2000);

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

    setGenerationProgress(
        executionId,
        95,
        "Cleaning up..."
    );

    deleteTemporaryWorkbook(temp);

    deleteGeneratedSheets(report);

    logElapsed(
        "TOTAL",
        totalStart
    );

    return {
        filename: filename,
        pdf: pdf
    };
}


// ============================================================
// TEMPORARY PDF CLEANUP / DRIVE
// ============================================================

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

        if(
            file.getLastUpdated().getTime() < cutoff
        ){
            file.setTrashed(true);
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


// ============================================================
// PURCHASE REPORT
// ============================================================

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

    updateDetailedReportProgress(
        executionId,
        57,
        "Purchase list prepared. Creating PDF workbook..."
    );

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

    SpreadsheetApp.flush();

    Utilities.sleep(2000);

    updateDetailedReportProgress(
        executionId,
        78,
        "Finalising purchase report..."
    );

    const filename =
        getPurchaseReportFilename();

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

    deleteTemporaryWorkbook(temp);

    SpreadsheetApp
        .getActiveSpreadsheet()
        .deleteSheet(report);

    updateDetailedReportProgress(
        executionId,
        95,
        "Purchase report completed."
    );

    return{
        filename: filename,
        pdf: pdf
    };
}


// ============================================================
// EXISTING SYNCHRONOUS BRANCH PDF FUNCTION
// ============================================================
// Kept intact for direct/manual use. The Web App branchchart path
// below does NOT call it; it uses the resumable browser-batch worker.

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

    setGenerationProgress(
      executionId,
      78,
      "Finalising branch chart layout..."
    );

    SpreadsheetApp.flush();

    Utilities.sleep(2000);

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

    try {
      if(
        report &&
        report.file
      ){
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

    throw err;
  }
}


function createEmptyTemporaryWorkbook(executionId){

    const active =
        SpreadsheetApp.getActiveSpreadsheet();

    if(!active){
        throw new Error(
            "Unable to resolve the bound source spreadsheet."
        );
    }

    const sourceFile =
        DriveApp.getFileById(
            active.getId()
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
        "MedicationPreparationChart_" +
        branch +
        "_" +
        chartMonth +
        "_" +
        generatedAt +
        ".pdf"
    );
}


// ============================================================
// RESIDENT COMPLETE MEDICATION REMINDER
// ============================================================

function generateResidentCompleteMedicationReminderPdf(
    residentID,
    executionId
){

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

    const temp =
        createEmptyTemporaryWorkbook(
            generateExecutionId()
        );

    updateDetailedReportProgress(
        executionId,
        65,
        "Preparing medication summary workbook..."
    );

    const tempSS =
        temp.spreadsheet;

    const copiedReport =
        report.copyTo(
            tempSS
        );

    updateDetailedReportProgress(
        executionId,
        68,
        "Copying medication summary into PDF workbook..."
    );

    tempSS
        .getSheets()
        .forEach(function(sheet){

            if(
                sheet.getSheetId() !==
                copiedReport.getSheetId()
            ){
                tempSS.deleteSheet(sheet);
            }

        });

    copiedReport.setName(
        "Medication Reminder"
    );

    updateDetailedReportProgress(
        executionId,
        72,
        "Preparing report layout..."
    );

    SpreadsheetApp.flush();

    Utilities.sleep(2000);

    updateDetailedReportProgress(
        executionId,
        78,
        "Finalising medication summary..."
    );

    const resident =
        getResident(residentID);

    const filename =
        "CompleteMedicationReminder_" +
        resident.Residents.replace(
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

    deleteTemporaryWorkbook(
        temp.file
    );

    SpreadsheetApp
        .getActiveSpreadsheet()
        .deleteSheet(report);

    updateDetailedReportProgress(
        executionId,
        95,
        "Medication stock summary completed."
    );

    return{
        pdf: pdf,
        filename: filename
    };
}


// ============================================================
// WEB BRANCH BATCH GENERATION
// ============================================================
//
// IMPORTANT
// ----------
// This replaces the single long-running 36-resident branch
// execution with multiple short google.script.run executions.
//
// No time-driven trigger is used.
// The existing Loading.html calls generateReportForWeb()
// repeatedly while async=true.
//
// This is intentional because it keeps the existing
// SpreadsheetApp.getActiveSpreadsheet() behavior that the current
// Web App already relies on.
//
// Each call processes at most 3 residents.
//

const BRANCH_WEB_BATCH_MAX_RESIDENTS = 3;

const BRANCH_WEB_BATCH_MAX_RUNTIME_MS =
    150 * 1000;

const BRANCH_WEB_BATCH_PREFIX =
    "OSEM_BRANCH_WEB_BATCH_";


function getBranchWebBatchStateKey(
    executionId
){
    return (
        BRANCH_WEB_BATCH_PREFIX +
        String(executionId || "")
    );
}


function loadBranchWebBatchState(
    executionId
){

    if(!executionId){
        return null;
    }

    const raw =
        PropertiesService
            .getScriptProperties()
            .getProperty(
                getBranchWebBatchStateKey(
                    executionId
                )
            );

    if(!raw){
        return null;
    }

    try{
        return JSON.parse(raw);
    }catch(err){
        Logger.log(
            "Invalid branch web batch state: " +
            executionId
        );
        return null;
    }
}


function saveBranchWebBatchState(
    state
){

    if(
        !state ||
        !state.executionId
    ){
        return;
    }

    PropertiesService
        .getScriptProperties()
        .setProperty(
            getBranchWebBatchStateKey(
                state.executionId
            ),
            JSON.stringify(state)
        );
}


function deleteBranchWebBatchState(
    executionId
){

    if(!executionId){
        return;
    }

    PropertiesService
        .getScriptProperties()
        .deleteProperty(
            getBranchWebBatchStateKey(
                executionId
            )
        );
}


function initializeBranchWebBatchState(
    branch,
    year,
    month,
    executionId
){

    branch =
        String(branch || "").trim();

    year =
        Number(year);

    month =
        Number(month);

    executionId =
        String(executionId || "").trim();

    if(!branch){
        throw new Error(
            "Branch is required."
        );
    }

    if(
        !Number.isFinite(year) ||
        year < 2000
    ){
        throw new Error(
            "Invalid chart year: " + year
        );
    }

    if(
        !Number.isFinite(month) ||
        month < 1 ||
        month > 12
    ){
        throw new Error(
            "Invalid chart month: " + month
        );
    }

    const sourceSpreadsheet =
        SpreadsheetApp.getActiveSpreadsheet();

    if(!sourceSpreadsheet){
        throw new Error(
            "Unable to resolve the source spreadsheet for branch chart generation."
        );
    }

    const residents =
        getResidentsByBranch(
            branch
        );

    const totalResidents =
        residents.length;

    if(totalResidents === 0){
        throw new Error(
            "No active residents found for branch: " +
            branch
        );
    }

    // Preserve the existing page calculation.
    const totalPages =
        calculateBranchTotalChartPages(
            residents
        );

    if(
        !totalPages ||
        totalPages <= 0
    ){
        throw new Error(
            "No medication chart pages found for branch: " +
            branch
        );
    }

    const residentIds =
        residents
            .map(function(resident){
                return String(
                    resident.ResidentID || ""
                ).trim();
            })
            .filter(function(id){
                return id !== "";
            });

    if(residentIds.length === 0){
        throw new Error(
            "No valid ResidentID values found for branch: " +
            branch
        );
    }

    // Use the existing fast blank workbook helper.
    const temp =
        createFastBranchTemporaryWorkbook(
            executionId
        );

    const state = {

        executionId:
            executionId,

        branch:
            branch,

        year:
            year,

        month:
            month,

        sourceSpreadsheetId:
            sourceSpreadsheet.getId(),

        tempFileId:
            temp.file.getId(),

        tempSpreadsheetId:
            temp.spreadsheet.getId(),

        residentIds:
            residentIds,

        residentIndex:
            0,

        totalResidents:
            residentIds.length,

        completedPages:
            0,

        totalPages:
            totalPages,

        status:
            "running",

        createdAt:
            new Date().getTime()

    };

    saveBranchWebBatchState(
        state
    );

    return state;
}


function deleteBranchWebBatchSourceSheets(
    sheets
){

    if(
        !sheets ||
        sheets.length === 0
    ){
        return;
    }

    const sourceSpreadsheet =
        SpreadsheetApp.getActiveSpreadsheet();

    if(!sourceSpreadsheet){
        throw new Error(
            "Unable to access source spreadsheet while cleaning branch chart sheets."
        );
    }

    for(
        let i = sheets.length - 1;
        i >= 0;
        i--
    ){

        const sheet =
            sheets[i];

        if(!sheet){
            continue;
        }

        try{
            sourceSpreadsheet.deleteSheet(
                sheet
            );
        }catch(err){
            Logger.log(
                "Unable to delete branch source sheet: " +
                err
            );
        }
    }
}


function finishBranchWebBatchJob(
    state,
    tempSpreadsheet
){

    const tempFile =
        DriveApp.getFileById(
            state.tempFileId
        );

    const sheets =
        tempSpreadsheet.getSheets();

    // Remove the initial blank sheet.
    if(
        sheets.length > 1
    ){

        try{
            tempSpreadsheet.deleteSheet(
                sheets[0]
            );
        }catch(err){
            Logger.log(
                "Unable to remove branch temp default sheet: " +
                err
            );
        }

    }

    const finalSheets =
        tempSpreadsheet.getSheets();

    if(
        !finalSheets ||
        finalSheets.length === 0
    ){
        throw new Error(
            "Branch medication chart generation produced no sheets."
        );
    }

    setGenerationProgress(
        state.executionId,
        78,
        "Finalising branch chart layout...",
        {
            residentNumber:
                state.totalResidents,
            totalResidents:
                state.totalResidents
        }
    );

    SpreadsheetApp.flush();

    // Keep a short propagation buffer immediately before export.
    Utilities.sleep(1500);

    setGenerationProgress(
        state.executionId,
        82,
        "Generating branch medication PDF...",
        {
            residentNumber:
                state.totalResidents,
            totalResidents:
                state.totalResidents
        }
    );

    const filename =
        getBranchMedicationChartFilename(
            state.branch,
            state.year,
            state.month
        );

    const pdf =
        exportWorkbookToPdf(
            tempFile,
            filename,
            false
        );

    setGenerationProgress(
        state.executionId,
        95,
        "Branch PDF generated. Saving PDF...",
        {
            residentNumber:
                state.totalResidents,
            totalResidents:
                state.totalResidents
        }
    );

    const file =
        saveTemporaryPdf({
            filename:
                filename,
            pdf:
                pdf
        });

    const previewUrl =
        "https://drive.google.com/file/d/" +
        file.getId() +
        "/preview";

    setGenerationProgress(
        state.executionId,
        100,
        "PDF ready!",
        {
            status:
                "completed",
            pdfUrl:
                previewUrl,
            residentNumber:
                state.totalResidents,
            totalResidents:
                state.totalResidents
        }
    );

    deleteTemporaryWorkbook(
        tempFile
    );

    deleteBranchWebBatchState(
        state.executionId
    );

    return {

        success:
            true,

        pdfUrl:
            previewUrl,

        executionId:
            state.executionId,

        residentName:
            "",

        residentNumber:
            state.totalResidents,

        totalResidents:
            state.totalResidents

    };
}


function processBranchMedicationChartWebBatch(
    branch,
    year,
    month,
    executionId
){

    const lock =
        LockService.getScriptLock();

    if(
        !lock.tryLock(5000)
    ){

        return {
            success:
                true,
            async:
                true,
            busy:
                true,
            executionId:
                executionId
        };
    }

    try{

        let state =
            loadBranchWebBatchState(
                executionId
            );

        if(!state){

            state =
                initializeBranchWebBatchState(
                    branch,
                    year,
                    month,
                    executionId
                );

        }

        if(
            state.status !== "running"
        ){

            if(
                state.status === "completed" &&
                state.pdfUrl
            ){

                return {
                    success:
                        true,
                    pdfUrl:
                        state.pdfUrl,
                    executionId:
                        executionId
                };

            }

            throw new Error(
                "Branch chart job is not in a runnable state."
            );
        }

        const sourceSpreadsheet =
            SpreadsheetApp.getActiveSpreadsheet();

        if(!sourceSpreadsheet){
            throw new Error(
                "Unable to resolve the active source spreadsheet."
            );
        }

        if(
            String(
                sourceSpreadsheet.getId()
            ) !==
            String(
                state.sourceSpreadsheetId
            )
        ){
            throw new Error(
                "The current spreadsheet does not match the spreadsheet used to start this branch chart job."
            );
        }

        const tempSpreadsheet =
            SpreadsheetApp.openById(
                state.tempSpreadsheetId
            );

        const batchStart =
            new Date().getTime();

        let processed =
            0;

        while(

            state.residentIndex <
                state.totalResidents &&

            processed <
                BRANCH_WEB_BATCH_MAX_RESIDENTS &&

            (
                new Date().getTime() -
                batchStart
            ) <
                BRANCH_WEB_BATCH_MAX_RUNTIME_MS

        ){

            const index =
                Number(
                    state.residentIndex
                );

            const residentID =
                String(
                    state.residentIds[index] || ""
                ).trim();

            if(!residentID){

                state.residentIndex =
                    index + 1;

                processed++;

                saveBranchWebBatchState(
                    state
                );

                continue;
            }

            const resident =
                getResident(
                    residentID
                );

            if(!resident){

                state.residentIndex =
                    index + 1;

                processed++;

                setGenerationProgress(
                    executionId,
                    calculateMedicationChartProgress(
                        state.completedPages,
                        state.totalPages
                    ),
                    "Resident " +
                        (index + 1) +
                        " of " +
                        state.totalResidents +
                        " skipped.",
                    {
                        residentNumber:
                            index + 1,
                        totalResidents:
                            state.totalResidents
                    }
                );

                saveBranchWebBatchState(
                    state
                );

                continue;
            }

            setGenerationProgress(
                executionId,
                calculateMedicationChartProgress(
                    state.completedPages,
                    state.totalPages
                ),
                "Preparing resident " +
                    (index + 1) +
                    " of " +
                    state.totalResidents +
                    " - " +
                    String(
                        resident.Residents ||
                        resident.ResidentID
                    ) +
                    "...",
                {
                    residentNumber:
                        index + 1,
                    totalResidents:
                        state.totalResidents,
                    residentName:
                        resident.Residents ||
                        resident.ResidentID
                }
            );

            try{

                const branchProgressState = {

                    completedPages:
                        Number(
                            state.completedPages || 0
                        ),

                    totalPages:
                        Number(
                            state.totalPages || 0
                        ),

                    residentNumber:
                        index + 1,

                    totalResidents:
                        state.totalResidents

                };

                const report =
                    generateResidentMedicationCharts(
                        residentID,
                        state.year,
                        state.month,
                        executionId,
                        branchProgressState
                    );

                if(
                    !report ||
                    !report.sheets ||
                    report.sheets.length === 0
                ){
                    throw new Error(
                        "Resident chart generator returned no sheets."
                    );
                }

                state.completedPages =
                    Number(
                        branchProgressState.completedPages || 0
                    );

                copyBranchChartSheetsToTemporaryWorkbook(
                    report.sheets,
                    tempSpreadsheet
                );

                deleteBranchWebBatchSourceSheets(
                    report.sheets
                );

                state.residentIndex =
                    index + 1;

                processed++;

                setGenerationProgress(
                    executionId,
                    calculateMedicationChartProgress(
                        state.completedPages,
                        state.totalPages
                    ),
                    "Resident " +
                        (index + 1) +
                        " of " +
                        state.totalResidents +
                        " completed.",
                    {
                        residentNumber:
                            index + 1,
                        totalResidents:
                            state.totalResidents,
                        residentName:
                            resident.Residents ||
                            resident.ResidentID
                    }
                );

                saveBranchWebBatchState(
                    state
                );

            }catch(residentError){

                Logger.log(
                    "Resident skipped: " +
                    String(
                        resident.Residents ||
                        resident.ResidentID
                    ) +
                    " | " +
                    residentError
                );

                state.residentIndex =
                    index + 1;

                processed++;

                setGenerationProgress(
                    executionId,
                    calculateMedicationChartProgress(
                        state.completedPages,
                        state.totalPages
                    ),
                    "Resident " +
                        (index + 1) +
                        " of " +
                        state.totalResidents +
                        " skipped.",
                    {
                        residentNumber:
                            index + 1,
                        totalResidents:
                            state.totalResidents,
                        residentName:
                            resident.Residents ||
                            resident.ResidentID
                    }
                );

                saveBranchWebBatchState(
                    state
                );
            }

        }

        // ----------------------------------------------------
        // Completed
        // ----------------------------------------------------

        if(
            state.residentIndex >=
            state.totalResidents
        ){

            return finishBranchWebBatchJob(
                state,
                tempSpreadsheet
            );
        }

        // ----------------------------------------------------
        // More work remains.
        // Save state and let Loading.html call us again.
        // ----------------------------------------------------

        saveBranchWebBatchState(
            state
        );

        return {

            success:
                true,

            async:
                true,

            done:
                false,

            executionId:
                executionId,

            residentNumber:
                state.residentIndex,

            totalResidents:
                state.totalResidents,

            percent:
                Math.round(
                    calculateMedicationChartProgress(
                        state.completedPages,
                        state.totalPages
                    )
                )

        };

    }finally{

        lock.releaseLock();

    }
}


// ============================================================
// WEB ENTRY POINT
// ============================================================
//
// Branch chart:
//   returns async=true after each small batch.
//   Loading.html immediately starts the next batch.
//
// All other reports keep the original synchronous behavior.
//

function generateReportForWeb(
    action,
    residentID,
    branch,
    year,
    month,
    executionId
){

    try{

        setGenerationProgress(
            executionId,
            8,
            "Preparing " +
            getReportTitle(action) +
            "..."
        );

        // ----------------------------------------------------
        // RESUMABLE BRANCH CHART
        // ----------------------------------------------------

        if(
            action === "branchchart"
        ){

            return processBranchMedicationChartWebBatch(
                branch,
                Number(year),
                Number(month),
                executionId
            );
        }

        // ----------------------------------------------------
        // Existing synchronous reports
        // ----------------------------------------------------

        let result;

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

        setGenerationProgress(
            executionId,
            99,
            "Saving PDF..."
        );

        const file =
            saveTemporaryPdf(
                result
            );

        const previewUrl =
            "https://drive.google.com/file/d/" +
            file.getId() +
            "/preview";

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

    }catch(err){

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


// ============================================================
// OPTIONAL MAINTENANCE
// ============================================================

function cleanupStaleBranchWebBatchStates(){

    const props =
        PropertiesService
            .getScriptProperties();

    const all =
        props.getProperties();

    const cutoff =
        Date.now() -
        (6 * 60 * 60 * 1000);

    Object.keys(all).forEach(function(key){

        if(
            key.indexOf(
                BRANCH_WEB_BATCH_PREFIX
            ) !== 0
        ){
            return;
        }

        try{

            const state =
                JSON.parse(
                    all[key]
                );

            if(
                state &&
                state.createdAt &&
                state.createdAt < cutoff
            ){

                if(
                    state.tempFileId
                ){
                    try{
                        deleteTemporaryWorkbook(
                            DriveApp.getFileById(
                                state.tempFileId
                            )
                        );
                    }catch(err){
                        Logger.log(
                            "Unable to remove stale branch temp workbook: " +
                            err
                        );
                    }
                }

                props.deleteProperty(key);
            }

        }catch(err){

            // Ignore malformed state.
        }

    });
}
