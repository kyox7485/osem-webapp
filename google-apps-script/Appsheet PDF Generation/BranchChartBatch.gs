/**
 * OSEM BRANCH MEDICATION CHART - ASYNC BATCH WORKER
 *
 * PURPOSE
 * -------
 * The normal Apps Script web request cannot wait for a large branch
 * medication chart job because Apps Script has a 6-minute execution
 * limit per execution.
 *
 * This worker preserves the existing chart/PDF architecture but splits
 * the branch into multiple time-driven executions.
 *
 * FLOW
 * ----
 * Browser
 *   -> generateReportForWeb()
 *   -> startBranchMedicationChartJob()
 *   -> returns immediately
 *
 * Trigger worker
 *   -> process a small batch of residents
 *   -> saves state in PropertiesService
 *   -> schedules the next worker
 *   -> eventually exports the final PDF
 *
 * DEPENDENCIES
 * ------------
 * Existing project functions are deliberately reused:
 *   getResidentsByBranch()
 *   calculateBranchTotalChartPages()
 *   createFastBranchTemporaryWorkbook()
 *   copyBranchChartSheetsToTemporaryWorkbook()
 *   removeFastBranchDefaultSheet()
 *   generateResidentMedicationCharts()
 *   exportWorkbookToPdf()
 *   saveTemporaryPdf()
 *   deleteTemporaryWorkbook()
 *   getBranchMedicationChartFilename()
 *   calculateMedicationChartProgress()
 *   setGenerationProgress()
 *
 * No chart layout or medication logic is duplicated here.
 */

// ============================================================
// SETTINGS
// ============================================================

// Keep batches deliberately small.
// Current observed execution reached resident ~19 before the
// 6-minute limit, so 5 residents per execution gives substantial
// safety margin for the PDF/chart service calls.
var BRANCH_BATCH_MAX_RESIDENTS = 5;

// Also stop before the hard Apps Script execution limit.
// 4 minutes leaves room for cleanup, state saving and scheduling.
var BRANCH_BATCH_MAX_RUNTIME_MS = 4 * 60 * 1000;

// Small delay before the next trigger.
var BRANCH_BATCH_NEXT_DELAY_MS = 1500;

// Script Properties key prefix.
var BRANCH_BATCH_STATE_PREFIX =
  "OSEM_BRANCH_CHART_JOB_";


// ============================================================
// START JOB
// ============================================================

function startBranchMedicationChartJob(
  branch,
  year,
  month,
  executionId
) {

  branch = String(branch || "").trim();
  year = Number(year);
  month = Number(month);
  executionId = String(executionId || "").trim();

  if (!branch) {
    throw new Error("Branch is required.");
  }

  if (!Number.isFinite(year) || year < 2000) {
    throw new Error("Invalid chart year: " + year);
  }

  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error("Invalid chart month: " + month);
  }

  if (!executionId) {
    executionId = Utilities.getUuid();
  }

  var existingState =
    getBranchMedicationChartJobState(executionId);

  if (existingState) {
    return {
      success: true,
      async: true,
      executionId: executionId,
      totalResidents:
        Number(existingState.totalResidents || 0)
    };
  }

  // ----------------------------------------------------------
  // Load residents once.
  // ----------------------------------------------------------

  var residents =
    getResidentsByBranch(branch);

  if (!residents || residents.length === 0) {
    throw new Error(
      "No active residents found for branch: " +
      branch
    );
  }

  // ----------------------------------------------------------
  // Calculate total pages once.
  // This preserves the existing 15% -> 50% progress model.
  // ----------------------------------------------------------

  var totalPages =
    calculateBranchTotalChartPages(residents);

  if (!totalPages || totalPages <= 0) {
    throw new Error(
      "No medication chart pages found for branch: " +
      branch
    );
  }

  // Store only ResidentID values in PropertiesService.
  // Resident objects remain in the existing source cache.
  var residentIds =
    residents.map(function(resident) {
      return String(resident.ResidentID || "").trim();
    }).filter(function(id) {
      return id !== "";
    });

  if (residentIds.length === 0) {
    throw new Error(
      "No valid ResidentID values found for branch: " +
      branch
    );
  }

  // ----------------------------------------------------------
  // Create the PDF workbook ONCE.
  // It survives across worker executions.
  // ----------------------------------------------------------

  var temp =
    createFastBranchTemporaryWorkbook(
      executionId
    );

  var state = {

    executionId: executionId,

    branch: branch,

    year: year,

    month: month,

    residentIds: residentIds,

    residentIndex: 0,

    totalResidents: residentIds.length,

    completedPages: 0,

    totalPages: totalPages,

    tempFileId: temp.file.getId(),

    tempSpreadsheetId: temp.spreadsheet.getId(),

    createdAt: new Date().getTime(),

    status: "running"

  };

  saveBranchMedicationChartJobState(
    state
  );

  setGenerationProgress(
    executionId,
    10,
    "Preparing " +
      state.totalResidents +
      " residents...",
    {
      residentNumber: 0,
      totalResidents:
        state.totalResidents
    }
  );

  // The initial web request returns immediately.
  // The actual generation continues in a trigger.
  scheduleBranchMedicationChartJob(
    executionId,
    BRANCH_BATCH_NEXT_DELAY_MS
  );

  return {
    success: true,
    async: true,
    executionId: executionId,
    totalResidents: state.totalResidents
  };
}


// ============================================================
// WORKER
// ============================================================

function processBranchMedicationChartJob(e) {

  var triggerUid =
    e && e.triggerUid
      ? String(e.triggerUid)
      : "";

  // One-shot trigger -> executionId mapping.
  var executionId =
    triggerUid
      ? getBranchMedicationExecutionIdForTrigger(
          triggerUid
        )
      : "";

  if (triggerUid) {
    deleteBranchMedicationTriggerByUid(
      triggerUid
    );
  }

  // Manual execution fallback.
  if (!executionId) {

    var jobIds =
      findRunningBranchMedicationChartJobs();

    if (jobIds.length) {
      executionId = jobIds[0];
    }

  }

  if (!executionId) {
    return;
  }

  var scriptLock =
    LockService.getScriptLock();

  // If another worker is already running, immediately hand this job
  // back to a fresh worker execution instead of losing the continuation.
  if (!scriptLock.tryLock(5000)) {

    scheduleBranchMedicationChartJob(
      executionId,
      BRANCH_BATCH_NEXT_DELAY_MS
    );

    return;
  }

  try {

    var state =
      getBranchMedicationChartJobState(
        executionId
      );

    if (!state) {
      return;
    }

    if (state.status !== "running") {
      return;
    }

    processBranchMedicationChartBatch(
      state
    );

  } catch (err) {

    Logger.log(
      "Branch chart worker failed: " +
      (err && err.stack
        ? err.stack
        : err)
    );

    var failedState =
      getBranchMedicationChartJobState(
        executionId
      );

    markBranchMedicationChartJobError(
      failedState,
      err
    );

  } finally {

    scriptLock.releaseLock();

  }
}


// ============================================================
// PROCESS ONE BATCH
// ============================================================

function processBranchMedicationChartBatch(
  state
) {

  var executionId =
    state.executionId;

  var startTime =
    new Date().getTime();

  var tempSpreadsheet =
    SpreadsheetApp.openById(
      state.tempSpreadsheetId
    );

  var processedThisBatch = 0;

  while (
    state.residentIndex <
      state.totalResidents &&
    processedThisBatch <
      BRANCH_BATCH_MAX_RESIDENTS &&
    (
      new Date().getTime() -
      startTime
    ) <
      BRANCH_BATCH_MAX_RUNTIME_MS
  ) {

    var index =
      Number(state.residentIndex);

    var residentId =
      String(
        state.residentIds[index] || ""
      ).trim();

    if (!residentId) {

      state.residentIndex =
        index + 1;

      processedThisBatch++;

      saveBranchMedicationChartJobState(
        state
      );

      continue;
    }

    var resident =
      getResident(residentId);

    if (!resident) {

      Logger.log(
        "Resident not found during branch batch: " +
        residentId
      );

      state.residentIndex =
        index + 1;

      processedThisBatch++;

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
          residentNumber: index + 1,
          totalResidents:
            state.totalResidents
        }
      );

      saveBranchMedicationChartJobState(
        state
      );

      continue;
    }

    // --------------------------------------------------------
    // Resident progress
    // --------------------------------------------------------

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
        residentNumber: index + 1,
        totalResidents:
          state.totalResidents,
        residentName:
          resident.Residents ||
          resident.ResidentID
      }
    );

    var report = null;

    try {

      // ------------------------------------------------------
      // IMPORTANT:
      // Reuse the existing resident chart generator.
      // branchProgressState is a normal object for this execution.
      // ------------------------------------------------------

      var branchProgressState = {

        completedPages:
          Number(state.completedPages || 0),

        totalPages:
          Number(state.totalPages || 0),

        residentNumber:
          index + 1,

        totalResidents:
          state.totalResidents

      };

      report =
        generateResidentMedicationCharts(
          residentId,
          state.year,
          state.month,
          executionId,
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

      // Keep the branch-wide page counter exactly as maintained
      // by the existing resident/PRN generators.
      state.completedPages =
        Number(
          branchProgressState.completedPages || 0
        );

      // ------------------------------------------------------
      // Copy ONLY this resident's finished pages into the
      // persistent temporary PDF workbook.
      // ------------------------------------------------------

      copyBranchChartSheetsToTemporaryWorkbook(
        report.sheets,
        tempSpreadsheet
      );

      // ------------------------------------------------------
      // Delete this resident's source chart sheets immediately.
      // This keeps the source workbook small.
      // ------------------------------------------------------

      deleteBranchSourceSheets(
        report.sheets
      );

      state.residentIndex =
        index + 1;

      processedThisBatch++;

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

      saveBranchMedicationChartJobState(
        state
      );

    } catch (residentError) {

      Logger.log(
        "Resident chart generation failed: " +
          String(
            resident.Residents ||
            resident.ResidentID
          ) +
          " | " +
          (
            residentError &&
            residentError.stack
              ? residentError.stack
              : residentError
          )
      );

      // Best-effort cleanup of any pages produced before failure.
      try {

        if (
          report &&
          report.sheets &&
          report.sheets.length
        ) {

          deleteBranchSourceSheets(
            report.sheets
          );

        }

      } catch (cleanupError) {

        Logger.log(
          "Resident source cleanup failed: " +
          cleanupError
        );

      }

      // Preserve the existing branch behavior of skipping a resident
      // rather than aborting the whole branch PDF.
      state.residentIndex =
        index + 1;

      processedThisBatch++;

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

      saveBranchMedicationChartJobState(
        state
      );
    }
  }

  // ----------------------------------------------------------
  // Final batch state
  // ----------------------------------------------------------

  if (
    state.residentIndex >=
    state.totalResidents
  ) {

    finishBranchMedicationChartJob(
      state,
      tempSpreadsheet
    );

    return;
  }

  // ----------------------------------------------------------
  // More residents remain.
  // Save and continue in a NEW execution.
  // ----------------------------------------------------------

  saveBranchMedicationChartJobState(
    state
  );

  Logger.log(
    "Branch chart batch paused. Resident " +
      state.residentIndex +
      " of " +
      state.totalResidents +
      " completed."
  );

  scheduleBranchMedicationChartJob(
    executionId,
    BRANCH_BATCH_NEXT_DELAY_MS
  );
}


// ============================================================
// FINISH JOB
// ============================================================

function finishBranchMedicationChartJob(
  state,
  tempSpreadsheet
) {

  var executionId =
    state.executionId;

  try {

    var finalSheets =
      tempSpreadsheet.getSheets();

    if (
      !finalSheets ||
      finalSheets.length === 0
    ) {

      throw new Error(
        "Branch medication chart workbook contains no sheets."
      );

    }

    // Remove the initial blank sheet created by SpreadsheetApp.create().
    removeFastBranchDefaultSheet(
      tempSpreadsheet,
      finalSheets[0]
    );

    // There may be only the blank sheet if every resident was skipped.
    var reportSheets =
      tempSpreadsheet.getSheets();

    if (
      reportSheets.length === 0
    ) {

      throw new Error(
        "Branch medication chart generation produced no sheets."
      );

    }

    setGenerationProgress(
      executionId,
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

    // Keep the existing propagation buffer before PDF export.
    Utilities.sleep(2000);

    setGenerationProgress(
      executionId,
      82,
      "Generating branch medication PDF...",
      {
        residentNumber:
          state.totalResidents,
        totalResidents:
          state.totalResidents
      }
    );

    var filename =
      getBranchMedicationChartFilename(
        state.branch,
        state.year,
        state.month
      );

    var pdf =
      exportWorkbookToPdf(
        DriveApp.getFileById(
          state.tempFileId
        ),
        filename,
        false
      );

    setGenerationProgress(
      executionId,
      95,
      "Branch PDF generated. Saving PDF...",
      {
        residentNumber:
          state.totalResidents,
        totalResidents:
          state.totalResidents
      }
    );

    var file =
      saveTemporaryPdf({
        filename: filename,
        pdf: pdf
      });

    var previewUrl =
      "https://drive.google.com/file/d/" +
      file.getId() +
      "/preview";

    setGenerationProgress(
      executionId,
      100,
      "PDF ready!",
      {
        status: "completed",
        pdfUrl: previewUrl,
        residentNumber:
          state.totalResidents,
        totalResidents:
          state.totalResidents
      }
    );

    state.status = "completed";
    state.completedAt =
      new Date().getTime();

    saveBranchMedicationChartJobState(
      state
    );

    // Temporary workbook is no longer required.
    try {

      deleteTemporaryWorkbook(
        DriveApp.getFileById(
          state.tempFileId
        )
      );

    } catch (cleanupError) {

      Logger.log(
        "Final temporary workbook cleanup failed: " +
        cleanupError
      );

    }

    // Keep completed state temporarily so duplicate initial requests
    // do not start another job.
    clearBranchMedicationChartJobStateLater(
      executionId
    );

  } catch (err) {

    markBranchMedicationChartJobError(
      state,
      err
    );

  }
}


// ============================================================
// SOURCE SHEET CLEANUP
// ============================================================

function deleteBranchSourceSheets(
  sheets
) {

  if (
    !sheets ||
    sheets.length === 0
  ) {
    return;
  }

  // The existing chart generator is bound to the source workbook.
  var sourceSS =
    SpreadsheetApp.getActiveSpreadsheet();

  if (!sourceSS) {
    throw new Error(
      "Unable to access the source spreadsheet while cleaning branch chart sheets."
    );
  }

  for (
    var i = sheets.length - 1;
    i >= 0;
    i--
  ) {

    var sheet =
      sheets[i];

    if (!sheet) {
      continue;
    }

    try {

      sourceSS.deleteSheet(
        sheet
      );

    } catch (err) {

      Logger.log(
        "Unable to delete source chart sheet: " +
        err
      );

    }
  }
}


// ============================================================
// TRIGGER MANAGEMENT
// ============================================================

function scheduleBranchMedicationChartJob(
  executionId,
  delayMs
) {

  delayMs =
    Math.max(
      1000,
      Number(delayMs || 1500)
    );

  var trigger =
    ScriptApp
      .newTrigger(
        "processBranchMedicationChartJob"
      )
      .timeBased()
      .after(delayMs)
      .create();

  var triggerUid =
    String(
      trigger.getUniqueId()
    );

  PropertiesService
    .getScriptProperties()
    .setProperty(
      getBranchMedicationTriggerKey(
        triggerUid
      ),
      String(executionId)
    );

  Logger.log(
    "Scheduled next branch chart worker for " +
      executionId +
      " | trigger=" +
      triggerUid
  );
}

function getBranchMedicationTriggerKey(
  triggerUid
) {

  return (
    BRANCH_BATCH_STATE_PREFIX +
    "TRIGGER_" +
    String(triggerUid || "")
  );

}

function getBranchMedicationExecutionIdForTrigger(
  triggerUid
) {

  if (!triggerUid) {
    return "";
  }

  return (
    PropertiesService
      .getScriptProperties()
      .getProperty(
        getBranchMedicationTriggerKey(
          triggerUid
        )
      ) || ""
  );

}


function deleteBranchMedicationTriggerByUid(
  triggerUid
) {

  if (!triggerUid) {
    return;
  }

  var triggers =
    ScriptApp.getProjectTriggers();

  triggers.forEach(
    function(trigger) {

      try {

        if (
          String(
            trigger.getUniqueId()
          ) ===
          String(triggerUid)
        ) {

          ScriptApp.deleteTrigger(
            trigger
          );

        }

      } catch (err) {

        Logger.log(
          "Unable to delete worker trigger: " +
          err
        );

      }

    }
  );

  PropertiesService
    .getScriptProperties()
    .deleteProperty(
      getBranchMedicationTriggerKey(
        triggerUid
      )
    );
}


// ============================================================
// JOB STATE
// ============================================================

function getBranchMedicationChartJobKey(
  executionId
) {

  return (
    BRANCH_BATCH_STATE_PREFIX +
    String(executionId || "")
  );
}


function saveBranchMedicationChartJobState(
  state
) {

  if (
    !state ||
    !state.executionId
  ) {
    return;
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      getBranchMedicationChartJobKey(
        state.executionId
      ),
      JSON.stringify(state)
    );
}


function getBranchMedicationChartJobState(
  executionId
) {

  if (!executionId) {
    return null;
  }

  var raw =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        getBranchMedicationChartJobKey(
          executionId
        )
      );

  if (!raw) {
    return null;
  }

  try {

    return JSON.parse(raw);

  } catch (err) {

    Logger.log(
      "Invalid branch chart job state: " +
      executionId
    );

    return null;
  }
}


function findRunningBranchMedicationChartJobs() {

  var properties =
    PropertiesService
      .getScriptProperties()
      .getProperties();

  var ids = [];

  Object.keys(properties).forEach(
    function(key) {

      if (
        key.indexOf(
          BRANCH_BATCH_STATE_PREFIX
        ) !== 0
      ) {
        return;
      }

      try {

        var state =
          JSON.parse(
            properties[key]
          );

        if (
          state &&
          state.status === "running"
        ) {

          ids.push(
            String(
              state.executionId
            )
          );

        }

      } catch (err) {

        // Ignore malformed state entries.
      }

    }
  );

  return ids;
}


// ============================================================
// ERROR HANDLING
// ============================================================

function markBranchMedicationChartJobError(
  state,
  err
) {

  if (!state) {
    return;
  }

  var message =
    err && err.message
      ? err.message
      : String(err || "Unknown error");

  Logger.log(
    "Branch medication chart job failed [" +
      state.executionId +
      "]: " +
      message
  );

  state.status = "error";
  state.error =
    message;
  state.failedAt =
    new Date().getTime();

  setGenerationProgress(
    state.executionId,
    0,
    message,
    {
      status: "error",
      residentNumber:
        Number(state.residentIndex || 0),
      totalResidents:
        Number(state.totalResidents || 0)
    }
  );

  // Clean temporary workbook if one exists.
  if (state.tempFileId) {

    try {

      deleteTemporaryWorkbook(
        DriveApp.getFileById(
          state.tempFileId
        )
      );

    } catch (cleanupError) {

      Logger.log(
        "Branch job temporary workbook cleanup failed: " +
        cleanupError
      );

    }

  }

  saveBranchMedicationChartJobState(
    state
  );
}


// ============================================================
// KEEP COMPLETED/FAILED STATE TEMPORARILY
// ============================================================

// ============================================================
// NOTE
// ------------------------------------------------------------
// No additional cleanup trigger is created for completed jobs.
// Each new web request receives a new executionId, so completed
// state can safely remain in Script Properties until manually
// cleaned or naturally replaced.
// ============================================================

function clearCompletedBranchMedicationChartJobState() {

  var props =
    PropertiesService
      .getScriptProperties();

  var all =
    props.getProperties();

  Object.keys(all).forEach(
    function(key) {

      if (
        key.indexOf(
          BRANCH_BATCH_STATE_PREFIX
        ) !== 0 ||
        key.indexOf(
          BRANCH_BATCH_STATE_PREFIX + "TRIGGER_"
        ) === 0
      ) {
        return;
      }

      try {

        var state =
          JSON.parse(
            all[key]
          );

        if (
          state.status === "completed" ||
          state.status === "error"
        ) {

          props.deleteProperty(
            key
          );

        }

      } catch (err) {

        // Ignore malformed entries.
      }

    }
  );
}


// ============================================================
// AUTHORIZATION HELPER
// ============================================================
//
// Run this ONCE manually from the Apps Script editor after adding
// this file. It forces Apps Script to request the Script/Trigger
// permission before the first live branch request.
//

function authorizeBranchChartBatchTriggers() {

  ScriptApp.getProjectTriggers();

  PropertiesService
    .getScriptProperties()
    .setProperty(
      "OSEM_BRANCH_BATCH_AUTHORIZED",
      String(new Date().getTime())
    );

  Logger.log(
    "Branch chart batch trigger permissions are authorized."
  );
}
