

function cleanupTemporaryPdfs(){

  const folder =
      DriveApp.getFolderById(
          getConfigValue("TemporaryPdfFolderID")
      );

  const files = folder.getFiles();

  const cutoff =
      Date.now() - 24*60*60*1000;

  while(files.hasNext()){

      const file = files.next();

      Logger.log("----------------");
      Logger.log(file.getName());
      Logger.log(file.getMimeType());
      Logger.log(file.getLastUpdated());

      if(file.getLastUpdated().getTime() < cutoff){

          Logger.log("DELETE");

          file.setTrashed(true);

      }

  }

}


function testGetResidentAMN14(){

    const residentID = "AMN-14";

    Logger.log(
        "Testing getResident..."
    );

    Logger.log(
        "ResidentID = [" +
        residentID +
        "]"
    );

    const resident =
        getResident(
            residentID
        );

    Logger.log(
        "Result = " +
        (resident ? "FOUND" : "NOT FOUND")
    );

    if(resident){

        Logger.log(
            "ResidentID returned = " +
            resident["ResidentID"]
        );

        Logger.log(
            "Name = " +
            resident["Residents"]
        );

        Logger.log(
            "Branch = " +
            resident["Branch"]
        );

    }

}

function testGenerateResidentFamilyConsumableReminderReport(){

    const residentID = "AMN-14";

    Logger.log(
        "===== TEST CONSUMABLE REPORT ====="
    );

    Logger.log(
        "ResidentID = [" +
        residentID +
        "]"
    );

    Logger.log(
        "Type = " +
        typeof residentID
    );

    const result =
        generateResidentFamilyConsumableReminderReport(
            residentID
        );

    Logger.log(
        "Report generated = " +
        result.getName()
    );

}

function testMedicationChartWebWrapper(){

    const result =
        generateMedicationChartPdfForWeb(
            "AMN-138",
            2026,
            9
        );


    Logger.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );

}