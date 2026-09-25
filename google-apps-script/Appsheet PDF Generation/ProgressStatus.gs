
//====================================================
// GENERATION PROGRESS - OPTIMIZED
//====================================================
//
// Drop-in replacement for svgProgressStatus.gs.
//
// Improvements:
// 1. Percentage is always a whole number.
// 2. Progress is clamped to 0-100.
// 3. Cache writes are skipped when the meaningful progress state
//    has not changed.
// 4. The existing progress object fields are preserved.
// 5. Cache TTL remains 600 seconds.
//
// This does NOT change any report-generation logic.
//====================================================

function setGenerationProgress(
  executionId,
  percent,
  message,
  extra
) {

  if (!executionId) {
    return;
  }

  var cache =
    CacheService.getScriptCache();

  var key =
    "MED_CHART_PROGRESS_" +
    executionId;

  var existing = null;

  var cached =
    cache.get(key);

  if (cached) {

    try {

      existing =
        JSON.parse(cached);

    } catch (err) {

      existing = null;

    }

  }

  /*
   * ------------------------------------------------------------
   * NORMALISE PERCENTAGE
   * ------------------------------------------------------------
   */

  var newPercent =
    Number(percent);

  if (isNaN(newPercent)) {
    newPercent = 0;
  }

  newPercent =
    Math.round(newPercent);

  newPercent =
    Math.max(
      0,
      Math.min(
        100,
        newPercent
      )
    );

  /*
   * ------------------------------------------------------------
   * NEVER MOVE BACKWARDS
   * ------------------------------------------------------------
   */

  if (
    existing &&
    typeof existing.percent === "number"
  ) {

    newPercent =
      Math.max(
        existing.percent,
        newPercent
      );

  }

  /*
   * ------------------------------------------------------------
   * PRESERVE EXISTING CONTEXT
   * ------------------------------------------------------------
   */

  var nextStatus =
    extra && extra.status
      ? extra.status
      : (
          existing && existing.status
            ? existing.status
            : "running"
        );

  var nextPdfUrl =
    extra && extra.pdfUrl
      ? extra.pdfUrl
      : (
          existing && existing.pdfUrl
            ? existing.pdfUrl
            : ""
        );

  var nextResidentName =
    extra && extra.residentName
      ? extra.residentName
      : (
          existing && existing.residentName
            ? existing.residentName
            : ""
        );

  var nextResidentNumber =
    extra &&
    extra.residentNumber != null
      ? extra.residentNumber
      : (
          existing &&
          existing.residentNumber != null
            ? existing.residentNumber
            : 0
        );

  var nextTotalResidents =
    extra &&
    extra.totalResidents != null
      ? extra.totalResidents
      : (
          existing &&
          existing.totalResidents != null
            ? existing.totalResidents
            : 0
        );

  var nextMessage =
    message != null
      ? String(message)
      : (
          existing && existing.message
            ? existing.message
            : ""
        );

  /*
   * ------------------------------------------------------------
   * SMART CACHE-WRITE FILTER
   * ------------------------------------------------------------
   *
   * The browser only needs a new cache value when something
   * meaningful changed.
   *
   * This prevents repeated writes of identical progress states.
   */

  if (existing) {

    var samePercent =
      Number(existing.percent) ===
      Number(newPercent);

    var sameMessage =
      String(existing.message || "") ===
      nextMessage;

    var sameStatus =
      String(existing.status || "") ===
      String(nextStatus || "");

    var samePdfUrl =
      String(existing.pdfUrl || "") ===
      String(nextPdfUrl || "");

    var sameResidentName =
      String(existing.residentName || "") ===
      String(nextResidentName || "");

    var sameResidentNumber =
      Number(existing.residentNumber || 0) ===
      Number(nextResidentNumber || 0);

    var sameTotalResidents =
      Number(existing.totalResidents || 0) ===
      Number(nextTotalResidents || 0);

    /*
     * If absolutely nothing visible has changed, do not perform
     * another CacheService.put().
     */
    if (
      samePercent &&
      sameMessage &&
      sameStatus &&
      samePdfUrl &&
      sameResidentName &&
      sameResidentNumber &&
      sameTotalResidents
    ) {

      return;

    }

  }

  /*
   * ------------------------------------------------------------
   * SAVE
   * ------------------------------------------------------------
   */

  var data = {

    executionId:
      executionId,

    percent:
      newPercent,

    message:
      nextMessage,

    status:
      nextStatus,

    pdfUrl:
      nextPdfUrl,

    residentName:
      nextResidentName,

    residentNumber:
      nextResidentNumber,

    totalResidents:
      nextTotalResidents,

    updatedAt:
      new Date().getTime()

  };

  cache.put(
    key,
    JSON.stringify(data),
    600
  );

}


//====================================================
// READ PROGRESS
//====================================================

function getGenerationProgress(
  executionId
) {

  if (!executionId) {

    return {

      status:
        "error",

      percent:
        0,

      message:
        "Missing execution ID."

    };

  }

  var key =
    "MED_CHART_PROGRESS_" +
    executionId;

  var cached =
    CacheService
      .getScriptCache()
      .get(key);

  if (!cached) {

    return {

      executionId:
        executionId,

      status:
        "starting",

      percent:
        5,

      message:
        "Starting report generation..."

    };

  }

  try {

    var data =
      JSON.parse(cached);

    /*
     * Defensive normalisation.
     * This ensures even old cache entries display a clean
     * whole-number percentage.
     */
    if (
      typeof data.percent === "number"
    ) {

      data.percent =
        Math.round(
          Math.max(
            0,
            Math.min(
              100,
              data.percent
            )
          )
        );

    }

    return data;

  } catch (err) {

    return {

      executionId:
        executionId,

      status:
        "error",

      percent:
        0,

      message:
        "Unable to read generation status."

    };

  }

}


//====================================================
// OPTIONAL HELPER
//====================================================

function updateDetailedReportProgress(
  executionId,
  percent,
  message,
  extra
) {

  setGenerationProgress(
    executionId,
    Math.round(percent),
    message,
    extra
  );

}
