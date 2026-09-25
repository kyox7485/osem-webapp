//====================================================
// PRNChart.gs
//====================================================
//
// Generates PRN medication preparation charts.
//
// Layout:
//
//     Maximum 3 PRN medicines per page.
//
//     PRN #1 = rows 4–11
//     PRN #2 = rows 13–20
//     PRN #3 = rows 22–29
//
// Progress:
//
//     Standalone resident:
//         15% → 50%
//
//     Branch chart:
//         uses branchProgressState
//
// IMPORTANT:
//
// PRN sheet names MUST be unique across residents.
//
//====================================================


//====================================================
// PRN SETTINGS
//====================================================

const PRN_PER_PAGE = 3;


//====================================================
// IDENTIFY PRN MEDICATION
//====================================================

function isPRNMedication(
    medication
){

    return String(
        medication["Frequency"] || ""
    )
    .trim()
    .toUpperCase() == "PRN";

}


//====================================================
// GET RESIDENT PRN MEDICATION
//====================================================

function getResidentPRNMedication(
    residentID
){

    return getResidentMedication(
        residentID
    )
    .filter(
        function(med){

            return isPRNMedication(
                med
            );

        }
    );

}


//====================================================
// GET RESIDENT REGULAR MEDICATION
//====================================================

function getResidentRegularMedication(
    residentID
){

    return getResidentMedication(
        residentID
    )
    .filter(
        function(med){

            return !isPRNMedication(
                med
            );

        }
    );

}


//====================================================
// GENERATE PRN CHARTS
//====================================================

function generatePRNCharts(

    resident,

    medications,

    year,

    month,

    executionId,

    totalPages,

    completedPages,

    branchProgressState

){

    //------------------------------------------------
    // No PRN medication
    //------------------------------------------------

    if(
        !medications ||
        medications.length === 0
    ){

        return [];

    }


    //------------------------------------------------
    // Spreadsheet
    //------------------------------------------------

    const ss =
        SpreadsheetApp
            .getActiveSpreadsheet();


    //------------------------------------------------
    // PRN template
    //------------------------------------------------

    const template =
        ss.getSheetByName(
            CONFIG.PRN_TEMPLATE_SHEET
        );


    if(!template){

        throw new Error(
            "PRN Chart Template not found: " +
            CONFIG.PRN_TEMPLATE_SHEET
        );

    }


    //------------------------------------------------
    // Generated sheets
    //------------------------------------------------

    const generatedSheets =
        [];


    //------------------------------------------------
    // PRN pages for this resident
    //------------------------------------------------

    const totalPRNPages =
        Math.ceil(
            medications.length /
            PRN_PER_PAGE
        );


    //------------------------------------------------
    // Branch mode
    //------------------------------------------------

    const branchMode =
        !!branchProgressState;


    //------------------------------------------------
    // Local completed pages
    //------------------------------------------------

    let localCompletedPages =
        Number(
            completedPages || 0
        );


    //------------------------------------------------
    // Generate PRN pages
    //------------------------------------------------

    for(

        let start = 0;

        start < medications.length;

        start += PRN_PER_PAGE

    ){

        //------------------------------------------------
        // Page number
        //------------------------------------------------

        const pageNumber =
            Math.floor(
                start /
                PRN_PER_PAGE
            ) + 1;


        //------------------------------------------------
        // Medicines on this page
        //------------------------------------------------

        const pageMedications =
            medications.slice(

                start,

                start +
                PRN_PER_PAGE

            );


        //------------------------------------------------
        // Current completed pages
        //------------------------------------------------

        let currentCompletedPages;


        if(branchMode){

            currentCompletedPages =
                branchProgressState.completedPages;

        }
        else{

            currentCompletedPages =
                localCompletedPages;

        }


        //------------------------------------------------
        // Calculate progress BEFORE generation
        //------------------------------------------------

        let progressBefore =
            calculateMedicationChartProgress(

                currentCompletedPages,

                branchMode
                    ? branchProgressState.totalPages
                    : totalPages

            );


        //------------------------------------------------
        // Safety range
        //------------------------------------------------

        progressBefore =
            Math.max(
                15,
                Math.min(
                    50,
                    progressBefore
                )
            );


        //------------------------------------------------
        // Show current PRN page
        //------------------------------------------------

        if(branchMode){

            setGenerationProgress(

                executionId,

                progressBefore,

                "Preparing PRN medication chart " +

                pageNumber +

                " of " +

                totalPRNPages +

                "...",

                {

                    residentNumber:
                        branchProgressState.residentNumber,

                    totalResidents:
                        branchProgressState.totalResidents

                }

            );

        }
        else{

            setGenerationProgress(

                executionId,

                progressBefore,

                "Preparing PRN medication chart " +

                pageNumber +

                " of " +

                totalPRNPages +

                "...",

                {

                    residentName:
                        resident.Residents

                }

            );

        }


        //------------------------------------------------
        // Resident key
        //------------------------------------------------

        let residentKey =
            String(
                resident.ResidentID || ""
            )
            .trim();


        if(
            residentKey === ""
        ){

            residentKey =
                "RESIDENT";

        }


        residentKey =
            residentKey.replace(
                /[^A-Za-z0-9_-]/g,
                "_"
            );


        //------------------------------------------------
        // PRN page key
        //------------------------------------------------

        const pageKey =
            String(
                pageNumber
            );


        //------------------------------------------------
        // Unique sheet name
        //
        // Example:
        //
        // PRN_<execution>_AMN-138_1
        // PRN_<execution>_AMN-138_2
        //
        // Another resident:
        //
        // PRN_<execution>_AMN-139_1
        //------------------------------------------------

        const sheetName =
            "PRN_" +

            executionId +

            "_" +

            residentKey +

            "_" +

            pageKey;


        //------------------------------------------------
        // Create PRN sheet
        //------------------------------------------------

        const sheet =
            template.copyTo(
                ss
            );


        //------------------------------------------------
        // Set unique sheet name
        //------------------------------------------------

        sheet.setName(
            sheetName
        );


        //------------------------------------------------
        // Resident name
        //------------------------------------------------

        sheet
            .getRange(
                "G3"
            )
            .setValue(
                resident.Residents
            );


        //------------------------------------------------
        // Write PRN medications
        //------------------------------------------------

        writePRNPage(

            sheet,

            pageMedications

        );


        //------------------------------------------------
        // Store sheet
        //------------------------------------------------

        generatedSheets.push(
            sheet
        );


        //------------------------------------------------
        // Page completed
        //------------------------------------------------

        localCompletedPages++;


        //------------------------------------------------
        // Branch-wide counter
        //------------------------------------------------

        if(branchMode){

            branchProgressState.completedPages++;

        }


        //------------------------------------------------
        // Calculate progress AFTER completion
        //------------------------------------------------

        let progressAfter;


        if(branchMode){

            progressAfter =
                calculateMedicationChartProgress(

                    branchProgressState.completedPages,

                    branchProgressState.totalPages

                );

        }
        else{

            progressAfter =
                calculateMedicationChartProgress(

                    localCompletedPages,

                    totalPages

                );

        }


        //------------------------------------------------
        // Safety range
        //------------------------------------------------

        progressAfter =
            Math.max(
                15,
                Math.min(
                    50,
                    progressAfter
                )
            );


        //------------------------------------------------
        // Progress update
        //------------------------------------------------

        if(branchMode){

            setGenerationProgress(

                executionId,

                progressAfter,

                "PRN medication chart " +

                pageNumber +

                " of " +

                totalPRNPages +

                " completed.",

                {

                    residentNumber:
                        branchProgressState.residentNumber,

                    totalResidents:
                        branchProgressState.totalResidents

                }

            );

        }
        else{

            setGenerationProgress(

                executionId,

                progressAfter,

                "PRN medication chart " +

                pageNumber +

                " of " +

                totalPRNPages +

                " completed.",

                {

                    residentName:
                        resident.Residents

                }

            );

        }

    }


    //------------------------------------------------
    // Make sure all PRN changes are committed
    //------------------------------------------------

    SpreadsheetApp.flush();


    //------------------------------------------------
    // Return generated sheets
    //------------------------------------------------

    return generatedSheets;

}


//====================================================
// WRITE PRN PAGE
//====================================================
//
// Exact template layout:
//
// PRN #1
//     Row 4  = heading
//     Rows 5–8 = medicine
//     Rows 9–10 = indication
//     Row 11 = prescribed by
//
// PRN #2
//     Row 13 = heading
//     Rows 14–17 = medicine
//     Rows 18–19 = indication
//     Row 20 = prescribed by
//
// PRN #3
//     Row 22 = heading
//     Rows 23–26 = medicine
//     Rows 27–28 = indication
//     Row 29 = prescribed by
//
// Headings remain hardcoded in the template.
// Apps Script does NOT overwrite them.
//
//====================================================

function writePRNPage(
    sheet,
    medications
){

    const START_ROWS = [

        4,

        13,

        22

    ];


    //------------------------------------------------
    // Maximum 3 medicines
    //------------------------------------------------

    const medicineCount =
        Math.min(
            medications.length,
            3
        );


    //------------------------------------------------
    // Write each medicine
    //------------------------------------------------

    for(

        let index = 0;

        index < medicineCount;

        index++

    ){

        const med =
            medications[index];


        const row =
            START_ROWS[index];


        //------------------------------------------------
        // Medicine information
        //------------------------------------------------

        sheet

            .getRange(
                row + 1,
                1
            )

            .setValue(
                buildMedicineDescription(
                    med
                )
            )

            .setFontSize(
                15
            )

            .setWrap(
                true
            )

            .setVerticalAlignment(
                "top"
            );


        //------------------------------------------------
        // Indication
        //------------------------------------------------

        sheet

            .getRange(
                row + 6,
                1
            )

            .setValue(
                med["Indication"] ||
                ""
            )

            .setFontSize(
                13
            )

            .setWrap(
                true
            )

            .setVerticalAlignment(
                "top"
            );


        //------------------------------------------------
        // Prescribed by
        //------------------------------------------------

        const prescribedBy =

            med["Ordered By"] ||

            med["Noted By"] ||

            "";


        sheet

            .getRange(
                row + 7,
                1
            )

            .setValue(

                "Prescribed by: " +

                (
                    prescribedBy ||
                    "OSEM"
                )

            )

            .setWrap(
                false
            )

            .setVerticalAlignment(
                "middle"
            );

    }


    //------------------------------------------------
    // Apply changes before PDF generation
    //------------------------------------------------

    SpreadsheetApp.flush();

}