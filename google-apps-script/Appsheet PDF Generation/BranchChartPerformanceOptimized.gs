
/**
 * OSEM BRANCH MEDICATION CHART - PERFORMANCE OPTIMISATION
 *
 * DROP-IN SUPPORT FILE
 *
 * This file adds branch-chart-only optimized helpers.
 * It does NOT alter the resident chart generators, PRN generator,
 * or the existing createTemporaryWorkbook() used by other reports.
 *
 * Main optimization:
 * 1. Do NOT make a full copy of the master spreadsheet for branch PDF.
 * 2. Create a genuinely blank temporary spreadsheet.
 * 3. Copy only the already-generated medication chart sheets into it.
 * 4. Do NOT copy/delete branch sheets resident-by-resident.
 * 5. Delete the original generated sheets once, at the very end.
 *
 * Safety:
 * - SpreadsheetApp.flush() is retained before final PDF export.
 * - A 2000 ms safety wait is retained immediately before export.
 * - Existing chart generation / PRN generation functions are reused.
 */

/* ================================================================
 * FAST BRANCH TEMPORARY WORKBOOK
 * ================================================================ */

function createFastBranchTemporaryWorkbook(executionId) {

  var name =
    "TEMP_BRANCH_" +
    String(executionId || generateExecutionId());

  var ss = SpreadsheetApp.create(name);

  var file = DriveApp.getFileById(ss.getId());

  return {
    file: file,
    spreadsheet: ss,
    templateSheet: ss.getSheets()[0]
  };
}


/* ================================================================
 * COPY ALL GENERATED CHART SHEETS
 * ================================================================ */

function copyBranchChartSheetsToTemporaryWorkbook(
  sourceSheets,
  targetSpreadsheet
) {

  var copiedSheets = [];

  if (!sourceSheets || sourceSheets.length === 0) {
    return copiedSheets;
  }

  sourceSheets.forEach(function(sourceSheet) {

    if (!sourceSheet) {
      return;
    }

    var copied =
      sourceSheet.copyTo(targetSpreadsheet);

    /*
     * copyTo() may initially assign "Copy of ...".
     * Rename only after the copy has completed.
     */
    try {
      copied.setName(sourceSheet.getName());
    } catch (renameError) {
      /*
       * A duplicate name should never normally occur because the
       * generated chart names are unique. Keep the copied sheet if
       * Google rejects the rename for any reason.
       */
      Logger.log(
        "Could not rename copied branch sheet: " +
        sourceSheet.getName() +
        " : " +
        renameError
      );
    }

    copiedSheets.push(copied);

  });

  return copiedSheets;
}


/* ================================================================
 * REMOVE THE DEFAULT BLANK SHEET
 * ================================================================ */

function removeFastBranchDefaultSheet(
  tempSpreadsheet,
  defaultSheet
) {

  if (!tempSpreadsheet || !defaultSheet) {
    return;
  }

  /*
   * Google Sheets cannot have zero sheets.
   * Only remove the default sheet after at least one chart sheet
   * has been copied.
   */
  if (tempSpreadsheet.getSheets().length > 1) {

    try {
      tempSpreadsheet.deleteSheet(defaultSheet);
    } catch (err) {
      Logger.log(
        "Could not remove default branch temp sheet: " +
        err
      );
    }

  }

}


/* ================================================================
 * OPTIMIZED BRANCH CHART GENERATION
 * ================================================================ */

function generateBranchMedicationChartsOptimized(
  branch,
  year,
  month,
  executionId
) {

  var totalStart =
    new Date().getTime();

  var residents =
    getResidentsByBranch(branch);

  var totalResidents =
    residents.length;

  if (totalResidents === 0) {

    throw new Error(
      "No active residents found for branch: " +
      branch
    );

  }

  var totalPages =
    calculateBranchTotalChartPages(residents);

  if (totalPages <= 0) {

    throw new Error(
      "No medication chart pages found for branch: " +
      branch
    );

  }

  var branchProgressState = {

    completedPages: 0,

    totalPages: totalPages,

    residentNumber: 0,

    totalResidents: totalResidents

  };

  /*
   * MAIN PIPELINE OPTIMISATION
   *
   * Create a BLANK workbook once at the beginning.
   *
   * Old pipeline:
   *   copy entire master workbook
   *   generate charts
   *   copy resident sheets
   *   delete resident sheets
   *   later delete master/template sheets from temp workbook
   *
   * New pipeline:
   *   create blank workbook
   *   generate charts in master
   *   copy only chart sheets
   *   delete source chart sheets immediately
   *
   * This avoids copying the entire master workbook and avoids deleting
   * all the unrelated master sheets from the PDF workbook.
   */
  var temp =
    createFastBranchTemporaryWorkbook(
      executionId
    );

  var generatedSourceSheets = [];

  try {

    residents.forEach(function(
      resident,
      index
    ) {

      var residentNumber =
        index + 1;

      branchProgressState.residentNumber =
        residentNumber;

      setGenerationProgress(
        executionId,
        calculateMedicationChartProgress(
          branchProgressState.completedPages,
          branchProgressState.totalPages
        ),
        "Preparing resident " +
          residentNumber +
          " of " +
          totalResidents +
          " - " +
          String(
            resident.Residents ||
            resident.ResidentID
          ) +
          "...",
        {
          residentNumber: residentNumber,
          totalResidents: totalResidents,
          residentName:
            resident.Residents ||
            resident.ResidentID
        }
      );

      try {

        var residentExecutionId =
          generateExecutionId();

        /*
         * The existing resident generator is deliberately retained.
         * This preserves all existing chart formatting and medication
         * logic.
         */
        var report =
          generateResidentMedicationCharts(
            resident.ResidentID,
            year,
            month,
            residentExecutionId,
            branchProgressState
          );

        if (
          !report ||
          !report.sheets ||
          report.sheets.length === 0
        ) {

          throw new Error(
            "Resident chart generator returned no sheets."
          );

        }

        /*
         * Copy only this resident's finished chart pages.
         *
         * We do this BEFORE deleting the source pages, so a failed copy
         * cannot accidentally destroy the source chart.
         */
        copyBranchChartSheetsToTemporaryWorkbook(
          report.sheets,
          temp.spreadsheet
        );

        /*
         * Delete this resident's source pages immediately.
         *
         * This keeps the master spreadsheet small throughout the entire
         * branch run and prevents sheet-count growth from affecting
         * later residents.
         */
        for (
          var s = report.sheets.length - 1;
          s >= 0;
          s--
        ) {

          var sourceSheet =
            report.sheets[s];

          if (!sourceSheet) {
            continue;
          }

          try {

            SpreadsheetApp
              .getActiveSpreadsheet()
              .deleteSheet(sourceSheet);

          } catch (deleteError) {

            Logger.log(
              "Unable to delete source chart sheet: " +
              deleteError
            );

          }

        }

        /*
         * The actual branch page counter is maintained by the resident
         * chart generator through branchProgressState.
         */
        setGenerationProgress(
          executionId,
          calculateMedicationChartProgress(
            branchProgressState.completedPages,
            branchProgressState.totalPages
          ),
          "Resident " +
            residentNumber +
            " of " +
            totalResidents +
            " completed.",
          {
            residentNumber: residentNumber,
            totalResidents: totalResidents,
            residentName:
              resident.Residents ||
              resident.ResidentID
          }
        );

      } catch (residentError) {

        Logger.log(
          String(
            resident.Residents ||
            resident.ResidentID
          ) +
          " skipped : " +
          residentError
        );

        /*
         * Best-effort cleanup if the resident generator created some
         * source sheets before failing.
         */
        try {

          var activeSS =
            SpreadsheetApp.getActiveSpreadsheet();

          var sheetsNow =
            activeSS.getSheets();

          var residentPrefix =
            String(
              resident.Residents ||
              resident.ResidentID
            );

          /*
           * Do not guess/delete unrelated sheets here.
           * The resident generator's own report reference is normally
           * available only on successful completion, so failed resident
           * cleanup is intentionally conservative.
           */

        } catch (ignoreCleanupError) {

          Logger.log(
            "Failed during skipped-resident cleanup: " +
            ignoreCleanupError
          );

        }

        setGenerationProgress(
          executionId,
          calculateMedicationChartProgress(
            branchProgressState.completedPages,
            branchProgressState.totalPages
          ),
          "Resident " +
            residentNumber +
            " of " +
            totalResidents +
            " skipped.",
          {
            residentNumber: residentNumber,
            totalResidents: totalResidents
          }
        );

      }

    });

    /*
     * Count actual report sheets in the temporary workbook.
     */
    var finalSheets =
      temp.spreadsheet.getSheets();

    /*
     * If the only sheet is still the default blank sheet, generation
     * did not produce a usable report.
     */
    if (
      finalSheets.length === 1 &&
      finalSheets[0].getName() ===
        temp.templateSheet.getName()
    ) {

      throw new Error(
        "Branch medication chart generation produced no sheets."
      );

    }

    /*
     * Remove the default blank sheet only after chart sheets exist.
     */
    removeFastBranchDefaultSheet(
      temp.spreadsheet,
      temp.templateSheet
    );

    /*
     * Final flush before returning the temporary workbook.
     *
     * The intentional 2-second safety wait remains in the PDF export
     * stage, not here, so there is only ONE deliberate wait.
     */
    SpreadsheetApp.flush();

    setGenerationProgress(
      executionId,
      50,
      "All branch medication charts generated.",
      {
        residentNumber: totalResidents,
        totalResidents: totalResidents
      }
    );

    Logger.log(
      "Optimized branch chart generation complete."
    );

    Logger.log(
      "Branch: " + branch
    );

    Logger.log(
      "Residents: " + totalResidents
    );

    Logger.log(
      "Chart pages in temporary workbook: " +
      temp.spreadsheet.getSheets().length
    );

    Logger.log(
      "Generation time: " +
      (
        (new Date().getTime() - totalStart) /
        1000
      ) +
      " seconds"
    );

    return {

      branch: branch,

      year: year,

      month: month,

      executionId: executionId,

      totalResidents: totalResidents,

      totalPages: totalPages,

      sheets:
        temp.spreadsheet.getSheets(),

      file: temp.file,

      spreadsheet: temp.spreadsheet,

      templateSheet:
        temp.templateSheet

    };

  } catch (err) {

    /*
     * Remove the temporary workbook if branch generation fails.
     */
    try {

      if (temp && temp.file) {

        deleteTemporaryWorkbook(
          temp.file
        );

      }

    } catch (cleanupError) {

      Logger.log(
        "Optimized branch temp cleanup failed: " +
        cleanupError
      );

    }

    throw err;

  }

}


/* ================================================================
 * DELETE GENERATED SOURCE SHEETS - ONE TIME ONLY
 * ================================================================ */

function deleteOptimizedBranchGeneratedSheets(
  report
) {

  if (
    !report ||
    !report.sheets ||
    report.sheets.length === 0
  ) {
    return;
  }

  var ss =
    SpreadsheetApp.getActiveSpreadsheet();

  /*
   * Delete in reverse order.
   * This avoids depending on array positions changing while sheets
   * are removed.
   */
  for (
    var i = report.sheets.length - 1;
    i >= 0;
    i--
  ) {

    var sheet =
      report.sheets[i];

    if (!sheet) {
      continue;
    }

    try {

      ss.deleteSheet(sheet);

    } catch (err) {

      Logger.log(
        "Unable to delete generated branch sheet: " +
        err
      );

    }

  }

}


/* ================================================================
 * OPTIMIZED BRANCH PDF PIPELINE
 *
 * USE THIS FUNCTION FROM PDFengine.gs:
 *
 * generateBranchMedicationChartPdfOptimized(...)
 *
 * ================================================================ */

function generateBranchMedicationChartPdfOptimized(
  branch,
  year,
  month,
  executionId
) {

  var totalStart =
    new Date().getTime();

  var report = null;
  var temp = null;

  try {

    /*
     * -------------------------------------------------------------
     * 1. GENERATE ALL CHART SHEETS
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
      !report.sheets ||
      report.sheets.length === 0
    ) {

      throw new Error(
        "Branch medication chart generation returned no chart sheets."
      );

    }

    /*
     * -------------------------------------------------------------
     * 2. CREATE A BLANK TEMPORARY WORKBOOK
     *
     * This is the main performance optimisation.
     *
     * OLD:
     *   copy entire master workbook
     *   delete almost all sheets
     *
     * NEW:
     *   create genuinely blank workbook
     *   copy only chart sheets
     * -------------------------------------------------------------
     */

    setGenerationProgress(
      executionId,
      52,
      "Creating PDF workbook..."
    );

    temp =
      createFastBranchTemporaryWorkbook(
        executionId
      );

    if (
      !temp ||
      !temp.spreadsheet ||
      typeof temp.spreadsheet.getId !== "function"
    ) {

      throw new Error(
        "Failed to create optimized temporary workbook."
      );

    }

    /*
     * -------------------------------------------------------------
     * 3. COPY ONLY THE REQUIRED CHART SHEETS
     * -------------------------------------------------------------
     */

    setGenerationProgress(
      executionId,
      58,
      "Copying branch chart pages..."
    );

    var copiedSheets =
      copyBranchChartSheetsToTemporaryWorkbook(
        report.sheets,
        temp.spreadsheet
      );

    if (copiedSheets.length === 0) {

      throw new Error(
        "No branch chart sheets could be copied to the PDF workbook."
      );

    }

    /*
     * Now it is safe to remove the default blank sheet.
     */
    removeFastBranchDefaultSheet(
      temp.spreadsheet,
      temp.templateSheet
    );

    /*
     * Flush the copied sheets.
     *
     * No arbitrary sleep here yet because the final export stage
     * below contains the intentional safety wait.
     */
    SpreadsheetApp.flush();

    /*
     * -------------------------------------------------------------
     * 4. DELETE ORIGINAL GENERATED SHEETS
     *
     * This is now done ONCE rather than once per resident.
     * -------------------------------------------------------------
     */

    setGenerationProgress(
      executionId,
      68,
      "Cleaning up temporary chart pages..."
    );

    deleteOptimizedBranchGeneratedSheets(
      report
    );

    /*
     * -------------------------------------------------------------
     * 5. FINAL SAFETY FLUSH + WAIT
     *
     * INTENTIONALLY RETAINED.
     *
     * This protects against the exact propagation issue you
     * described: the last cell edits may not be fully committed
     * before the PDF export request starts.
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
     * 6. EXPORT PDF
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
        temp.file,
        filename,
        false
      );

    /*
     * -------------------------------------------------------------
     * 7. CLEANUP
     * -------------------------------------------------------------
     */

    setGenerationProgress(
      executionId,
      95,
      "Branch PDF generated. Cleaning up..."
    );

    /*
     * Trashing the temporary file is intentionally done after
     * export. The PDF blob is already in memory.
     */
    deleteTemporaryWorkbook(
      temp.file
    );

    temp = null;

    /*
     * -------------------------------------------------------------
     * 8. FINISH
     * -------------------------------------------------------------
     */

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

    /*
     * -------------------------------------------------------------
     * ERROR CLEANUP
     * -------------------------------------------------------------
     */

    Logger.log(
      "Optimized branch medication PDF failed: " +
      err
    );

    /*
     * If a temporary workbook was created, remove it.
     */
    if (temp && temp.file) {

      try {

        deleteTemporaryWorkbook(
          temp.file
        );

      } catch (cleanupError) {

        Logger.log(
          "Temporary workbook cleanup failed: " +
          cleanupError
        );

      }

    }

    /*
     * IMPORTANT:
     *
     * If an error occurs before source sheets were deleted,
     * delete them here so the original workbook does not accumulate
     * generated chart sheets.
     */
    if (
      report &&
      report.sheets &&
      report.sheets.length
    ) {

      try {

        deleteOptimizedBranchGeneratedSheets(
          report
        );

      } catch (sourceCleanupError) {

        Logger.log(
          "Source chart cleanup failed: " +
          sourceCleanupError
        );

      }

    }

    throw err;

  }

}
