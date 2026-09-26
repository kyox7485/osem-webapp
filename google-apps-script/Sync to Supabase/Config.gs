const CONFIG = {

  SYSTEM_SPREADSHEET_ID: "18yXlG0YjSkkCCx1pTWOYQYZMCeU8QM7Fo6i77zoMQV4",

  CLINICAL_SPREADSHEET_ID:"1hoXIYtE4Q4MydbgYHiTsSO9OBYUxbPqcbhsT7VDeYQM",

  MEDICATION_SPREADSHEET_ID: "1HXT8HFjjjBakaZiLeU9FggM8cKLZJDBrUjnNqRK3goA",

  // Spreadsheet holding the tbl_MedicationStock tab (MedicationStock.gs).
  // Assumed to be the medication spreadsheet; if the tab lives elsewhere,
  // change only this ID.
  MEDICATION_STOCK_SPREADSHEET_ID: "1HXT8HFjjjBakaZiLeU9FggM8cKLZJDBrUjnNqRK3goA",

  // Consumables spreadsheet (Consumables.gs). It has no Apps Script of its
  // own — this project opens it by ID. Same as the PDF project's
  // "ConsumableModuleID".
  CONSUMABLE_SPREADSHEET_ID: "1_P_pl06r964aa8zHnDw5h8f6kg8JfQWviJ_41FctCHU",

  SHEETS: {

    RESIDENT: "tbl_ResidentList",

    BRANCH: "tbl_Branch",

    MEDICATION_ORDER: "tbl_MedicationOrder",

    // Exact tab name as read by the Appsheet PDF Generation project
    // (its CONFIG.MEDICATION_STOCK_SHEET).
    MEDICATION_STOCK: "tbl_MedicationStock",

    VITAL: "tbl_Vital",

    // Consumables spreadsheet tabs (matched case-insensitively).
    CONSUMABLE_MASTER: "tbl_ConsumableMaster",
    RESIDENT_CONSUMABLE: "tbl_ResidentConsumable"

  }

};
