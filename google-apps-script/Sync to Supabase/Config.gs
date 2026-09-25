const CONFIG = {

  SYSTEM_SPREADSHEET_ID: "18yXlG0YjSkkCCx1pTWOYQYZMCeU8QM7Fo6i77zoMQV4",

  CLINICAL_SPREADSHEET_ID:"1hoXIYtE4Q4MydbgYHiTsSO9OBYUxbPqcbhsT7VDeYQM",

  MEDICATION_SPREADSHEET_ID: "1HXT8HFjjjBakaZiLeU9FggM8cKLZJDBrUjnNqRK3goA",

  // Spreadsheet holding the tbl_MedicationStock tab (MedicationStock.gs).
  // Assumed to be the medication spreadsheet; if the tab lives elsewhere,
  // change only this ID.
  MEDICATION_STOCK_SPREADSHEET_ID: "1HXT8HFjjjBakaZiLeU9FggM8cKLZJDBrUjnNqRK3goA",

  SHEETS: {

    RESIDENT: "tbl_ResidentList",

    BRANCH: "tbl_Branch",

    MEDICATION_ORDER: "tbl_MedicationOrder",

    // Exact tab name as read by the Appsheet PDF Generation project
    // (its CONFIG.MEDICATION_STOCK_SHEET).
    MEDICATION_STOCK: "tbl_MedicationStock",

    VITAL: "tbl_Vital"

  }

};
