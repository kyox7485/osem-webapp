/**
 * OSEM - Next.js PDF API
 *
 * AppSheet doGet() remains untouched.
 *
 * Next.js:
 *   POST action=chart/branchchart
 *      -> queue job
 *      -> return executionId immediately
 *
 * Apps Script trigger:
 *   -> processNextJsPdfQueue()
 *   -> generateReportForWeb()
 *
 * Next.js:
 *   POST action=status
 *      -> getGenerationProgress()
 */


/* =========================================================
 * API ENTRY POINT
 * ========================================================= */

function doPost(e) {

  try {

    var payload =
      parseApiPostPayload(e);

    validateNextJsApiKey(
      payload.apiKey
    );


    /* -----------------------------------------------------
     * STATUS REQUEST
     * ----------------------------------------------------- */

    if (payload.action === "status") {

      if (!payload.executionId) {
        throw new Error(
          "executionId is required."
        );
      }

      return jsonApiResponse({
        success: true,
        executionId: payload.executionId,
        status:
          getGenerationProgress(
            payload.executionId
          )
      });

    }


    /* -----------------------------------------------------
     * PDF REQUEST
     * ----------------------------------------------------- */

    var action =
      payload.action || "chart";

    if (
      action !== "chart" &&
      action !== "branchchart"
    ) {
      throw new Error(
        "Unsupported API action: " +
        action
      );
    }


    var residentID =
      payload.residentID || "";

    var branch =
      payload.branch || "";

    var year =
      Number(payload.year);

    var month =
      Number(payload.month);


    validateApiRequest(
      action,
      residentID,
      branch,
      year,
      month
    );


    var executionId =
      Utilities.getUuid();


    /* -----------------------------------------------------
     * INITIAL STATUS
     * ----------------------------------------------------- */

    setGenerationProgress(
      executionId,
      5,
      "PDF job queued.",
      {
        status: "queued"
      }
    );


    /* -----------------------------------------------------
     * QUEUE JOB
     * ----------------------------------------------------- */

    enqueueNextJsPdfJob({
      executionId: executionId,
      action: action,
      residentID: residentID,
      branch: branch,
      year: year,
      month: month,
      createdAt:
        new Date().getTime()
    });


    /* -----------------------------------------------------
     * RETURN IMMEDIATELY
     * ----------------------------------------------------- */

    return jsonApiResponse({
      success: true,
      action: action,
      executionId: executionId,
      status: "queued",
      pdfUrl: "",
      message:
        "PDF generation queued."
    });

  }


  catch (err) {

    Logger.log(
      "Next.js PDF API error: " +
      (err.stack || err.toString())
    );

    return jsonApiResponse({
      success: false,
      executionId: "",
      error: err.toString()
    });

  }

}


/* =========================================================
 * QUEUE STORAGE
 * ========================================================= */

function enqueueNextJsPdfJob(job) {

  var lock =
    LockService.getScriptLock();

  lock.waitLock(10000);

  try {

    var properties =
      PropertiesService
        .getScriptProperties();

    var raw =
      properties.getProperty(
        "NEXTJS_PDF_QUEUE"
      );

    var queue = [];

    if (raw) {

      try {

        queue =
          JSON.parse(raw);

      }
      catch (err) {

        queue = [];

      }

    }


    queue.push(job);


    properties.setProperty(
      "NEXTJS_PDF_QUEUE",
      JSON.stringify(queue)
    );


    ensureNextJsPdfWorkerTrigger();

  }

  finally {

    lock.releaseLock();

  }

}


/* =========================================================
 * WORKER TRIGGER
 * ========================================================= */

function ensureNextJsPdfWorkerTrigger() {

  var triggers =
    ScriptApp.getProjectTriggers();

  for (
    var i = 0;
    i < triggers.length;
    i++
  ) {

    if (
      triggers[i]
        .getHandlerFunction() ===
      "processNextJsPdfQueue"
    ) {

      return;

    }

  }


  ScriptApp
    .newTrigger(
      "processNextJsPdfQueue"
    )
    .timeBased()
    .after(1000)
    .create();

}


/* =========================================================
 * QUEUE WORKER
 * ========================================================= */

function processNextJsPdfQueue(e) {

  /*
   * Delete the one-shot trigger that invoked this worker.
   */

  deleteCurrentWorkerTrigger(e);


  var job = null;


  try {

    job =
      dequeueNextJsPdfJob();

    if (!job) {

      return;

    }


    setGenerationProgress(
      job.executionId,
      8,
      "Starting PDF generation...",
      {
        status: "running"
      }
    );


    generateReportForWeb(
      job.action,
      job.residentID,
      job.branch,
      Number(job.year),
      Number(job.month),
      job.executionId
    );


  }

  catch (err) {

    Logger.log(
      "Next.js PDF worker error: " +
      (err.stack || err.toString())
    );


    if (job && job.executionId) {

      setGenerationProgress(
        job.executionId,
        0,
        err.toString(),
        {
          status: "error"
        }
      );

    }

  }


  finally {

    /*
     * If more jobs remain,
     * schedule another worker.
     */

    if (hasNextJsPdfJobs()) {

      ensureNextJsPdfWorkerTrigger();

    }

  }

}


/* =========================================================
 * DEQUEUE
 * ========================================================= */

function dequeueNextJsPdfJob() {

  var lock =
    LockService.getScriptLock();

  lock.waitLock(10000);

  try {

    var properties =
      PropertiesService
        .getScriptProperties();

    var raw =
      properties.getProperty(
        "NEXTJS_PDF_QUEUE"
      );

    if (!raw) {

      return null;

    }


    var queue;

    try {

      queue =
        JSON.parse(raw);

    }
    catch (err) {

      queue = [];

    }


    if (
      !Array.isArray(queue) ||
      queue.length === 0
    ) {

      properties.deleteProperty(
        "NEXTJS_PDF_QUEUE"
      );

      return null;

    }


    var job =
      queue.shift();


    if (queue.length > 0) {

      properties.setProperty(
        "NEXTJS_PDF_QUEUE",
        JSON.stringify(queue)
      );

    }
    else {

      properties.deleteProperty(
        "NEXTJS_PDF_QUEUE"
      );

    }


    return job;

  }

  finally {

    lock.releaseLock();

  }

}


/* =========================================================
 * CHECK QUEUE
 * ========================================================= */

function hasNextJsPdfJobs() {

  var raw =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        "NEXTJS_PDF_QUEUE"
      );

  if (!raw) {

    return false;

  }


  try {

    var queue =
      JSON.parse(raw);

    return (
      Array.isArray(queue) &&
      queue.length > 0
    );

  }

  catch (err) {

    return false;

  }

}


/* =========================================================
 * DELETE CURRENT ONE-SHOT TRIGGER
 * ========================================================= */

function deleteCurrentWorkerTrigger(e) {

  if (
    !e ||
    !e.triggerUid
  ) {

    return;

  }


  var triggers =
    ScriptApp.getProjectTriggers();

  var triggerUid =
    String(e.triggerUid);


  triggers.forEach(
    function(trigger) {

      if (
        trigger.getUniqueId() ===
        triggerUid
      ) {

        ScriptApp.deleteTrigger(
          trigger
        );

      }

    }
  );

}


/* =========================================================
 * PARSE REQUEST
 * ========================================================= */

function parseApiPostPayload(e) {

  if (
    !e ||
    !e.postData ||
    !e.postData.contents
  ) {

    throw new Error(
      "Missing POST request body."
    );

  }


  var payload;

  try {

    payload =
      JSON.parse(
        e.postData.contents
      );

  }

  catch (err) {

    throw new Error(
      "Invalid JSON request body."
    );

  }


  if (
    !payload ||
    typeof payload !== "object"
  ) {

    throw new Error(
      "Invalid API payload."
    );

  }


  return payload;

}


/* =========================================================
 * API KEY
 * ========================================================= */

function validateNextJsApiKey(apiKey) {

  var expectedKey =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        "NEXTJS_API_KEY"
      );


  if (!expectedKey) {

    throw new Error(
      "NEXTJS_API_KEY is not configured in Apps Script Script Properties."
    );

  }


  if (
    !apiKey ||
    apiKey !== expectedKey
  ) {

    throw new Error(
      "Unauthorized API request."
    );

  }

}


/* =========================================================
 * REQUEST VALIDATION
 * ========================================================= */

function validateApiRequest(
  action,
  residentID,
  branch,
  year,
  month
) {

  if (action === "chart") {

    if (!residentID) {

      throw new Error(
        "residentID is required for chart generation."
      );

    }

  }


  if (action === "branchchart") {

    if (!branch) {

      throw new Error(
        "branch is required for branch chart generation."
      );

    }

  }


  if (
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100
  ) {

    throw new Error(
      "Invalid year."
    );

  }


  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {

    throw new Error(
      "Invalid month."
    );

  }

}


/* =========================================================
 * JSON RESPONSE
 * ========================================================= */

function jsonApiResponse(data) {

  return ContentService
    .createTextOutput(
      JSON.stringify(data)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );

}

function authorizeNextJsPdfApi() {

  // Forces Apps Script to request ScriptApp permission.
  ScriptApp.getProjectTriggers();

  // Also verifies that trigger creation is permitted.
  ensureNextJsPdfWorkerTrigger();

  Logger.log("Next.js PDF API authorization check completed.");

}