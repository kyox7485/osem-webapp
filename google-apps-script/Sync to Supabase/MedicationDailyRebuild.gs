/**
 * ================================================================
 * DAILY MEDICATION RECONCILIATION + SUMMARY REBUILD
 * ================================================================
 *
 * Why this exists
 * ---------------
 * tbl_residents.current_medication_list (the "Current medication list" on
 * the resident page) is only rebuilt:
 *   1. right after a webapp save (syncMedicationOrderAndSummaryNow), and
 *   2. by the 1-minute heartbeat, when the Sheet fingerprint changed.
 *
 * Every targeted save also stores the new fingerprint, so if its summary
 * rebuild fails (lock contention, timeout) the heartbeat never sees a change
 * and the resident's list stays stale forever. The old 24-hour trigger
 * (syncAllMedicationOrdersToSupabase) only reconciles ORDERS, never the
 * summaries. Seen 2026-10-02: BMN-0153 had 6 active orders and an empty
 * list; BGN-0178 was missing one medicine.
 *
 * dailyMedicationReconciliation() runs the existing order reconciliation
 * and then rebuildAllCurrentMedications(), which rewrites only the summaries
 * that differ -- so a missed rebuild repairs itself within 24 hours.
 *
 * Setup (once, after pasting this file)
 * -------------------------------------
 * Run setupDailyMedicationReconciliationTrigger() from the editor. It
 * replaces the old syncAllMedicationOrdersToSupabase daily trigger with
 * this one. Do NOT run setupMedicationReconciliationTrigger() afterwards --
 * it would re-add the old orders-only trigger alongside this one.
 *
 * Uses (does not redefine): syncAllMedicationOrdersToSupabase()
 * (MedicationSync.gs) and rebuildAllCurrentMedications()
 * (MedicationSummary.gs). Each takes and releases the script lock itself.
 * ================================================================
 */

function dailyMedicationReconciliation() {
  let syncResult = null;
  let syncError = null;

  try {
    syncResult = syncAllMedicationOrdersToSupabase();
  } catch (err) {
    // Still rebuild: summaries are built from Supabase, and a partial order
    // sync must not leave every other resident's list stale too.
    syncError = err;
    console.error("Daily medication reconciliation (orders) failed: " + err);
  }

  let rebuildResult;
  try {
    rebuildResult = rebuildAllCurrentMedications();
  } catch (err) {
    console.error("Daily medication summary rebuild failed: " + err);
    if (syncError) throw syncError;
    throw err;
  }

  Logger.log(
    "Daily medication reconciliation done. Orders synced=" +
    (syncResult ? syncResult.synced : "error") +
    ", order failures=" +
    (syncResult ? syncResult.failed : "error") +
    ", summaries changed=" +
    rebuildResult.summariesChanged
  );

  if (syncError) throw syncError; // surface it in the trigger's failure email

  return {
    success: Boolean(syncResult && syncResult.success),
    orders: syncResult,
    summaries: rebuildResult
  };
}

function setupDailyMedicationReconciliationTrigger() {
  const handlers = [
    "syncAllMedicationOrdersToSupabase", // old orders-only daily trigger
    "dailyMedicationReconciliation"
  ];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 03:00-04:00 script time zone: outside nursing-round hours, so the
  // ~1-2 minutes it holds the script lock doesn't delay webapp saves.
  ScriptApp.newTrigger("dailyMedicationReconciliation")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  Logger.log(
    "Daily medication reconciliation + summary rebuild trigger created (03:00)."
  );
}
