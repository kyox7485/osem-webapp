const CONFIG = {

  //----------------------------------------------------
  // Spreadsheet
  //----------------------------------------------------

  SPREADSHEET_ID:
    "18yXlG0YjSkkCCx1pTWOYQYZMCeU8QM7Fo6i77zoMQV4",

  CLINICAL_SPREADSHEET_ID:
    "1hoXIYtE4Q4MydbgYHiTsSO9OBYUxbPqcbhsT7VDeYQM",

  //----------------------------------------------------
  // Sheet Names
  //----------------------------------------------------

  SHEETS: {

    RESIDENT: "tbl_ResidentList",

    STAFF: "tbl_StaffList",

    BRANCH: "tbl_Branch",

    USER_ACCESS: "tbl_UserAccess",

    ROLE_MAPPING: "tbl_RoleMapping",

    DEPARTMENT_MAPPING: "tbl_DepartmentMapping",

    REPORT: "tbl_Report",

    REPORT_LAUNCHER: "tbl_ReportLauncher",

    PROGRESS_NOTE: "tbl_ProgressNote"

  },

  //----------------------------------------------------
  // Status
  //----------------------------------------------------

  STATUS: {

    ACTIVE: "ACTIVE",

    INACTIVE: "INACTIVE"

  },

  //----------------------------------------------------
  // Roles
  //----------------------------------------------------

  ROLE: {

    ADMIN: "ADMIN",

    MODERATOR: "MODERATOR",

    STAFF: "STAFF"

  },

  //----------------------------------------------------
  // Supabase
  //----------------------------------------------------

  SUPABASE: {

    URL_PROPERTY:
      "SUPABASE_URL",

    API_KEY_PROPERTY:
      "SUPABASE_API_KEY",

    STAFF_TABLE:
      "tbl_staff",

    BRANCH_TABLE:
      "tbl_branches",

    POSITION_TABLE:
      "tbl_positions",

    PAGE_SIZE:
      1000

  },

  //----------------------------------------------------
  // Staff Sync
  //----------------------------------------------------

  STAFF_SYNC: {

    // Primary immediate sync
    WEBHOOK_ENABLED:
      true,

    // Backup / reconciliation sync
    FUNCTION_NAME:
      "syncStaffListFromSupabase",

    INTERVAL_HOURS:
      6,

    // IMPORTANT:
    // false = safety protection during migration
    // true  = allow full mirror to remove Google rows
    // when they no longer exist in Supabase.
    ALLOW_STAFF_COUNT_REDUCTION:
      false

  }

};