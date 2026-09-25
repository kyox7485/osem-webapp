function doPost(e) {

  try {

    Logger.log("========== WEBHOOK RECEIVED ==========");

    Logger.log(
      "Timestamp: " +
      new Date().toISOString()
    );

    if (!e) {

      Logger.log(
        "ERROR: e is undefined"
      );

      return jsonResponse_({
        success: false,
        error: "Request object missing."
      });

    }

    Logger.log(
      "PostData exists: " +
      !!e.postData
    );

    if (
      e.postData &&
      e.postData.contents
    ) {

      Logger.log(
        "RAW BODY:"
      );

      Logger.log(
        e.postData.contents
      );

    }
    else {

      Logger.log(
        "ERROR: postData.contents missing."
      );

    }


    if (
      !e.postData ||
      !e.postData.contents
    ) {

      throw new Error(
        "POST body is missing."
      );

    }


    const request =
      JSON.parse(
        e.postData.contents
      );


    Logger.log(
      "Parsed request:"
    );

    Logger.log(
      JSON.stringify(
        request,
        null,
        2
      )
    );


    Logger.log(
      "Table: " +
      request.table
    );

    Logger.log(
      "Type: " +
      request.type
    );


    /* =====================================================
       STAFF WEBHOOK
       ===================================================== */

    if (
      request &&
      request.table ===
        CONFIG.SUPABASE.STAFF_TABLE &&
      (
        request.type === "INSERT" ||
        request.type === "UPDATE" ||
        request.type === "DELETE"
      )
    ) {

      Logger.log(
        ">>> STAFF WEBHOOK MATCHED"
      );


      if (
        typeof validateStaffWebhookToken_ ===
        "function"
      ) {

        Logger.log(
          "Validating staff webhook token..."
        );

        validateStaffWebhookToken_(
          e
        );

        Logger.log(
          "Staff webhook token valid."
        );

      }


      Logger.log(
        "Calling syncStaffFromSupabaseWebhook()..."
      );


      const result =
        syncStaffFromSupabaseWebhook(
          request
        );


      Logger.log(
        "Staff sync result:"
      );

      Logger.log(
        JSON.stringify(
          result,
          null,
          2
        )
      );


      return jsonResponse_(
        result
      );

    }


    /* =====================================================
       RESIDENT WEBHOOK
       ===================================================== */

    if (
      request &&
      request.table ===
        "tbl_residents" &&
      (
        request.type === "INSERT" ||
        request.type === "UPDATE"
      )
    ) {

      Logger.log(
        ">>> RESIDENT WEBHOOK MATCHED"
      );


      if (
        typeof validateResidentWebhookToken_ ===
        "function"
      ) {

        validateResidentWebhookToken_(
          e
        );

      }


      const result =
        syncResidentFromSupabaseWebhook(
          request
        );


      return jsonResponse_(
        result
      );

    }


    /* =====================================================
       EXISTING OSEM ROUTES
       ===================================================== */

    let result;


    switch (
      request.table
    ) {

      case CONFIG.SHEETS.RESIDENT:

        if (
          request.action ===
          "updateField"
        ) {

          result =
            syncResidentField(
              request.ResidentID,
              request.Branch,
              request.field,
              request.value
            );

        }

        else if (
          request.action ===
          "updateFields"
        ) {

          result =
            syncResidentFields(
              request.ResidentID,
              request.Branch,
              request.updates
            );

        }

        else {

          result =
            syncResident(
              request.data
            );

        }

        break;


      case CONFIG.SHEETS.STAFF:

        result =
          syncStaff(
            request.data
          );

        break;


      case CONFIG.SHEETS.PROGRESS_NOTE:

        result =
          syncProgressNote(
            request.data
          );

        break;


      default:

        Logger.log(
          "Unsupported table: " +
          request.table
        );

        throw new Error(
          "Unsupported table : " +
          request.table
        );

    }


    return jsonResponse_(
      result
    );


  }
  catch (err) {

    Logger.log(
      "========== WEBHOOK ERROR =========="
    );

    Logger.log(
      err &&
      err.stack
        ? err.stack
        : String(err)
    );


    return jsonResponse_({

      success:
        false,

      error:
        err &&
        err.message
          ? err.message
          : String(err)

    });

  }

}


function jsonResponse_(data) {

  return ContentService
    .createTextOutput(
      JSON.stringify(
        data
      )
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );

}


/* ==========================================================
   TEST DEPARTMENT
   ========================================================== */

function testDepartment() {

  Logger.log(
    getDepartment(
      "Staff Nurse"
    )
  );

}


/* ==========================================================
   TEST RESIDENT SYNC FIELDS
   ========================================================== */

function testResidentSyncFields() {

  const sheet =
    getSheet(
      CONFIG.SHEETS.RESIDENT
    );

  const headers =
    getHeaders(
      sheet
    );

  Logger.log(
    "Resident sync fields:"
  );

  headers.forEach(
    function(
      header,
      index
    ) {

      Logger.log(
        (index + 1) +
        " | " +
        header
      );

    }
  );

}


/* ==========================================================
   TEST STAFF WEBHOOK PAYLOAD
   ========================================================== */

/**
 * This only tests the Apps Script webhook router.
 *
 * It does NOT require Supabase to call doPost().
 *
 * Replace the StaffID with an actual Supabase StaffID.
 */
function testStaffWebhookRouter() {

  const supabase =
    getSupabaseConfig_();

  const rows =
    supabaseGetById_(
      supabase,
      CONFIG.SUPABASE.STAFF_TABLE,
      "StaffID",
      "DEMO-0001",
      [
        "StaffID",
        "staff_name",
        "branch_id",
        "department",
        "position_id",
        "role",
        "status",
        "updated_at"
      ]
    );

  if (
    rows.length === 0
  ) {

    throw new Error(
      "Test StaffID not found."
    );

  }

  const payload = {

    type:
      "UPDATE",

    table:
      "tbl_staff",

    record:
      rows[0],

    old_record:
      null

  };

  const result =
    syncStaffFromSupabaseWebhook(
      payload
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;

}