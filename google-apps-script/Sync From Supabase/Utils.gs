function getSheet(name) {
  return SpreadsheetApp
    .openById(CONFIG.SPREADSHEET_ID)
    .getSheetByName(name);
}

function getHeaders(sheet) {
  return sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
}

function getBranchCode(branchLocale) {

  const sheet = getSheet(CONFIG.SHEETS.BRANCH);

  const values = sheet.getDataRange().getValues();

  const header = values[0];

  const localeCol = header.indexOf("BranchLocale");
  const codeCol = header.indexOf("BranchCode");

  for(let i=1;i<values.length;i++){

    if(values[i][localeCol] == branchLocale){

      return values[i][codeCol];

    }

  }

  throw new Error("Branch not found : " + branchLocale);

}

function getBranchLocale(){

  const sheet = getSheet(CONFIG.SHEETS.BRANCH);

  const values = sheet.getDataRange().getValues();

  return values[1][
      getHeaders(sheet).indexOf("BranchLocale")
  ];

}

function getGoogleRole(accessRole){

  const sheet = getSheet(CONFIG.SHEETS.ROLE_MAPPING);

  const values = sheet.getDataRange().getValues();

  const header = values[0];

  const accessCol = header.indexOf("AccessRole");
  const googleCol = header.indexOf("GoogleRole");

  accessRole = String(accessRole || "").trim().toUpperCase();

  for(let i=1;i<values.length;i++){

    if(String(values[i][accessCol]).trim().toUpperCase() == accessRole){

      return values[i][googleCol];

    }

  }

  return accessRole;

}

function getDepartment(position){

  const sheet =
      getSheet(
          CONFIG.SHEETS.DEPARTMENT_MAPPING
      );

  if(!sheet){

    throw new Error(
      "Department Mapping sheet not found."
    );

  }

  const values =
      sheet
          .getDataRange()
          .getValues();

  if(values.length < 2){

    return "";

  }

  const header =
      values[0];

  const positionCol =
      header.indexOf("Position");

  const deptCol =
      header.indexOf("Department");

  if(positionCol == -1){

    throw new Error(
      'Column "Position" not found in ' +
      CONFIG.SHEETS.DEPARTMENT_MAPPING
    );

  }

  if(deptCol == -1){

    throw new Error(
      'Column "Department" not found in ' +
      CONFIG.SHEETS.DEPARTMENT_MAPPING
    );

  }

  const searchPosition =
      String(position || "")
          .trim()
          .toUpperCase();

  if(searchPosition == ""){

    return "";

  }

  for(let i = 1; i < values.length; i++){

    const mappingPosition =
        String(
          values[i][positionCol] || ""
        )
        .trim()
        .toUpperCase();

    if(mappingPosition == searchPosition){

      return String(
        values[i][deptCol] || ""
      ).trim();

    }

  }

  return "";

}

function getBranchLocaleFromCode(branchCode){

  const sheet =
    getSheet(
      CONFIG.SHEETS.BRANCH
    );

  const values =
    sheet
      .getDataRange()
      .getValues();

  const header =
    values[0];

  const localeCol =
    header.indexOf("BranchLocale");

  const codeCol =
    header.indexOf("BranchCode");

  if(
    localeCol === -1 ||
    codeCol === -1
  ){

    throw new Error(
      "Branch mapping columns not found."
    );

  }

  const searchCode =
    String(branchCode || "")
      .trim()
      .toUpperCase();

  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const mappingCode =
      String(
        values[i][codeCol] || ""
      )
      .trim()
      .toUpperCase();

    if(
      mappingCode === searchCode
    ){

      return String(
        values[i][localeCol] || ""
      ).trim();

    }

  }

  throw new Error(
    "Branch code not found: " +
    branchCode
  );

}


